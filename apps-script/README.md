# Search Console bridge setup

This is a small bridge for the client's Search Console Apps Script project. It calls that project's existing `validateConfig`, `buildInitialJobState_`, and `runJobChunk_` functions; it does not replace the Search Console API or export engine. It works with a bound project or a standalone Apps Script project containing those functions.

## Add and authorize the bridge

1. Add `ControllerBridge.gs` to the client's Apps Script project alongside the existing Search Console files and functions.
2. No Drive scope is needed. The project needs its existing Sheets, Search Console, external requests, and continuation trigger scopes.
3. Create or update a **Web app** deployment configured to execute as **the user accessing the web app**. Restrict access to the intended Google account or organization. Each client should use their own Apps Script project and account.
4. Copy the deployed URL ending in `/exec` into that client's **Apps Script URL** field in Chrome Manager. Use **Edit connection** to set the spreadsheet ID and script URL. The client Chrome profile must be signed in to an account that can access that spreadsheet and its Search Console property.
5. You do not need to run `authorizeChromeManager()` manually. On the first Chrome Manager run, the bridge connects to the spreadsheet ID from that project's settings. Google may ask the client account to authorize spreadsheet access.

Download a copy of the spreadsheet manually before starting a run if you want a backup. Chrome Manager does not make one. Clicking **Run** opens the bridge in that client's Chrome profile and the Apps Script run starts automatically under that client's Google account. The page lists monthly report tabs slated for replacement; it does not wait for another confirmation click.

The bridge preserves `Config`, replaces month-named report tabs (and the explicit target tab for `Replace Existing`), writes the table values to Config, then starts the existing chunked exporter. The Config tab is never selected for deletion.

The existing Apps Script `Replace Existing` mode clears its target sheet. Make any desired manual copy before clicking **Run**. Search Console cleanup only applies to Search Console; Analytics keeps its own separate no-deletion process.

Use Chrome Manager's **Run** to start the bridge. The existing in-sheet **Search Console → Fetch Data** menu remains available as-is and does not call this bridge.
