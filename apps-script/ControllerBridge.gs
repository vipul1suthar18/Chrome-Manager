/**
 * Chrome Manager bridge for the existing bound Search Console script.
 * Add this one file to the same Apps Script project as Config.gs, Api.gs,
 * Code.gs, UI.gs, and Utils.gs. It reuses validateConfig(), the existing
 * chunked export engine, and that project's own OAuth identity.
 */

var CHROME_MANAGER_SPREADSHEET_ID_KEY = 'CHROME_MANAGER_SPREADSHEET_ID';
var CHROME_MANAGER_CONFIG_SHEET = 'Config';

/** Optional setup helper; pass an ID for standalone Apps Script projects. */
function authorizeChromeManager(spreadsheetId) {
  var ss = spreadsheetId
    ? SpreadsheetApp.openById(String(spreadsheetId).trim())
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return 'This is a standalone Apps Script project. No active sheet is available here; Chrome Manager will connect it to the configured spreadsheet the first time you click Run.';
  PropertiesService.getScriptProperties().setProperty(CHROME_MANAGER_SPREADSHEET_ID_KEY, ss.getId());
  return 'Chrome Manager is authorized for ' + ss.getName() + ' (' + ss.getId() + ').';
}

/**
 * Displays the run status page in the selected client's Chrome profile and
 * starts automatically. Download a manual copy before launching from Chrome Manager.
 */
function doGet(e) {
  var request = chromeManagerRequestFromParams_(e && e.parameter || {});
  var authorizedId = PropertiesService.getScriptProperties().getProperty(CHROME_MANAGER_SPREADSHEET_ID_KEY) || '';
  var pageMessage = '';
  var tabsToReplace = [];
  var onlyConfigTab = false;

  if (!authorizedId && request.spreadsheetId) {
    try {
      // Standalone Apps Script projects have no active spreadsheet. Bind the
      // first valid Chrome Manager request to the sheet ID it supplies.
      SpreadsheetApp.openById(request.spreadsheetId);
      PropertiesService.getScriptProperties().setProperty(CHROME_MANAGER_SPREADSHEET_ID_KEY, request.spreadsheetId);
      authorizedId = request.spreadsheetId;
    } catch (connectError) {
      pageMessage = 'Could not connect to this spreadsheet. Check that this Chrome profile is signed in to an account with access, and approve the spreadsheet permission if Google asks. ' + (connectError.message || connectError);
    }
  }

  if (!pageMessage && !authorizedId) {
    pageMessage = 'Spreadsheet ID is missing. Open Edit connection in Chrome Manager and add the spreadsheet ID.';
  } else if (!pageMessage && request.spreadsheetId !== authorizedId) {
    pageMessage = 'The spreadsheet ID does not match the spreadsheet authorized for this Apps Script project.';
  } else if (!pageMessage) {
    try {
      var config = chromeManagerBuildConfig_(request);
      var ss = SpreadsheetApp.openById(authorizedId);
      tabsToReplace = chromeManagerTabsToReplace_(ss, config).map(function (sheet) { return sheet.getName(); });
      var existingSheets = ss.getSheets();
      onlyConfigTab = existingSheets.length === 1 && existingSheets[0].getName() === CHROME_MANAGER_CONFIG_SHEET;
    } catch (error) {
      pageMessage = error.message || String(error);
    }
  }

  return HtmlService.createHtmlOutput(chromeManagerConfirmationPage_(request, tabsToReplace, pageMessage, onlyConfigTab))
    .setTitle('Search Console · Chrome Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called only from the explicit confirmation button in the bridge page. */
function runSearchConsoleFromController(rawRequest) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: 'Another Search Console run is starting. No spreadsheet changes were made.' };
  }

  try {
    var authorizedId = PropertiesService.getScriptProperties().getProperty(CHROME_MANAGER_SPREADSHEET_ID_KEY) || '';
    var request = chromeManagerRequestFromParams_(rawRequest || {});
    if (!authorizedId || request.spreadsheetId !== authorizedId) {
      return { success: false, message: 'This script is not authorized for the requested spreadsheet. No changes were made.' };
    }

    var config;
    try {
      config = chromeManagerBuildConfig_(request);
    } catch (validationError) {
      return { success: false, message: validationError.message || String(validationError) };
    }

    if (loadJobState_()) {
      return { success: false, message: 'A Search Console export is already running for this script. No changes were made.' };
    }

    var ss;
    try {
      ss = SpreadsheetApp.openById(authorizedId);
    } catch (openError) {
      return { success: false, message: 'Could not open the authorized spreadsheet. No spreadsheet changes were made. ' + (openError.message || openError) };
    }

    try {
      var configSheet = chromeManagerEnsureConfigSheet_(ss);
      var tabsToReplace = chromeManagerTabsToReplace_(ss, config);
      tabsToReplace.forEach(function (sheet) {
        // Config is excluded by chromeManagerTabsToReplace_().
        ss.deleteSheet(sheet);
      });

      // The existing exporter supports both modes. Values are validated above;
      // Replace Existing clears its target, so the user is asked to download
      // a copy before confirming this run.
      configSheet.getRange(2, 1, 1, CONFIG_HEADERS.length).setValues([[
        config.propertyUrl,
        formatDateForApi(config.startDate),
        formatDateForApi(config.endDate),
        config.dimension,
        config.searchType,
        config.countryRaw || ALL_COUNTRIES_LABEL,
        config.outputMode,
        config.sheetName
      ]]);

      var state = buildInitialJobState_(config, ss);
      var result = runJobChunk_(state);
      if (result.done) {
        clearJobState_();
        return {
          success: true,
          rowsWritten: result.totalRowsWritten,
          message: 'Search Console report completed. ' + result.totalRowsWritten + ' rows were written.'
        };
      }

      scheduleContinuation_(result.state);
      return {
        success: true,
        pending: true,
        rowsWritten: result.totalRowsWritten,
        message: 'The export is continuing in the background. ' + result.totalRowsWritten + ' rows were written in the first run.'
      };
    } catch (runError) {
      return {
        success: false,
        message: 'The workflow stopped after spreadsheet changes may have started. Check the spreadsheet before trying again. ' + (runError.message || runError)
      };
    }
  } finally {
    lock.releaseLock();
  }
}

function chromeManagerRequestFromParams_(params) {
  var request = {};
  ['spreadsheetId', 'propertyUrl', 'startDate', 'endDate', 'dimension', 'searchType', 'country', 'outputMode', 'sheetName'].forEach(function (key) {
    request[key] = (params[key] == null ? '' : String(params[key])).trim();
  });
  return request;
}

function chromeManagerBuildConfig_(request) {
  var config = {
    propertyUrl: request.propertyUrl,
    startDateRaw: request.startDate,
    endDateRaw: request.endDate,
    dimension: request.dimension.toLowerCase(),
    searchType: request.searchType,
    countryRaw: request.country || ALL_COUNTRIES_LABEL,
    outputMode: request.outputMode || 'New Sheet',
    sheetName: request.sheetName
  };
  if (!request.spreadsheetId) throw new Error('Spreadsheet ID is required.');
  validateConfig(config);
  return config;
}

function chromeManagerEnsureConfigSheet_(ss) {
  var sheet = ss.getSheetByName(CHROME_MANAGER_CONFIG_SHEET);
  if (!sheet) sheet = ss.insertSheet(CHROME_MANAGER_CONFIG_SHEET, 0);

  var headers = sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).getValues()[0];
  var match = headers.every(function (value, index) { return value === CONFIG_HEADERS[index]; });
  if (!match) sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([CONFIG_HEADERS]);
  sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setFontWeight('bold').setBackground('#ffff00').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);
  return sheet;
}

function chromeManagerTabsToReplace_(ss, config) {
  // New Sheet must preserve existing tabs so separate monthly exports (for
  // example Aug, Sep, and Oct) can coexist. Replace Existing only clears the
  // explicitly named destination tab.
  if (config.outputMode !== 'Replace Existing') return [];

  return ss.getSheets().filter(function (sheet) {
    var name = sheet.getName();
    return name !== CHROME_MANAGER_CONFIG_SHEET && name === config.sheetName;
  });
}

function chromeManagerConfirmationPage_(request, tabsToReplace, pageMessage, onlyConfigTab) {
  var requestJson = JSON.stringify(request).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  var tabsJson = JSON.stringify(tabsToReplace).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  var messageJson = JSON.stringify(pageMessage).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  var onlyConfigJson = JSON.stringify(onlyConfigTab === true);
  return '<!doctype html><html><head><base target="_top"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:15px Arial,sans-serif;color:#17243a;margin:32px auto;padding:0 20px;max-width:680px}h1{font-size:24px}.card{border:1px solid #dce5f1;border-radius:12px;padding:20px;margin:20px 0}li{margin:6px 0}.muted{color:#62718d}.warning{color:#9a4d00}.error{color:#a5222c}button{background:#2563eb;color:white;border:0;border-radius:9px;padding:11px 18px;font-size:14px;font-weight:bold;cursor:pointer}button:disabled{opacity:.55;cursor:wait}a{color:#2563eb}</style></head><body>' +
    '<h1>Search Console report</h1><p class="muted">This run uses the Google account signed in to this client’s Chrome profile.</p>' +
    '<div class="card"><div id="summary"></div><div id="cleanup"></div></div>' +
    '<p id="error" class="error"></p><span id="status" class="muted"></span>' +
    '<script>const request=' + requestJson + ';const tabs=' + tabsJson + ';const pageError=' + messageJson + ';const onlyConfigTab=' + onlyConfigJson + ';' +
    'const summary=document.getElementById("summary");["propertyUrl","startDate","endDate","dimension","searchType","country","outputMode","sheetName"].forEach(k=>{const p=document.createElement("p");p.textContent=k+": "+(request[k]||"(blank)");summary.appendChild(p)});' +
    'const cleanup=document.getElementById("cleanup");const h=document.createElement("strong");h.textContent="Monthly report tabs to replace:";cleanup.appendChild(h);if(onlyConfigTab){const p=document.createElement("p");p.textContent="Only the Config tab is present. No report tabs need cleanup.";cleanup.appendChild(p)}else if(!tabs.length){const p=document.createElement("p");p.textContent="No existing monthly report tabs match the cleanup rule.";cleanup.appendChild(p)}else{const ul=document.createElement("ul");tabs.forEach(name=>{const li=document.createElement("li");li.textContent=name;ul.appendChild(li)});cleanup.appendChild(ul)}' +
    'const status=document.getElementById("status");document.getElementById("error").textContent=pageError;function startRun(){status.textContent="Running report…";google.script.run.withSuccessHandler(result=>{status.textContent=result.message||"Finished."}).withFailureHandler(error=>{status.textContent="Stopped: "+(error.message||error)}).runSearchConsoleFromController(request)}if(!pageError)startRun()</script></body></html>';
}
