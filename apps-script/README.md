# Search Console Apps Script source

This folder contains the Search Console Apps Script source files, including the Chrome Manager bridge. The bridge calls the project's existing `validateConfig`, `buildInitialJobState_`, and `runJobChunk_` functions; it does not replace the Search Console API or export engine. The spreadsheet's **Fetch Data (all Config rows)** menu runs each non-empty Config row sequentially, including background continuation for large reports.

## Add and authorize the bridge

1. Update the existing `Config.gs`, `UI.gs`, and `Code.gs` with the versions in this folder, and include `Api.gs`, `Utils.gs`, and `ControllerBridge.gs` in the client's Apps Script project.
2. No Drive scope is needed. The project needs its existing Sheets, Search Console, external requests, and continuation trigger scopes.
3. Create or update a **Web app** deployment configured to execute as **the user accessing the web app**. Restrict access to the intended Google account or organization. Each client should use their own Apps Script project and account.
4. Copy the deployed URL ending in `/exec` into that client's **Apps Script URL** field in Chrome Manager. Use **Edit connection** to set the spreadsheet ID and script URL. The client Chrome profile must be signed in to an account that can access that spreadsheet and its Search Console property.
5. You do not need to run `authorizeChromeManager()` manually. On the first Chrome Manager run, the bridge connects to the spreadsheet ID from that project's settings. Google may ask the client account to authorize spreadsheet access.

Download a copy of the spreadsheet manually before starting a run if you want a backup. Chrome Manager does not make one. Clicking **Run** opens the bridge in that client's Chrome profile and the Apps Script run starts automatically under that client's Google account. In `Replace Existing` mode, the page lists the named report tab slated for replacement; it does not wait for another confirmation click.

The single-report bridge and Config-row batches preserve existing tabs when the output mode is `New Sheet`, so separate monthly exports can coexist. With `Replace Existing`, they replace only the explicitly named target tab. The Config tab is never selected as a report output tab.

The existing Apps Script `Replace Existing` mode clears its target sheet. Make any desired manual copy before clicking **Run**. Search Console cleanup only applies to Search Console; Analytics keeps its own separate no-deletion process.

In Chrome Manager, **Run** starts the settings shown in the app; **Run Config rows** reads and runs every filled row from that project's Config tab. The Search Console page also has **Run all Config rows** to start a batch for every listed project. In the spreadsheet, **Search Console → Fetch Data (all Config rows)** runs that spreadsheet's filled rows sequentially. The Chrome Manager bridge downloads the completed workbook as an Excel file in the client's Chrome profile, and the app moves it from that profile's Downloads folder to `Downloads/Search Console Reports/YYYY-MM-DD/<group>/<project>/`. This local organization applies to runs started from Chrome Manager; spreadsheet-menu runs remain in Google Sheets. The Chrome Manager batch and download features require the updated Apps Script web app deployment.
