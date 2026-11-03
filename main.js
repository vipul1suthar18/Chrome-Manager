const { app, BrowserWindow, ipcMain, Menu, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');
const crypto = require('crypto');

const DATA_PATH = path.join(app.getPath('userData'), 'data.json');
const DATA_MAGIC = Buffer.from('SEO-WORKSPACE-ENCRYPTED-1\n');
const APP_PAGE_PATH = path.join(__dirname, 'src', 'index.html');
const reportDownloadSessions = new Map();
let mainWindow = null;
let dataWriteQueue = Promise.resolve();

async function assertSecureStorageAvailable() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('Secure local storage is unavailable. Your saved data was not changed.');
  }
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function'
    ? safeStorage.getSelectedStorageBackend()
    : '';
  if (backend === 'basic_text' || backend === 'unknown') {
    throw new Error('The operating system does not provide secure local storage. Your saved data was not changed.');
  }
}

function validateAppData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.clients)) {
    throw new Error('Saved data has an invalid format. It was not changed.');
  }
  for (const client of data.clients) {
    if (!client || typeof client !== 'object' || Array.isArray(client) || !Array.isArray(client.projects)) {
      throw new Error('Saved data has an invalid client record. It was not changed.');
    }
    for (const project of client.projects) {
      if (!project || typeof project !== 'object' || Array.isArray(project) ||
          (project.resources !== undefined && !Array.isArray(project.resources))) {
        throw new Error('Saved data has an invalid project record. It was not changed.');
      }
    }
  }
  let serialized;
  try { serialized = JSON.stringify(data); }
  catch { throw new Error('Saved data could not be serialized. It was not changed.'); }
  if (Buffer.byteLength(serialized, 'utf8') > 10 * 1024 * 1024) {
    throw new Error('The local data file is too large to save safely.');
  }
  return serialized;
}

async function writeEncryptedAppData(data) {
  const write = async () => {
    await assertSecureStorageAvailable();
    const serialized = validateAppData(data);
    const encrypted = Buffer.concat([DATA_MAGIC, await safeStorage.encryptStringAsync(serialized)]);
    const temporaryPath = DATA_PATH + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporaryPath, encrypted, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryPath, DATA_PATH);
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Keep the original file intact. */ }
      throw error;
    }
  };
  const pendingWrite = dataWriteQueue.then(write);
  dataWriteQueue = pendingWrite.catch(() => {});
  return pendingWrite;
}

async function readAppData() {
  await assertSecureStorageAvailable();
  if (!fs.existsSync(DATA_PATH)) {
    const emptyData = { clients: [] };
    await writeEncryptedAppData(emptyData);
    return emptyData;
  }
  const fileContents = fs.readFileSync(DATA_PATH);
  const isEncrypted = fileContents.subarray(0, DATA_MAGIC.length).equals(DATA_MAGIC);
  let serialized;
  if (isEncrypted) {
    try {
      const decrypted = await safeStorage.decryptStringAsync(fileContents.subarray(DATA_MAGIC.length));
      serialized = decrypted.result;
    }
    catch { throw new Error('Saved data could not be unlocked. It has not been changed.'); }
  } else {
    serialized = fileContents.toString('utf8');
  }
  let data;
  try { data = JSON.parse(serialized); }
  catch {
    throw new Error('Saved data is unreadable. It has not been changed.');
  }
  validateAppData(data);
  if (!isEncrypted) await writeEncryptedAppData(data);
  return data;
}

function isAppPageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'file:') return false;
    const targetPath = path.resolve(fileURLToPath(parsed));
    const expectedPath = path.resolve(APP_PAGE_PATH);
    return process.platform === 'win32'
      ? targetPath.toLowerCase() === expectedPath.toLowerCase()
      : targetPath === expectedPath;
  } catch { return false; }
}

function assertTrustedIpcSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
      !isAppPageUrl(event.senderFrame.url)) {
    throw new Error('This request is not from the SEO Workspace app page.');
  }
}

function getValidatedChromeProfile(profileDir) {
  if (typeof profileDir !== 'string' || profileDir.length > 64) throw new Error('Choose a valid Chrome profile.');
  const profile = getChromeProfiles().find(item => item.directory === profileDir);
  if (!profile) throw new Error('The selected Chrome profile is unavailable.');
  const userDataPath = path.resolve(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
  const profilePath = path.resolve(userDataPath, profile.directory);
  if (!profilePath.startsWith(userDataPath + path.sep) || !fs.existsSync(profilePath)) {
    throw new Error('The selected Chrome profile path is invalid.');
  }
  return { ...profile, path: profilePath };
}

function validateExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 8192) throw new Error('Enter a valid web address.');
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('Enter a valid web address.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('Only public HTTP or HTTPS links can be opened.');
  }
  return parsed.toString();
}

function safeFolderName(value) {
  const cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim();
  return cleaned || 'Unsorted';
}

function localDateFolderName(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function getProfileDownloadDirectory(profileDir) {
  const profile = getValidatedChromeProfile(profileDir);
  try {
    const preferences = JSON.parse(fs.readFileSync(path.join(profile.path, 'Preferences'), 'utf8'));
    const configured = preferences.download?.default_directory;
    if (configured && path.isAbsolute(configured)) return path.resolve(configured);
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
  const id = crypto.randomUUID();
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
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged
    },
    title: 'SEO Workspace'
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAppPageUrl(navigationUrl)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.loadFile(APP_PAGE_PATH);
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
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];
  const userDataPath = path.resolve(localAppData, 'Google', 'Chrome', 'User Data');
  const localStatePath = path.join(userDataPath, 'Local State');
  if (!fs.existsSync(localStatePath)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const infoCache = json.profile?.info_cache || {};
    return Object.keys(infoCache).filter(directory => {
      if (!/^[A-Za-z0-9 _.-]{1,64}$/.test(directory) || directory === '.' || directory === '..') return false;
      const profilePath = path.resolve(userDataPath, directory);
      return profilePath.startsWith(userDataPath + path.sep) && fs.existsSync(profilePath);
    }).map(directory => ({ directory, name: String(infoCache[directory].name || directory).slice(0, 120) }));
  } catch (error) {
    console.error('Error reading Chrome profiles:', error.message);
    return [];
  }
}

// IPC is accepted only from the main frame of the local app page.
ipcMain.handle('get-data', event => {
  assertTrustedIpcSender(event);
  return readAppData();
});

ipcMain.handle('save-data', async (event, data) => {
  assertTrustedIpcSender(event);
  try { await writeEncryptedAppData(data); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-chrome-profiles', event => {
  assertTrustedIpcSender(event);
  return getChromeProfiles();
});

ipcMain.handle('launch-url-with-profile', (event, params) => {
  assertTrustedIpcSender(event);
  try {
    if (!params || typeof params !== 'object') throw new Error('Invalid launch request.');
    const url = validateExternalUrl(params.url);
    const profile = getValidatedChromeProfile(params.profileDir);
    const chromePath = findChrome();
    if (!chromePath) return { success: false, error: 'Chrome executable not found.' };
    spawn(chromePath, ['--profile-directory=' + profile.directory, url], { detached: true, stdio: 'ignore' }).unref();
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('start-report-download-organization', (event, params) => {
  assertTrustedIpcSender(event);
  try {
    if (!params || typeof params !== 'object') throw new Error('Invalid download request.');
    if (reportDownloadSessions.size >= 20) throw new Error('Too many downloads are being tracked. Wait for a current download to finish.');
    if (typeof params.clientName !== 'string' || typeof params.projectName !== 'string' ||
        params.clientName.length > 160 || params.projectName.length > 160) {
      throw new Error('Client and project names must be 160 characters or fewer.');
    }
    getValidatedChromeProfile(params.profileDir);
    return startReportDownloadOrganization(params);
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-report-download-status', (event, id) => {
  assertTrustedIpcSender(event);
  if (typeof id !== 'string' || id.length > 100) return { status: 'unknown', message: 'Download tracking is no longer available.' };
  const downloadSession = reportDownloadSessions.get(id);
  if (!downloadSession) return { status: 'unknown', message: 'Download tracking is no longer available.' };
  const { status, message, savedPath, destinationDirectory } = downloadSession;
  if (status === 'saved' || status === 'error' || status === 'not-found') reportDownloadSessions.delete(id);
  return { status, message, savedPath, destinationDirectory };
});

ipcMain.handle('cancel-report-download-organization', (event, id) => {
  assertTrustedIpcSender(event);
  if (typeof id !== 'string' || id.length > 100) return { success: true };
  const downloadSession = reportDownloadSessions.get(id);
  if (!downloadSession) return { success: true };
  clearInterval(downloadSession.timer);
  reportDownloadSessions.delete(id);
  return { success: true };
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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
