const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DATA_PATH = path.join(app.getPath('userData'), 'data.json');
const reportDownloadSessions = new Map();

function safeFolderName(value) {
  const cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim();
  return cleaned || 'Unsorted';
}

function localDateFolderName(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function getProfileDownloadDirectory(profileDir) {
  const profilePath = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', profileDir || 'Default');
  try {
    const preferences = JSON.parse(fs.readFileSync(path.join(profilePath, 'Preferences'), 'utf8'));
    const configured = preferences.download?.default_directory;
    if (configured && path.isAbsolute(configured)) return configured;
  } catch { /* Use Windows' Downloads folder when Chrome has no custom location. */ }
  return app.getPath('downloads');
}

function reportFilenameMatchesProject(filename, projectName) {
  const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fullName = normalized(projectName);
  const candidate = normalized(path.basename(filename, path.extname(filename)));
  if (fullName && candidate.includes(fullName)) return true;
  if (fullName.length >= 8) {
    const prefix = candidate.slice(0, fullName.length);
    const previous = Array.from({ length: prefix.length + 1 }, (_, index) => index);
    for (let row = 1; row <= fullName.length; row += 1) {
      const current = [row];
      for (let column = 1; column <= prefix.length; column += 1) {
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + (fullName[row - 1] === prefix[column - 1] ? 0 : 1)
        );
      }
      previous.splice(0, previous.length, ...current);
    }
    if (previous[prefix.length] <= Math.max(1, Math.floor(fullName.length * 0.04))) return true;
  }
  const ignored = new Set(['the', 'company', 'group', 'new', 'old', 'ltd', 'limited']);
  const words = String(projectName || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const useful = words.filter(word => !ignored.has(word));
  const matched = useful.filter(word => candidate.includes(normalized(word))).length;
  return useful.length > 0 && matched >= (useful.length > 1 ? 2 : 1);
}

function startReportDownloadOrganization({ clientName, projectName, profileDir }) {
  const sourceDirectory = getProfileDownloadDirectory(profileDir);
  fs.mkdirSync(sourceDirectory, { recursive: true });
  const destinationDirectory = path.join(
    app.getPath('downloads'),
    'Search Console Reports',
    localDateFolderName(),
    'Project',
    safeFolderName(clientName),
    safeFolderName(projectName)
  );
  fs.mkdirSync(destinationDirectory, { recursive: true });

  const knownFiles = new Set(fs.readdirSync(sourceDirectory));
  const id = require('crypto').randomUUID();
  const session = {
    id, clientName, projectName, sourceDirectory, destinationDirectory,
    startedAt: Date.now(), knownFiles, stable: new Map(), status: 'waiting',
    message: 'Waiting for the Google Sheets workbook download…',
    timer: null, expiresAt: Date.now() + 2 * 60 * 60 * 1000
  };

  session.timer = setInterval(() => {
    try {
      const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true });
      const partialNames = new Set(entries.filter(entry => entry.isFile() && entry.name.endsWith('.crdownload')).map(entry => entry.name));
      const candidates = entries.filter(entry => entry.isFile() && /\.xlsx$/i.test(entry.name) && !knownFiles.has(entry.name))
        .map(entry => {
          const filePath = path.join(sourceDirectory, entry.name);
          const stats = fs.statSync(filePath);
          return { name: entry.name, path: filePath, size: stats.size, mtimeMs: stats.mtimeMs };
        })
        .filter(file => file.mtimeMs >= session.startedAt - 5000 && !partialNames.has(file.name + '.crdownload'));

      const matching = candidates.filter(file => reportFilenameMatchesProject(file.name, projectName));
      if (matching.length === 1) {
        const file = matching[0];
        const last = session.stable.get(file.name);
        if (last && last.size === file.size && last.mtimeMs === file.mtimeMs) {
          let targetPath = path.join(destinationDirectory, file.name);
          if (fs.existsSync(targetPath)) {
            const ext = path.extname(file.name);
            const stem = path.basename(file.name, ext);
            let suffix = 2;
            while (fs.existsSync(targetPath)) targetPath = path.join(destinationDirectory, `${stem} (${suffix++})${ext}`);
          }
          try {
            fs.renameSync(file.path, targetPath);
          } catch {
            fs.copyFileSync(file.path, targetPath);
            fs.unlinkSync(file.path);
          }
          session.status = 'saved';
          session.message = 'Workbook saved to the project folder.';
          session.savedPath = targetPath;
          clearInterval(session.timer);
          return;
        }
        session.stable.set(file.name, { size: file.size, mtimeMs: file.mtimeMs });
      } else if (matching.length > 1) {
        session.message = 'Several matching spreadsheets are downloading; waiting for one to finish.';
      }
    } catch (error) {
      session.status = 'error';
      session.message = `Could not organize the downloaded workbook: ${error.message}`;
      clearInterval(session.timer);
    }

    if (Date.now() >= session.expiresAt) {
      session.status = 'not-found';
      session.message = 'The workbook was not found in Chrome’s Downloads folder. Check Chrome’s download location.';
      clearInterval(session.timer);
    }
  }, 1500);

  reportDownloadSessions.set(id, session);
  return { success: true, id, destinationDirectory };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'SEO Workspace'
  });

  win.loadFile('src/index.html');
  // win.webContents.openDevTools();
}

// Ensure data file exists
if (!fs.existsSync(DATA_PATH)) {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ clients: [] }, null, 2));
}

// Chrome Detection
function findChrome() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getChromeProfiles() {
  const localStatePath = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data/Local State');
  if (!fs.existsSync(localStatePath)) return [];

  try {
    const content = fs.readFileSync(localStatePath, 'utf8');
    const json = JSON.parse(content);
    const infoCache = json.profile.info_cache;
    const profiles = [];

    for (const key in infoCache) {
      profiles.push({
        directory: key,
        name: infoCache[key].name || key
      });
    }
    return profiles;
  } catch (err) {
    console.error('Error reading Chrome profiles:', err);
    return [];
  }
}

// IPC Handlers
ipcMain.handle('get-data', () => {
  try {
    const data = fs.readFileSync(DATA_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading data:', err);
    return { clients: [] };
  }
});

ipcMain.handle('save-data', (event, data) => {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (err) {
    console.error('Error saving data:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-chrome-profiles', () => {
  return getChromeProfiles();
});

ipcMain.handle('launch-url-with-profile', (event, { url, profileDir }) => {
  const chromePath = findChrome();
  if (!chromePath) {
    return { success: false, error: 'Chrome executable not found.' };
  }

  // Ensure the profile directory still exists in the User Data folder
  const userDataPath = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data');
  const profilePath = path.join(userDataPath, profileDir);

  if (profileDir !== 'Default' && !fs.existsSync(profilePath)) {
    return { success: false, error: `Profile directory "${profileDir}" not found.` };
  }

  const args = [`--profile-directory=${profileDir}`, url];
  spawn(chromePath, args, { detached: true, stdio: 'ignore' }).unref();
  return { success: true };
});

ipcMain.handle('start-report-download-organization', (event, params) => {
  try {
    return startReportDownloadOrganization(params || {});
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-report-download-status', (event, id) => {
  const session = reportDownloadSessions.get(id);
  if (!session) return { status: 'unknown', message: 'Download tracking is no longer available.' };
  const { status, message, savedPath, destinationDirectory } = session;
  if (status === 'saved' || status === 'error' || status === 'not-found') reportDownloadSessions.delete(id);
  return { status, message, savedPath, destinationDirectory };
});

ipcMain.handle('cancel-report-download-organization', (event, id) => {
  const session = reportDownloadSessions.get(id);
  if (!session) return { success: true };
  clearInterval(session.timer);
  reportDownloadSessions.delete(id);
  return { success: true };
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
