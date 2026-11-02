/**
 * Config.gs
 * ---------------------------------------------------------------------------
 * Everything related to the "Config" sheet: creating it with the right
 * headers/validations, and reading it into a plain JS object that the rest
 * of the project can use.
 *
 * Config sheet layout (row 1 = headers, rows 2 onward = report configurations):
 *   A: Property URL
 *   B: Start Date
 *   C: End Date
 *   D: Dimension    (query | page | query+page)
 *   E: Search Type  (web | image | video | news | discover | googleNews)
 *   F: Country      (dropdown of country names, e.g. "India", "United States".
 *                     Pick "All Countries" to include every country. This is
 *                     a FILTER, not a breakdown dimension - it restricts
 *                     results to the one country you pick.)
 *   G: Output Mode  (New Sheet | Replace Existing)
 *   H: Sheet Name
 *
 * There is no "Max Rows" / "Sort By" / "Last Run Status" anymore - every
 * fetch pulls back ALL rows for the chosen property/date range/dimension/
 * search type, filtered to the chosen country, no cap and no sorting knob.
 * Progress/completion is reported via alert dialogs and a completion email
 * (see Code.gs / UI.gs) instead of a status cell.
 * ---------------------------------------------------------------------------
 */

var CONFIG_SHEET_NAME = 'Config';

var CONFIG_HEADERS = [
  'Property URL',
  'Start Date',
  'End Date',
  'Dimension',
  'Search Type',
  'Country',
  'Output Mode',
  'Sheet Name'
];

// 'query+page' is the combined dimension: each row is a unique query/page
// pair, exactly like the GSC UI's combined export.
var SUPPORTED_DIMENSIONS = ['query', 'page', 'query+page'];
var SUPPORTED_SEARCH_TYPES = ['web', 'image', 'video', 'news', 'discover', 'googleNews'];
var SUPPORTED_OUTPUT_MODES = ['New Sheet', 'Replace Existing'];

// Special dropdown value meaning "no country filter - include every country".
var ALL_COUNTRIES_LABEL = 'All Countries';

// Full list of countries (ISO 3166-1), used to build the Country dropdown.
// Maps the human-readable name shown in the Config Country column to the lowercase ISO
// 3166-1 alpha-3 code the Search Console API expects.
var COUNTRY_NAME_TO_CODE = {
  'Afghanistan': 'afg',
  'Albania': 'alb',
  'Algeria': 'dza',
  'American Samoa': 'asm',
  'Andorra': 'and',
  'Angola': 'ago',
  'Anguilla': 'aia',
  'Antarctica': 'ata',
  'Antigua and Barbuda': 'atg',
  'Argentina': 'arg',
  'Armenia': 'arm',
  'Aruba': 'abw',
  'Australia': 'aus',
  'Austria': 'aut',
  'Azerbaijan': 'aze',
  'Bahamas': 'bhs',
  'Bahrain': 'bhr',
  'Bangladesh': 'bgd',
  'Barbados': 'brb',
  'Belarus': 'blr',
  'Belgium': 'bel',
  'Belize': 'blz',
  'Benin': 'ben',
  'Bermuda': 'bmu',
  'Bhutan': 'btn',
  'Bolivia': 'bol',
  'Bonaire, Sint Eustatius and Saba': 'bes',
  'Bosnia and Herzegovina': 'bih',
  'Botswana': 'bwa',
  'Bouvet Island': 'bvt',
  'Brazil': 'bra',
  'British Indian Ocean Territory': 'iot',
  'Brunei Darussalam': 'brn',
  'Bulgaria': 'bgr',
  'Burkina Faso': 'bfa',
  'Burundi': 'bdi',
  'Cabo Verde': 'cpv',
  'Cambodia': 'khm',
  'Cameroon': 'cmr',
  'Canada': 'can',
  'Cayman Islands': 'cym',
  'Central African Republic': 'caf',
  'Chad': 'tcd',
  'Chile': 'chl',
  'China': 'chn',
  'Christmas Island': 'cxr',
  'Cocos (Keeling) Islands': 'cck',
  'Colombia': 'col',
  'Comoros': 'com',
  'Congo': 'cog',
  'Congo, The Democratic Republic of the': 'cod',
  'Cook Islands': 'cok',
  'Costa Rica': 'cri',
  'Croatia': 'hrv',
  'Cuba': 'cub',
  'Curaçao': 'cuw',
  'Cyprus': 'cyp',
  'Czechia': 'cze',
  'Côte d\'Ivoire': 'civ',
  'Denmark': 'dnk',
  'Djibouti': 'dji',
  'Dominica': 'dma',
  'Dominican Republic': 'dom',
  'Ecuador': 'ecu',
  'Egypt': 'egy',
  'El Salvador': 'slv',
  'Equatorial Guinea': 'gnq',
  'Eritrea': 'eri',
  'Estonia': 'est',
  'Eswatini': 'swz',
  'Ethiopia': 'eth',
  'Falkland Islands (Malvinas)': 'flk',
  'Faroe Islands': 'fro',
  'Fiji': 'fji',
  'Finland': 'fin',
  'France': 'fra',
  'French Guiana': 'guf',
  'French Polynesia': 'pyf',
  'French Southern Territories': 'atf',
  'Gabon': 'gab',
  'Gambia': 'gmb',
  'Georgia': 'geo',
  'Germany': 'deu',
  'Ghana': 'gha',
  'Gibraltar': 'gib',
  'Greece': 'grc',
  'Greenland': 'grl',
  'Grenada': 'grd',
  'Guadeloupe': 'glp',
  'Guam': 'gum',
  'Guatemala': 'gtm',
  'Guernsey': 'ggy',
  'Guinea': 'gin',
  'Guinea-Bissau': 'gnb',
  'Guyana': 'guy',
  'Haiti': 'hti',
  'Heard Island and McDonald Islands': 'hmd',
  'Holy See (Vatican City State)': 'vat',
  'Honduras': 'hnd',
  'Hong Kong': 'hkg',
  'Hungary': 'hun',
  'Iceland': 'isl',
  'India': 'ind',
  'Indonesia': 'idn',
  'Iran': 'irn',
  'Iraq': 'irq',
  'Ireland': 'irl',
  'Isle of Man': 'imn',
  'Israel': 'isr',
  'Italy': 'ita',
  'Jamaica': 'jam',
  'Japan': 'jpn',
  'Jersey': 'jey',
  'Jordan': 'jor',
  'Kazakhstan': 'kaz',
  'Kenya': 'ken',
  'Kiribati': 'kir',
  'Kuwait': 'kwt',
  'Kyrgyzstan': 'kgz',
  'Laos': 'lao',
  'Latvia': 'lva',
  'Lebanon': 'lbn',
  'Lesotho': 'lso',
  'Liberia': 'lbr',
  'Libya': 'lby',
  'Liechtenstein': 'lie',
  'Lithuania': 'ltu',
  'Luxembourg': 'lux',
  'Macao': 'mac',
  'Madagascar': 'mdg',
  'Malawi': 'mwi',
  'Malaysia': 'mys',
  'Maldives': 'mdv',
  'Mali': 'mli',
  'Malta': 'mlt',
  'Marshall Islands': 'mhl',
  'Martinique': 'mtq',
  'Mauritania': 'mrt',
  'Mauritius': 'mus',
  'Mayotte': 'myt',
  'Mexico': 'mex',
  'Micronesia, Federated States of': 'fsm',
  'Moldova': 'mda',
  'Monaco': 'mco',
  'Mongolia': 'mng',
  'Montenegro': 'mne',
  'Montserrat': 'msr',
  'Morocco': 'mar',
  'Mozambique': 'moz',
  'Myanmar': 'mmr',
  'Namibia': 'nam',
  'Nauru': 'nru',
  'Nepal': 'npl',
  'Netherlands': 'nld',
  'New Caledonia': 'ncl',
  'New Zealand': 'nzl',
  'Nicaragua': 'nic',
  'Niger': 'ner',
  'Nigeria': 'nga',
  'Niue': 'niu',
  'Norfolk Island': 'nfk',
  'North Korea': 'prk',
  'North Macedonia': 'mkd',
  'Northern Mariana Islands': 'mnp',
  'Norway': 'nor',
  'Oman': 'omn',
  'Pakistan': 'pak',
  'Palau': 'plw',
  'Palestine, State of': 'pse',
  'Panama': 'pan',
  'Papua New Guinea': 'png',
  'Paraguay': 'pry',
  'Peru': 'per',
  'Philippines': 'phl',
  'Pitcairn': 'pcn',
  'Poland': 'pol',
  'Portugal': 'prt',
  'Puerto Rico': 'pri',
  'Qatar': 'qat',
  'Romania': 'rou',
  'Russian Federation': 'rus',
  'Rwanda': 'rwa',
  'Réunion': 'reu',
  'Saint Barthélemy': 'blm',
  'Saint Helena, Ascension and Tristan da Cunha': 'shn',
  'Saint Kitts and Nevis': 'kna',
  'Saint Lucia': 'lca',
  'Saint Martin (French part)': 'maf',
  'Saint Pierre and Miquelon': 'spm',
  'Saint Vincent and the Grenadines': 'vct',
  'Samoa': 'wsm',
  'San Marino': 'smr',
  'Sao Tome and Principe': 'stp',
  'Saudi Arabia': 'sau',
  'Senegal': 'sen',
  'Serbia': 'srb',
  'Seychelles': 'syc',
  'Sierra Leone': 'sle',
  'Singapore': 'sgp',
  'Sint Maarten (Dutch part)': 'sxm',
  'Slovakia': 'svk',
  'Slovenia': 'svn',
  'Solomon Islands': 'slb',
  'Somalia': 'som',
  'South Africa': 'zaf',
  'South Georgia and the South Sandwich Islands': 'sgs',
  'South Korea': 'kor',
  'South Sudan': 'ssd',
  'Spain': 'esp',
  'Sri Lanka': 'lka',
  'Sudan': 'sdn',
  'Suriname': 'sur',
  'Svalbard and Jan Mayen': 'sjm',
  'Sweden': 'swe',
  'Switzerland': 'che',
  'Syria': 'syr',
  'Taiwan': 'twn',
  'Tajikistan': 'tjk',
  'Tanzania': 'tza',
  'Thailand': 'tha',
  'Timor-Leste': 'tls',
  'Togo': 'tgo',
  'Tokelau': 'tkl',
  'Tonga': 'ton',
  'Trinidad and Tobago': 'tto',
  'Tunisia': 'tun',
  'Turkmenistan': 'tkm',
  'Turks and Caicos Islands': 'tca',
  'Tuvalu': 'tuv',
  'Türkiye': 'tur',
  'Uganda': 'uga',
  'Ukraine': 'ukr',
  'United Arab Emirates': 'are',
  'United Kingdom': 'gbr',
  'United States': 'usa',
  'United States Minor Outlying Islands': 'umi',
  'Uruguay': 'ury',
  'Uzbekistan': 'uzb',
  'Vanuatu': 'vut',
  'Venezuela': 'ven',
  'Vietnam': 'vnm',
  'Virgin Islands, British': 'vgb',
  'Virgin Islands, U.S.': 'vir',
  'Wallis and Futuna': 'wlf',
  'Western Sahara': 'esh',
  'Yemen': 'yem',
  'Zambia': 'zmb',
  'Zimbabwe': 'zwe',
  'Åland Islands': 'ala'
};

var COUNTRY_NAMES = [ALL_COUNTRIES_LABEL].concat(Object.keys(COUNTRY_NAME_TO_CODE).sort());

/**
 * Ensures the Config sheet exists, is properly labeled, and has data
 * validation dropdowns for Dimension / Search Type / Country / Output Mode.
 * Safe to call repeatedly (idempotent).
 * @return {Sheet} the Config sheet
 */
function ensureConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_SHEET_NAME);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(1); // keep Config as the first tab
  }

  // Write headers (row 1) if missing/incorrect.
  var existingHeaders = sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).getValues()[0];
  var headersMatch = existingHeaders.every(function (h, i) { return h === CONFIG_HEADERS[i]; });
  if (!headersMatch) {
    sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([CONFIG_HEADERS]);
  }

  var headerRange = sheet.getRange(1, 1, 1, CONFIG_HEADERS.length);
  headerRange.setFontWeight('bold').setBackground('#ffff00').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // Helpful note on the Country header so it's discoverable without opening
  // Help every time.
  sheet.getRange('F1').setNote(
    'Pick a country from the dropdown to fetch only that country\'s data. ' +
    'Choose "' + ALL_COUNTRIES_LABEL + '" to include every country. ' +
    'This filters results to one country - it does not add a Country column to the output.'
  );

  // Seed sample defaults into row 2 only if it's completely empty,
  // so we never clobber a user's existing config.
  var row2 = sheet.getRange(2, 1, 1, CONFIG_HEADERS.length).getValues()[0];
  var row2IsEmpty = row2.every(function (v) { return v === '' || v === null; });
  if (row2IsEmpty) {
    var today = new Date();
    var oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    sheet.getRange(2, 1, 1, CONFIG_HEADERS.length).setValues([[
      '', // Property URL - left blank, use "List Properties" to populate the dropdown
      formatDateForApi(oneYearAgo),
      formatDateForApi(today),
      'query',
      'web',
      ALL_COUNTRIES_LABEL, // Country - defaults to no filter
      'New Sheet',
      'GSC Export'
    ]]);
  }

  // Apply dropdowns down the Config columns so each report row can be edited.
  var validationRowCount = Math.max(sheet.getMaxRows() - 1, 1);
  var dimensionRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(SUPPORTED_DIMENSIONS, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 4, validationRowCount, 1).setDataValidation(dimensionRule);

  var searchTypeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(SUPPORTED_SEARCH_TYPES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 5, validationRowCount, 1).setDataValidation(searchTypeRule);

  var countryRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(COUNTRY_NAMES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 6, validationRowCount, 1).setDataValidation(countryRule);
  if (!sheet.getRange('F2').getValue()) {
    sheet.getRange('F2').setValue(ALL_COUNTRIES_LABEL);
  }

  var outputModeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(SUPPORTED_OUTPUT_MODES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 7, validationRowCount, 1).setDataValidation(outputModeRule);

  // Column widths left untouched — the user sets them once in the sheet and
  // the script keeps them that way.

  return sheet;
}

/**
 * Reads row 2 of the Config sheet into a structured object.
 * Does NOT validate values - call validateConfig() separately.
 * @return {Object} config
 */
function getConfig() {
  var sheet = ensureConfigSheet();
  var values = sheet.getRange(2, 1, 1, CONFIG_HEADERS.length).getValues()[0];

  return configFromRow_(values, 2);
}

/**
 * Reads every non-empty report row in Config, from row 2 through the last
 * populated row. Empty spacer rows are ignored.
 * @return {Array<Object>} report configurations
 */
function getConfigs() {
  var sheet = ensureConfigSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, CONFIG_HEADERS.length).getValues()
    .map(function (values, index) {
      var rowNumber = index + 2;
      var isEmpty = values.every(function (value) { return value === '' || value === null; });
      return isEmpty ? null : configFromRow_(values, rowNumber);
    })
    .filter(function (config) { return config !== null; });
}

function configFromRow_(values, rowNumber) {
  return {
    rowNumber: rowNumber,
    propertyUrl: (values[0] || '').toString().trim(),
    startDateRaw: values[1],
    endDateRaw: values[2],
    dimension: (values[3] || '').toString().trim().toLowerCase(),
    searchType: (values[4] || '').toString().trim(),
    countryRaw: (values[5] || '').toString().trim(),
    outputMode: (values[6] || '').toString().trim(),
    sheetName: (values[7] || '').toString().trim()
  };
}

/**
 * Validates a config object, throwing a user-friendly Error on the first
 * problem found. Populates config.startDate / config.endDate as Date
 * objects, and config.countryFilter as a lowercase alpha-3 code (or null
 * for "All Countries") on success.
 * @param {Object} config
 */
function validateConfig(config) {
  var rowNumber = config.rowNumber || 2;
  if (!config.propertyUrl) {
    throw new Error('Property URL (Config!A' + rowNumber + ') is empty. Use "Search Console > List Properties" to pick one, or type it in manually.');
  }

  var startDate = parseConfigDate(config.startDateRaw);
  var endDate = parseConfigDate(config.endDateRaw);

  if (!startDate) {
    throw new Error('Start Date (Config!B' + rowNumber + ') is missing or not a valid date. Use format YYYY-MM-DD.');
  }
  if (!endDate) {
    throw new Error('End Date (Config!C' + rowNumber + ') is missing or not a valid date. Use format YYYY-MM-DD.');
  }
  if (startDate > endDate) {
    throw new Error('Start Date (Config!B' + rowNumber + ') is after End Date (Config!C' + rowNumber + '). Please fix the date range.');
  }

  if (SUPPORTED_DIMENSIONS.indexOf(config.dimension) === -1) {
    throw new Error('Dimension (Config!D' + rowNumber + ') must be "query", "page", or "query+page". Got: "' + config.dimension + '".');
  }

  if (SUPPORTED_SEARCH_TYPES.indexOf(config.searchType) === -1) {
    throw new Error('Search Type (Config!E' + rowNumber + ') must be one of: ' + SUPPORTED_SEARCH_TYPES.join(', ') + '. Got: "' + config.searchType + '".');
  }

  // Country is a dropdown for each Config row. "All Countries" (or blank, for
  // configs saved before this field existed) means no filter.
  if (!config.countryRaw || config.countryRaw === ALL_COUNTRIES_LABEL) {
    config.countryFilter = null;
  } else if (COUNTRY_NAME_TO_CODE.hasOwnProperty(config.countryRaw)) {
    config.countryFilter = COUNTRY_NAME_TO_CODE[config.countryRaw];
  } else {
    throw new Error('Country (Config!F' + rowNumber + ') must be picked from the dropdown (a country name, or "' + ALL_COUNTRIES_LABEL + '"). Got: "' + config.countryRaw + '".');
  }

  if (SUPPORTED_OUTPUT_MODES.indexOf(config.outputMode) === -1) {
    throw new Error('Output Mode (Config!G' + rowNumber + ') must be "New Sheet" or "Replace Existing". Got: "' + config.outputMode + '".');
  }

  if (!config.sheetName) {
    throw new Error('Sheet Name (Config!H' + rowNumber + ') is empty. Please provide a name for the output sheet.');
  }

  config.startDate = startDate;
  config.endDate = endDate;

  return config;
}
