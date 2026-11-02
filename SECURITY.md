# Security notes

- Client and project records stay on this computer. The app encrypts its local data file with the operating system's secure storage. Existing plaintext records are migrated when the updated app first opens them.
- Local encryption protects the file from other Windows user accounts. It does not protect data from malware running as the same signed-in user or from someone using an unlocked account.
- The app bundles its scripts, CSS, icons, and fonts locally. It does not load third-party JavaScript or styling assets at startup, and it does not send telemetry.
- When you run a report, the app opens the configured Google Apps Script web app in the selected Chrome profile. Google receives the spreadsheet ID and report settings needed to run it. Restrict each Apps Script deployment to the intended account or organization and configure it to execute as the user accessing it.
- Do not commit the local app data file, exported workbooks, or screenshots containing client names, emails, spreadsheet IDs, or Apps Script URLs.
