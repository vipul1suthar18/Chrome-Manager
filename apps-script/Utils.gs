/**
 * Utils.gs
 * ---------------------------------------------------------------------------
 * Small, dependency-free helper functions shared across the project.
 * ---------------------------------------------------------------------------
 */

/** Parses a Config sheet date cell into a Date object, or returns null. */
function parseConfigDate(raw) {
  if (!raw) return null;

  if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) {
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  }

  var match = raw.toString().trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  var year = parseInt(match[1], 10);
  var month = parseInt(match[2], 10) - 1;
  var day = parseInt(match[3], 10);
  var parsed = new Date(year, month, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== day) return null;
  return parsed;
}

/** Formats a Date as YYYY-MM-DD for the Search Console API. */
function formatDateForApi(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
}

/** Rounds a number to two decimal places. */
function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/** Returns a unique sheet name by adding a timestamp when the name exists. */
function getUniqueSheetName(ss, baseName) {
  if (!ss.getSheetByName(baseName)) return baseName;

  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd HH-mm');
  var candidate = baseName + ' - ' + timestamp;
  var suffix = 2;
  while (ss.getSheetByName(candidate)) {
    candidate = baseName + ' - ' + timestamp + ' (' + suffix + ')';
    suffix++;
  }
  return candidate;
}

/** Shows a simple alert dialog. */
function showAlert(title, message) {
  SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Logs an error and returns a user-facing message. */
function describeError(e) {
  console.error(e);
  return (e && e.message) ? e.message : String(e);
}
