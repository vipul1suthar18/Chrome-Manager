/**
 * Code.gs
 * ---------------------------------------------------------------------------
 * Main orchestration logic. Ties Config.gs, Api.gs, and formatting together.
 *
 * There is a single export path now (Max Rows / Sort By are gone): every
 * fetch pulls back ALL rows for the chosen property / date range /
 * dimension / search type, filtered to the chosen country. It's chunked
 * and resumable - fetches one API page at a time, writing directly to the
 * sheet as it goes (never holds the whole dataset in memory). Everything
 * goes into a SINGLE tab (the one you name) - no auto-created "Sheet (2)",
 * "Sheet (3)" tabs. When the whole spreadsheet FILE gets close to Google's
 * hard 10-million-cell limit, the export automatically continues in a brand-
 * new spreadsheet file on Drive ("Sheet Name (Part 2)", "(Part 3)", ...) and
 * resumes there - it never fails with the "workbook too many cells" error and
 * never asks you to delete anything. When the execution is about to hit Apps
 * Script's time limit, it checkpoints its progress (PropertiesService) and
 * schedules a one-off trigger to resume itself a few seconds later - repeating
 * until the whole export is done, however many millions of rows that takes.
 * Small exports (most single-country pulls) simply finish within the very
 * first chunk, so in practice this feels instant for typical use.
 *
 * There's no "Last Run Status" cell anymore. Feedback comes from the alert
 * dialog / toast shown at the time you click "Fetch Data", and - for
 * exports large enough to keep running in the background - a completion
 * email sent to whoever started the export.
 * ---------------------------------------------------------------------------
 */

var MAX_RUN_MS = 4.5 * 60 * 1000;   // stop and checkpoint before Apps Script's ~6 min limit

// One color per website. Each Search Console property is hashed to one of
// these, so every tab from site A is always blue, site B orange, etc.
var PROPERTY_TAB_COLORS = [
  '#1a73e8', // blue
  '#e8710a', // orange
  '#188038', // green
  '#7627bb', // purple
  '#c5221f', // red
  '#00695c', // teal
  '#d93025', // coral red
  '#5f6368'  // gray
];

// Column widths are never touched by the script - the user sets them once in
// the sheet and every run keeps them that way.
var SPREADSHEET_CELL_BUDGET = 9000000; // stop writing to a spreadsheet FILE before Google's
                                       // hard 10M-cell-per-file limit; 9M leaves headroom so
                                       // a write never trips the "workbook too many cells" error
var JOB_STATE_KEY = 'GSC_EXPORT_JOB_STATE';
var CONTINUATION_FUNCTION = 'continueFetchAndWrite';

/* ========================================================================
 * Shared helpers
 * ===================================================================== */

/**
 * Returns the ordered list of dimension keys for a dimension string,
 * e.g. "query" -> ["query"], "query+page" -> ["query", "page"].
 * @param {string} dimension
 * @return {Array<string>}
 */
function getDimensionKeys_(dimension) {
  return dimension.split('+');
}

/**
 * Turns a dimension key ("query" / "page") into its display header.
 * @param {string} dimKey
 * @return {string}
 */
function dimensionHeaderLabel_(dimKey) {
  return dimKey === 'query' ? 'Query' : 'Page';
}

/**
 * Creates (New Sheet mode) or clears (Replace Existing mode) the FIRST
 * output sheet, per the config's Output Mode. All data goes into this one
 * tab; when the file fills up the export continues in a brand-new
 * spreadsheet file instead (see createNextPart_).
 * @param {Spreadsheet} ss
 * @param {Object} config
 * @return {Sheet}
 */
function prepareOutputSheet_(ss, config) {
  var sheet;

  if (config.outputMode === 'Replace Existing') {
    sheet = ss.getSheetByName(config.sheetName);
    if (sheet) {
      sheet.clear();
      sheet.clearFormats();
      sheet.getDataRange().clearDataValidations();
    } else {
      sheet = ss.insertSheet(config.sheetName);
    }
  } else {
    var finalName = getUniqueSheetName(ss, config.sheetName);
    sheet = ss.insertSheet(finalName);
  }

  return sheet;
}

/**
 * Returns the color assigned to a Search Console property URL. The same
 * property always maps to the same color, so all its tabs share one color.
 * @param {string} propertyUrl
 * @return {string} hex color like '#1a73e8'
 */
function getPropertyTabColor_(propertyUrl) {
  var s = propertyUrl || '';
  var hash = 0;
  for (var i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return PROPERTY_TAB_COLORS[hash % PROPERTY_TAB_COLORS.length];
}

/**
 * Writes and formats the header row for a fresh output sheet: yellow
 * background, black non-bold centered text (matching the Config tab header).
 * Column widths are untouched.
 * @param {Sheet} sheet
 * @param {Array<string>} dimKeys
 */
function writeHeaderRow_(sheet, dimKeys) {
  var headers = dimKeys.map(dimensionHeaderLabel_).concat(['Clicks', 'Impressions', 'CTR', 'Average Position']);
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('normal').setFontColor('#000000');
  range.setBackground('#ffff00');
  range.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // Remove every column past the export columns (column G onward for a
  // 6-column export) so nothing after them eats into the 10M-cell budget.
  trimTrailingColumns_(sheet, headers.length);
}

/**
 * Deletes all columns after the export's last column (e.g. everything from
 * column G onward for a 6-column export). The script never writes there, but
 * stray cells left behind by earlier versions or manual edits can inflate the
 * used-cell count - trimming them keeps the file as compact as possible.
 * @param {Sheet} sheet
 * @param {number} numCols how many columns the export uses (header length)
 */
function trimTrailingColumns_(sheet, numCols) {
  var lastCol = sheet.getLastColumn();
  if (lastCol > numCols) {
    sheet.deleteColumns(numCols + 1, lastCol - numCols);
  }
}

/**
 * Colors the tab itself with the property's color, so each website's tabs
 * stand out against each other.
 * @param {Sheet} sheet
 * @param {string} color hex color
 */
function colorOutputTab_(sheet, color) {
  try {
    sheet.setTabColor(color);
  } catch (e) {
    // Tab color is purely cosmetic - never fail an export over it.
  }
}

/**
 * Approximates how many cells are currently used in a spreadsheet file (the
 * sum of each tab's lastRow x lastColumn). Used to decide when a file is too
 * full to accept more data and the export should roll over to a new file.
 * @param {Spreadsheet} ss
 * @return {number}
 */
function getUsedCells_(ss) {
  var sheets = ss.getSheets();
  var total = 0;
  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    total += Math.max(s.getLastRow(), 1) * Math.max(s.getLastColumn(), 1);
  }
  return total;
}

/**
 * Appends a batch of raw API rows to a sheet, starting right after
 * whatever data rows are already there.
 * @param {Sheet} sheet
 * @param {Array<string>} dimKeys
 * @param {Array<Object>} apiRows
 * @param {number} existingDataRowCount rows already written (excludes header)
 */
function appendRowsToSheet_(sheet, dimKeys, apiRows, existingDataRowCount) {
  if (apiRows.length === 0) return;

  var data = apiRows.map(function (row) {
    var keys = row.keys || [];
    var keyValues = dimKeys.map(function (_, i) { return keys[i] || ''; });
    var clicks = row.clicks || 0;
    var impressions = row.impressions || 0;
    var ctr = round2(row.ctr || 0);
    var position = round2(row.position || 0);
    return keyValues.concat([clicks, impressions, ctr, position]);
  });

  var numCols = dimKeys.length + 4;
  sheet.getRange(existingDataRowCount + 2, 1, data.length, numCols).setValues(data);
}

/**
 * Applies final formatting to a sheet once no more rows will be appended
 * to it: Roboto size-10 text across the whole tab, a white data area (only
 * the header row stays colored), Query/Page text columns left-aligned and
 * metrics centered, plus number formats and a filter. Column widths are
 * left untouched.
 * @param {Sheet} sheet
 * @param {Array<string>} dimKeys
 * @param {number} rowCount data rows written (excludes header)
 * @param {string} headerColor property color used for the header row
 */
function finalizeSheetFormatting_(sheet, dimKeys, rowCount, headerColor) {
  var numDimCols = dimKeys.length;
  var numCols = numDimCols + 4;

  // Column widths left untouched — the user sets them once in the sheet and
  // the script keeps them that way.

  if (rowCount > 0) {
    var totalRows = rowCount + 1;
    var clicksCol = numDimCols + 1;
    var dataRange = sheet.getRange(2, 1, rowCount, numCols);
    var fullRange = sheet.getRange(1, 1, totalRows, numCols);

    // Whole tab (header + data): Roboto font, size 10.
    fullRange.setFontFamily('Roboto').setFontSize(10);

    dataRange.setBackground('#ffffff'); // header stays colored; data rows are plain white
    dataRange.setHorizontalAlignment('center');

    // Query/Page text columns (up to A and B): data cells stay left-aligned -
    // long query strings read better left-aligned than centered. The header
    // row (A1/B1) keeps its centered alignment from writeHeaderRow_.
    sheet.getRange(2, 1, rowCount, Math.min(numDimCols, 2)).setHorizontalAlignment('left');

    sheet.getRange(2, clicksCol, rowCount, 1).setNumberFormat('#,##0');      // Clicks
    sheet.getRange(2, clicksCol + 1, rowCount, 1).setNumberFormat('#,##0'); // Impressions
    sheet.getRange(2, clicksCol + 2, rowCount, 1).setNumberFormat('0.00%'); // CTR
    sheet.getRange(2, clicksCol + 3, rowCount, 1).setNumberFormat('0.00'); // Average Position

    var filterRange = sheet.getRange(1, 1, totalRows, numCols);
    if (sheet.getFilter()) {
      sheet.getFilter().remove();
    }
    filterRange.createFilter();
  }
}

/* ========================================================================
 * Chunked, resumable, multi-sheet export engine
 * ===================================================================== */

/**
 * Creates a brand-new spreadsheet FILE for the next part of a large export,
 * sets up its first output tab (colored + header), and points the job state
 * at it. Called whenever the current spreadsheet file is too full to hold
 * more data - so the export "creates a Part 2 file and resumes there" instead
 * of failing with the 10M-cell error.
 * @param {Object} state
 * @return {Spreadsheet} the new spreadsheet
 */
function createNextPart_(state) {
  state.partNumber += 1;
  var name = state.baseSheetName + ' (Part ' + state.partNumber + ')';
  var newSs = SpreadsheetApp.create(name);
  state.partSpreadsheetId = newSs.getId();
  state.partUrls.push(newSs.getUrl());

  state.currentSheetName = state.baseSheetName;
  var sheet = newSs.insertSheet(state.currentSheetName);
  colorOutputTab_(sheet, state.propertyColor);
  writeHeaderRow_(sheet, getDimensionKeys_(state.dimension));
  state.rowsInCurrentSheet = 0;
  state.sheetsCreated += 1;

  // SpreadsheetApp.create() adds a blank "Sheet1" - remove it now that the
  // real output sheet exists (can't delete a spreadsheet's only sheet).
  var blank = newSs.getSheetByName('Sheet1');
  if (blank) {
    newSs.deleteSheet(blank);
  }

  return newSs;
}

/**
 * Builds the initial job state for an export and writes the header row of
 * the first output sheet. If the original workbook is already full, the
 * export starts in a fresh spreadsheet file instead.
 * @param {Object} config validated config
 * @param {Spreadsheet} ss
 * @return {Object} job state
 */
function buildInitialJobState_(config, ss) {
  var dimKeys = getDimensionKeys_(config.dimension);
  var propertyColor = getPropertyTabColor_(config.propertyUrl);

  var ownerEmail = '';
  try {
    ownerEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  } catch (e) {
    // Email lookup can fail in some domain setups - background jobs will
    // still complete, just without a completion email.
  }

  var state = {
    spreadsheetId: ss.getId(),          // original workbook (hosts the script + Config)
    partSpreadsheetId: ss.getId(),      // file currently receiving data
    partNumber: 1,
    partUrls: [ss.getUrl()],
    propertyUrl: config.propertyUrl,
    startDateStr: formatDateForApi(config.startDate),
    endDateStr: formatDateForApi(config.endDate),
    dimension: config.dimension,
    searchType: config.searchType,
    countryFilter: config.countryFilter || null, // null = every country
    propertyColor: propertyColor,
    baseSheetName: config.sheetName,
    currentSheetName: null,
    apiStartRow: 0,
    rowsInCurrentSheet: 0,
    totalRowsWritten: 0,
    sheetsCreated: 0,
    triggerId: null,
    ownerEmail: ownerEmail
  };

  // If the original workbook is already basically full (this is why most users
  // hit the 10M-cell error), don't touch it - start the export in a fresh file.
  if (getUsedCells_(ss) + dimKeys.length + 4 > SPREADSHEET_CELL_BUDGET) {
    createNextPart_(state);
  } else {
    var sheet = prepareOutputSheet_(ss, config);
    colorOutputTab_(sheet, propertyColor);
    writeHeaderRow_(sheet, dimKeys);
    state.currentSheetName = sheet.getName();
    state.baseSheetName = sheet.getName();
    state.sheetsCreated = 1;
  }

  return state;
}

/**
 * Converts a validated Config row into a JSON-safe form for background jobs.
 * @param {Object} config
 * @return {Object}
 */
function serializeConfigForQueue_(config) {
  return {
    rowNumber: config.rowNumber || 2,
    propertyUrl: config.propertyUrl,
    startDateRaw: formatDateForApi(config.startDate),
    endDateRaw: formatDateForApi(config.endDate),
    dimension: config.dimension,
    searchType: config.searchType,
    countryRaw: config.countryRaw || ALL_COUNTRIES_LABEL,
    outputMode: config.outputMode,
    sheetName: config.sheetName
  };
}

/**
 * Marks the current Config row complete and prepares the next row, if any.
 * @param {Object} state current job state (may contain a batch queue)
 * @param {Object} result completed chunk result
 * @return {{nextState: Object|null, stats: Object|null}}
 */
function advanceBatchState_(state, result) {
  if (!state.batchStats) return { nextState: null, stats: null };

  var stats = state.batchStats;
  stats.completed += 1;
  stats.rowsWritten += result.totalRowsWritten;
  stats.reports.push({
    rowNumber: state.configRowNumber || 2,
    propertyUrl: state.propertyUrl,
    sheetName: state.baseSheetName,
    rowsWritten: result.totalRowsWritten,
    partUrls: result.partUrls || [SpreadsheetApp.openById(state.spreadsheetId).getUrl()]
  });

  state.batchQueue = state.batchQueue || [];
  if (!state.batchQueue.length) return { nextState: null, stats: stats };

  var nextConfig = validateConfig(state.batchQueue.shift());
  var nextState = buildInitialJobState_(nextConfig, SpreadsheetApp.openById(state.spreadsheetId));
  nextState.configRowNumber = nextConfig.rowNumber || 2;
  nextState.chromeManagerRunId = state.chromeManagerRunId || '';
  nextState.batchQueue = state.batchQueue;
  nextState.batchStats = stats;
  return { nextState: nextState, stats: stats };
}

/** Formats the direct-run success alert for a batch of Config rows. */
function formatBatchSummary_(stats) {
  var reportLines = stats.reports.map(function (report) {
    return '• ' + report.sheetName + ': ' + report.rowsWritten + ' row(s)';
  });
  return 'Completed ' + stats.completed + ' of ' + stats.total + ' report(s).\n\n' +
    reportLines.join('\n') + '\n\nTotal rows written: ' + stats.rowsWritten + '.';
}

/** Stores report status so the Chrome Manager tab can download on completion. */
function setChromeManagerRunStatus_(runId, status, message) {
  if (!runId) return;
  var key = 'CHROME_MANAGER_RUN_' + String(runId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  PropertiesService.getDocumentProperties().setProperty(key, JSON.stringify({ status: status, message: message || '' }));
}

/** Read by the Chrome Manager page; terminal states are consumed once. */
function getChromeManagerRunStatus(runId) {
  var safeId = String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  if (!safeId) return { status: 'missing', message: 'Run ID was not provided.' };
  var properties = PropertiesService.getDocumentProperties();
  var key = 'CHROME_MANAGER_RUN_' + safeId;
  var raw = properties.getProperty(key);
  if (!raw) return { status: 'running', message: 'The report is still running.' };
  var result = JSON.parse(raw);
  if (result.status === 'completed' || result.status === 'failed') properties.deleteProperty(key);
  return result;
}

/**
 * Runs as much of an export job as fits within the time budget, fetching
 * one API page at a time and splitting across sheets as needed. Mutates
 * and returns the job state; does NOT persist state or schedule triggers
 * itself - the caller (onFetchDataClick / continueFetchAndWrite) does that
 * based on the returned "done" flag.
 * @param {Object} state job state (from buildInitialJobState_ or loadJobState_)
 * @return {{done: boolean, state: Object, totalRowsWritten: number, sheetsCreated: number}}
 */
function runJobChunk_(state) {
  var dimKeys = getDimensionKeys_(state.dimension);
  var numCols = dimKeys.length + 4;

  // Jobs started before per-website colors existed won't have propertyColor
  // saved. Derive it so formatting never crashes on an old/partial state.
  if (!state.propertyColor) {
    state.propertyColor = getPropertyTabColor_(state.propertyUrl);
  }

  var ss = SpreadsheetApp.openById(state.partSpreadsheetId);
  var partCells = getUsedCells_(ss); // cells already used in the current file

  var sheet = ss.getSheetByName(state.currentSheetName);
  if (!sheet) {
    // Shouldn't normally happen, but recover gracefully rather than crash.
    sheet = ss.insertSheet(state.currentSheetName);
    colorOutputTab_(sheet, state.propertyColor);
    writeHeaderRow_(sheet, dimKeys);
    state.rowsInCurrentSheet = 0;
  }

  var startTime = Date.now();
  var timedOut = false;

  while (true) {
    if (Date.now() - startTime > MAX_RUN_MS) {
      timedOut = true;
      break;
    }

    var pageSize = GSC_ROW_LIMIT;

    var pageRows = fetchSearchConsolePage_(
      state.propertyUrl, state.startDateStr, state.endDateStr,
      dimKeys, state.searchType, state.apiStartRow, pageSize, state.countryFilter
    );

    if (pageRows.length === 0) break; // no more data

    // Everything goes into ONE tab. If writing this whole page would push the
    // current spreadsheet FILE past the cell budget, roll the export over to
    // a brand-new file ("Sheet Name (Part 2)") and resume there, instead of
    // failing with the 10M-cell error.
    if (partCells + pageRows.length * numCols > SPREADSHEET_CELL_BUDGET) {
      if (state.rowsInCurrentSheet > 0) {
        finalizeSheetFormatting_(sheet, dimKeys, state.rowsInCurrentSheet, state.propertyColor);
      }
      ss = createNextPart_(state);
      sheet = ss.getSheetByName(state.currentSheetName);
      partCells = getUsedCells_(ss);
      state.rowsInCurrentSheet = 0;
    }

    appendRowsToSheet_(sheet, dimKeys, pageRows, state.rowsInCurrentSheet);
    state.rowsInCurrentSheet += pageRows.length;
    state.totalRowsWritten += pageRows.length;
    partCells += pageRows.length * numCols;

    state.apiStartRow += pageRows.length;

    var gotFullPage = (pageRows.length === pageSize);
    if (!gotFullPage) break; // short page = end of results
  }

  if (timedOut) {
    return { done: false, state: state, totalRowsWritten: state.totalRowsWritten, sheetsCreated: state.sheetsCreated, partCount: state.partNumber, partUrls: state.partUrls };
  }

  finalizeSheetFormatting_(sheet, dimKeys, state.rowsInCurrentSheet, state.propertyColor);
  return { done: true, state: state, totalRowsWritten: state.totalRowsWritten, sheetsCreated: state.sheetsCreated, partCount: state.partNumber, partUrls: state.partUrls };
}

/**
 * Entry point called by the time-based continuation trigger. No UI is
 * available in this context (it's not a user-initiated run), so completion
 * is communicated via email instead of an alert dialog.
 */
function continueFetchAndWrite() {
  var state = loadJobState_();
  if (!state) return; // nothing to resume (already finished/cancelled)

  deleteTriggerById_(state.triggerId);
  state.triggerId = null;

  var result;
  try {
    result = runJobChunk_(state);
  } catch (error) {
    clearJobState_();
    setChromeManagerRunStatus_(state.chromeManagerRunId, 'failed', error.message || String(error));
    console.error(error);
    return;
  }

  if (result.done) {
    var batch = advanceBatchState_(result.state || state, result);
    if (batch.nextState) {
      scheduleContinuation_(batch.nextState);
    } else {
      clearJobState_();
      setChromeManagerRunStatus_(state.chromeManagerRunId, 'completed', 'All report rows finished.');
      sendCompletionEmail_(state, result, batch.stats);
    }
  } else {
    scheduleContinuation_(result.state);
  }
}

/**
 * Sends a completion email to whoever started the export, since large
 * exports finish unattended via trigger and there's no dialog to show them.
 * @param {Object} state
 * @param {Object} result
 */
function sendCompletionEmail_(state, result, batchStats) {
  try {
    if (!state.ownerEmail) return;
    var ss = SpreadsheetApp.openById(state.spreadsheetId);
    var urls = (result.partUrls && result.partUrls.length > 0) ? result.partUrls : [ss.getUrl()];
    var filesText = urls.map(function (u) { return '  - ' + u; }).join('\n');
    var body = 'Your Search Console export finished.\n\n' +
      'Rows written: ' + (batchStats ? batchStats.rowsWritten : result.totalRowsWritten) + '\n' +
      'Sheets used: ' + result.sheetsCreated + ' (starting with "' + state.baseSheetName + '")\n' +
      'Spreadsheet file(s): ' + result.partCount + '\n' +
      'Files:\n' + filesText;
    if (batchStats) {
      var reportsText = batchStats.reports.map(function (report) {
        return '  - Config row ' + report.rowNumber + ', ' + report.sheetName + ' (' + report.rowsWritten + ' rows): ' + report.partUrls.join(', ');
      }).join('\n');
      body = 'Your Search Console Config batch finished.\n\n' +
        'Reports completed: ' + batchStats.completed + ' of ' + batchStats.total + '\n' +
        'Total rows written: ' + batchStats.rowsWritten + '\n\n' +
        'Reports:\n' + reportsText;
    }
    MailApp.sendEmail({
      to: state.ownerEmail,
      subject: (batchStats ? 'Search Console Config batch finished - ' : 'Search Console export finished - ') + ss.getName(),
      body: body
    });
  } catch (e) {
    console.error('Failed to send completion email: ' + e);
  }
}

/* ---- job state persistence + trigger management ---- */

function saveJobState_(state) {
  PropertiesService.getDocumentProperties().setProperty(JOB_STATE_KEY, JSON.stringify(state));
}

function loadJobState_() {
  var raw = PropertiesService.getDocumentProperties().getProperty(JOB_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function clearJobState_() {
  PropertiesService.getDocumentProperties().deleteProperty(JOB_STATE_KEY);
}

/**
 * Schedules a one-off trigger to resume the job shortly, and persists the
 * current state so continueFetchAndWrite() can pick it back up.
 * @param {Object} state
 */
function scheduleContinuation_(state) {
  var trigger = ScriptApp.newTrigger(CONTINUATION_FUNCTION).timeBased().after(10 * 1000).create();
  state.triggerId = trigger.getUniqueId();
  saveJobState_(state);
}

/**
 * Deletes a specific project trigger by its unique ID, if it still exists.
 * @param {string} triggerId
 */
function deleteTriggerById_(triggerId) {
  if (!triggerId) return;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getUniqueId() === triggerId) {
      ScriptApp.deleteTrigger(triggers[i]);
      break;
    }
  }
}
