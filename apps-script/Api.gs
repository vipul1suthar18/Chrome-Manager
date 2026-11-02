/**
 * Api.gs
 * ---------------------------------------------------------------------------
 * All communication with the Search Console REST API. Authenticates using
 * the script's own OAuth token (ScriptApp.getOAuthToken()) - no API keys,
 * no manual credential setup. Requires the "webmasters.readonly" scope,
 * which is declared in appsscript.json.
 * ---------------------------------------------------------------------------
 */

var GSC_API_BASE = 'https://www.googleapis.com/webmasters/v3';
var GSC_ROW_LIMIT = 25000; // max allowed by the API per request

/** Returns the standard headers needed to call the Search Console API. */
function getGscHeaders_() {
  return {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'Content-Type': 'application/json'
  };
}

/** Fetches every Search Console property the authenticated account can access. */
function fetchSearchConsoleProperties() {
  var response = UrlFetchApp.fetch(GSC_API_BASE + '/sites', {
    method: 'get',
    headers: getGscHeaders_(),
    muteHttpExceptions: true
  });

  handleApiErrors_(response, 'listing Search Console properties');

  var json = JSON.parse(response.getContentText());
  var entries = json.siteEntry || [];
  if (entries.length === 0) {
    throw new Error('No Search Console access. This Google account is not associated with any Search Console properties.');
  }
  return entries.map(function (entry) {
    return { siteUrl: entry.siteUrl, permissionLevel: entry.permissionLevel };
  });
}

/**
 * Fetches one Search Analytics API page. The export engine checkpoints
 * between pages so large exports can resume without losing progress.
 */
function fetchSearchConsolePage_(propertyUrl, startDate, endDate, dimensions, searchType, startRow, pageSize, countryFilter) {
  var url = GSC_API_BASE + '/sites/' + encodeURIComponent(propertyUrl) + '/searchAnalytics/query';
  var payload = {
    startDate: startDate,
    endDate: endDate,
    dimensions: dimensions,
    type: searchType,
    rowLimit: pageSize,
    startRow: startRow
  };

  if (countryFilter) {
    payload.dimensionFilterGroups = [{
      filters: [{ dimension: 'country', operator: 'equals', expression: countryFilter }]
    }];
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: getGscHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  handleApiErrors_(response, 'fetching Search Analytics data for ' + propertyUrl);
  var json = JSON.parse(response.getContentText());
  return json.rows || [];
}

/** Converts non-success API responses into actionable errors. */
function handleApiErrors_(response, actionDescription) {
  var code = response.getResponseCode();
  if (code >= 200 && code < 300) return;

  var bodyText = response.getContentText();
  var apiMessage = '';
  try {
    var parsed = JSON.parse(bodyText);
    apiMessage = (parsed.error && parsed.error.message) ? parsed.error.message : bodyText;
  } catch (e) {
    apiMessage = bodyText;
  }

  if (code === 403 || code === 401) {
    throw new Error(
      'No Search Console access for this property (HTTP ' + code + ') while ' + actionDescription + '. ' +
      'Make sure the Google account you\'re authorized as has at least "Restricted" access to this property in Search Console. Details: ' + apiMessage
    );
  }
  if (code === 400) {
    throw new Error('Search Console API rejected the request while ' + actionDescription + '. Details: ' + apiMessage);
  }
  throw new Error('Search Console API error (HTTP ' + code + ') while ' + actionDescription + '. Details: ' + apiMessage);
}
