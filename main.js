const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DATA_PATH = path.join(app.getPath('userData'), 'data.json');

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

app.whenReady().then(() => {
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
