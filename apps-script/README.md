# Search Console Apps Script source

This folder contains the Search Console Apps Script source files, including the Chrome Manager bridge. The bridge calls the project's existing `validateConfig`, `buildInitialJobState_`, and `runJobChunk_` functions; it does not replace the Search Console API or export engine. The spreadsheet's **Fetch Data (all Config rows)** menu runs each non-empty Config row sequentially, including background continuation for large reports.

## Add and authorize the bridge

1. Update the existing `Config.gs`, `UI.gs`, and `Code.gs` with the versions in this folder, and include `Api.gs`, `Utils.gs`, and `ControllerBridge.gs` in the client's Apps Script project.
2. No Drive scope is needed. The project needs its existing Sheets, Search Console, external requests, and continuation trigger scopes.
3. Create or update a **Web app** deployment configured to execute as **the user accessing the web app**. Restrict access to the intended Google account or organization. Each client should use their own Apps Script project and account.
4. Copy the deployed URL ending in `/exec` into that client's **Apps Script URL** field in Chrome Manager. Use **Edit connection** to set the spreadsheet ID and script URL. The client Chrome profile must be signed in to an account that can access that spreadsheet and its Search Console property.
5. You do not need to run `authorizeChromeManager()` manually. On the first Chrome Manager run, the bridge connects to the spreadsheet ID from that project's settings. Google may ask the client account to authorize spreadsheet access.

Download a copy of the spreadsheet manually before starting a run if you want a backup. Chrome Manager does not make one. Clicking **Run** opens the bridge in that client's Chrome profile and the Apps Script run starts automatically under that client's Google account. In `Replace Existing` mode, the page lists the named report tab slated for replacement; it does not wait for another confirmation click.

The bridge preserves all existing tabs when the output mode is `New Sheet`, so separate monthly exports can coexist. With `Replace Existing`, it replaces only the explicitly named target tab. The Config tab is never selected for deletion. The direct spreadsheet menu also preserves existing tabs for `New Sheet`.

The existing Apps Script `Replace Existing` mode clears its target sheet. Make any desired manual copy before clicking **Run**. Search Console cleanup only applies to Search Console; Analytics keeps its own separate no-deletion process.

Use Chrome Manager's **Run** to start a single report from the app. To run multiple rows, use the in-sheet **Search Console → Fetch Data (all Config rows)** menu; it processes filled Config rows one at a time.
