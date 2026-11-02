/**
 * UI.gs
 * ---------------------------------------------------------------------------
 * Menu creation and everything that talks directly to the Apps Script UI
 * (alerts, dialogs, dropdown population). Menu items call thin wrapper
 * functions here, which delegate the real work to Code.gs / Api.gs and wrap
 * it in try/catch so failures always surface as a friendly alert instead of
 * a silent script error.
 * ---------------------------------------------------------------------------
 */

/**
 * Runs automatically when the spreadsheet is opened.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Search Console')
    .addItem('Fetch Data (all Config rows)', 'onFetchDataClick')
    .addItem('List Properties', 'onListPropertiesClick')
    .addSeparator()
    .addItem('Check Cell Usage', 'onCheckCellUsageClick')
    .addItem('Cancel Running Export', 'onCancelExportClick')
    .addSeparator()
    .addItem('Help', 'onHelpClick')
    .addToUi();

  // Make sure the Config sheet is ready as soon as the file is opened.
  ensureConfigSheet();
}

/**
 * Menu handler: validates every non-empty Config row, then runs each export
 * sequentially. Large exports resume in the background before the next row
 * is started.
 */
function onFetchDataClick() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert(
      'Search Console Busy',
      'Another Search Console run is starting. Please wait for it to finish before starting a Config batch.',
      ui.ButtonSet.OK
    );
    return;
  }

  try {
    var configs = getConfigs();
    if (!configs.length) {
      throw new Error('No report rows found. Add at least one configuration starting on Config row 2.');
    }
    configs.forEach(function (config) { validateConfig(config); });

    if (loadJobState_()) {
      ui.alert(
        'Export Already Running',
        'A background export is already in progress for this spreadsheet. It will continue automatically - ' +
        'use "Search Console > Cancel Running Export" to stop it before starting a new one.',
        ui.ButtonSet.OK
      );
      return;
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    ss.toast('Clearing report tabs before the batch...', 'Search Console', -1);
    removeAllReportTabsExceptConfig_(ss);

    ss.toast('Fetching report 1 of ' + configs.length + '...', 'Search Console', -1);
    var state = buildInitialJobState_(configs[0], ss);
    state.configRowNumber = configs[0].rowNumber || 2;
    state.batchQueue = configs.slice(1).map(serializeConfigForQueue_);
    state.batchStats = { total: configs.length, completed: 0, rowsWritten: 0, reports: [] };
    var result = runJobChunk_(state);

    if (result.done) {
      var batch = advanceBatchState_(result.state || state, result);
      if (batch.nextState) {
        scheduleContinuation_(batch.nextState);
        ss.toast('Report 1 of ' + configs.length + ' done; the next report is queued.', 'Search Console', 10);
        ui.alert(
          'Reports Queued',
          'The first report is complete. The remaining ' + (configs.length - 1) +
          ' Config row(s) will run in order automatically. You will receive a completion email when the batch finishes.',
          ui.ButtonSet.OK
        );
      } else {
        clearJobState_();
        ss.toast('All reports done.', 'Search Console', 5);
        ui.alert('Success', formatBatchSummary_(batch.stats), ui.ButtonSet.OK);
      }
    } else {
      scheduleContinuation_(result.state);
      ss.toast('Large export - continuing in the background...', 'Search Console', 10);
      ui.alert(
        'Export Batch Started',
        'Report 1 of ' + configs.length + ' is large and will continue automatically in the background. ' +
        result.state.totalRowsWritten + ' row(s) have been written so far. Each remaining Config row will start in order after the current report finishes. ' +
        (result.state.ownerEmail
          ? 'You\'ll get a completion email at ' + result.state.ownerEmail + ' when the full batch finishes.'
          : 'Use "Cancel Running Export" to stop the batch.'),
        ui.ButtonSet.OK
      );
    }
  } catch (e) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Failed.', 'Search Console', 5);
    ui.alert('Error', describeError(e), ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Menu handler: "List Properties". Fetches every property the user has
 * access to and turns the Property URL cells into dropdowns.
 */
function onListPropertiesClick() {
  var ui = SpreadsheetApp.getUi();
  try {
    var properties = fetchSearchConsoleProperties();
    var sheet = ensureConfigSheet();

    var siteUrls = properties.map(function (p) { return p.siteUrl; });

    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(siteUrls, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);

    var current = sheet.getRange('A2').getValue();
    if (!current || siteUrls.indexOf(current) === -1) {
      sheet.getRange('A2').setValue(siteUrls[0]);
    }

    ui.alert(
      'Properties Loaded',
      'Found ' + siteUrls.length + ' propert' + (siteUrls.length === 1 ? 'y' : 'ies') +
      '. Property URL cells are now dropdowns - pick a property for each report row and click "Fetch Data (all Config rows)".',
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('Error', describeError(e), ui.ButtonSet.OK);
  }
}

/**
 * Menu handler: "Check Cell Usage". Shows how many cells this workbook is
 * currently using out of Google's 10,000,000-cell limit, with a per-tab
 * breakdown, so you can tell whether the file is getting full before you
 * run an export.
 */
function onCheckCellUsageClick() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var used = getUsedCells_(ss);
    var limit = 10000000;
    var headroom = limit - used;

    var perSheet = ss.getSheets().map(function (s) {
      var rows = Math.max(s.getLastRow(), 1);
      var cols = Math.max(s.getLastColumn(), 1);
      return '  • ' + s.getName() + ': ' + rows + ' rows × ' + cols + ' cols = ' +
        (rows * cols).toLocaleString() + ' cells';
    }).join('\n');

    var warning = '';
    if (headroom < 0) {
      warning = '\n\n⚠ Over the 10M limit! Delete old output tabs to free space.';
    } else if (headroom < 1000000) {
      warning = '\n\n⚠ Less than 1M cells free - a large export may fail. Delete old output tabs if needed.';
    }

    ui.alert(
      'Cell Usage',
      'This workbook is using ' + used.toLocaleString() + ' of ' + limit.toLocaleString() +
      ' cells (' + Math.round(used / limit * 100) + '%).\n' +
      headroom.toLocaleString() + ' cells free.' +
      warning +
      '\n\nPer tab:\n' + perSheet,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('Error', describeError(e), ui.ButtonSet.OK);
  }
}

/**
 * Menu handler: "Cancel Running Export". Stops a background export that's
 * currently mid-flight (deletes its pending trigger and clears its saved
 * progress). Rows already written are left in place as-is.
 */
function onCancelExportClick() {
  var ui = SpreadsheetApp.getUi();
  var state = loadJobState_();

  if (!state) {
    ui.alert('Nothing Running', 'There is no background export currently in progress.', ui.ButtonSet.OK);
    return;
  }

  deleteTriggerById_(state.triggerId);
  clearJobState_();

  ui.alert(
    'Cancelled',
    (state.batchStats
      ? 'The current report and remaining Config rows have been stopped. '
      : 'The background export has been stopped. ') + state.totalRowsWritten +
    ' row(s) were written in the current report before cancelling - existing sheets are left as-is.',
    ui.ButtonSet.OK
  );
}

/**
 * Menu handler: "Help". Shows a quick-reference dialog.
 */
function onHelpClick() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px;">' +
    '<h3 style="margin-top:0;">How to use this tool</h3>' +
    '<ol>' +
    '<li>Run <b>Search Console &gt; List Properties</b> once to load a property dropdown into the Config sheet.</li>' +
    '<li>Fill one report per row on the <b>Config</b> sheet, starting at row 2. Empty rows are skipped.</li>' +
    '<li>Run <b>Search Console &gt; Fetch Data (all Config rows)</b>. Filled rows run in order, and existing tabs are kept when Output Mode is New Sheet.</li>' +
    '</ol>' +
    '<h4>Dimension</h4>' +
    '<p><code>query</code>, <code>page</code>, or <code>query+page</code> for a combined export (one row per unique query/page pair, like GSC\'s own combined view).</p>' +
    '<h4>Country</h4>' +
    '<p>Pick a country from a Config row's Country dropdown to fetch data for that country only. Choose "' + ALL_COUNTRIES_LABEL + '" to include every country.</p>' +
    '<h4>Every row, every time</h4>' +
    '<p>There\'s no row cap or sort option anymore - each run fetches every matching row for the chosen property, date range, dimension, search type, and country.</p>' +
    '<h4>Large exports</h4>' +
    '<p>Each report is written into its named tab. If a fetch is too big to finish in one go, it resumes in the background before the next Config row starts. When a file approaches the 10M-cell limit, the report continues in a new spreadsheet file. You\'ll get an email when the full batch is done. Use <b>Search Console &gt; Cancel Running Export</b> to stop the batch early.</p>' +
    '</div>'
  ).setWidth(440).setHeight(460);

  SpreadsheetApp.getUi().showModalDialog(html, 'Search Console Import - Help');
}
