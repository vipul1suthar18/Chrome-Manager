// Search Console reporting helpers. Analytics is intentionally not exposed as
// a separate controller section; existing client-card GA4 links are untouched.
(function exposeReportingWorkflows(global) {
    const searchConsoleFields = [
        'spreadsheetId', 'scriptUrl', 'editorUrl', 'propertyUrl', 'startDate', 'endDate', 'dimension', 'searchType',
        'country', 'outputMode', 'sheetName'
    ];

    function getSettings(project) {
        const settings = project.reporting?.searchConsole || {};
        return Object.fromEntries(searchConsoleFields.map(field => [field, settings[field] ?? '']));
    }

    function getSpreadsheetId(project) {
        const savedId = project.reporting?.searchConsole?.spreadsheetId;
        if (savedId) return savedId;

        const resource = (project.resources || []).find(item => /search\s*console|\bgsc\b/i.test(item.name || ''));
        for (const candidate of [project.reporting?.searchConsole?.propertyUrl, resource?.url]) {
            if (!candidate) continue;
            try {
                const url = new URL(candidate);
                if (url.hostname !== 'docs.google.com') continue;
                const id = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
                if (id) return id;
            } catch { /* Ignore non-URL values and continue. */ }
        }
        return '';
    }

    global.reportingWorkflows = Object.freeze({
        searchConsole: Object.freeze({
            fields: searchConsoleFields,
            getSettings,
            getSpreadsheetId,
            createLaunchUrl({ scriptUrl, spreadsheetId, settings, runAllConfigRows = false, runId = '' }) {
                let url;
                try {
                    url = new URL(scriptUrl);
                } catch {
                    throw new Error('Enter the deployed Apps Script web app URL.');
                }
                if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.search || url.hash || !/^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)) {
                    throw new Error('Use a deployed Apps Script URL ending in /macros/s/…/exec.');
                }
                if (!spreadsheetId) throw new Error('Add the Google Sheets spreadsheet ID first.');

                const request = { spreadsheetId, runAllConfigRows: runAllConfigRows ? 'true' : 'false', runId };
                // Leave single-run fields blank for batch mode. Older deployed
                // bridges then fail validation safely instead of accidentally
                // running the app's single-row settings as a batch request.
                if (!runAllConfigRows) {
                    Object.assign(request, {
                        propertyUrl: settings.propertyUrl,
                        startDate: settings.startDate,
                        endDate: settings.endDate,
                        dimension: settings.dimension,
                        searchType: settings.searchType,
                        country: settings.country,
                        outputMode: settings.outputMode,
                        sheetName: settings.sheetName
                    });
                }
                Object.entries(request).forEach(([key, value]) => url.searchParams.set(key, value || ''));
                return url.toString();
            },
            getPropertyUrl(project) {
                const savedUrl = project.reporting?.searchConsole?.propertyUrl;
                if (savedUrl) {
                    try {
                        if (new URL(savedUrl).hostname !== 'docs.google.com') return savedUrl;
                    } catch { return savedUrl; }
                }
                const resource = (project.resources || []).find(item => /search\s*console|\bgsc\b/i.test(item.name || ''));
                if (resource?.url) {
                    try {
                        if (new URL(resource.url).hostname === 'docs.google.com') return '';
                    } catch { /* Leave malformed saved values for manual correction. */ }
                    return resource.url;
                }
                return '';
            }
        })
    });
})(window);
