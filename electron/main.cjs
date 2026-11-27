/**
 * STRANGE — Lightweight Electron Main Process for Windows 10 (6 GB RAM optimized)
 *
 * Security & Hardware Design:
 * - contextIsolation: true, nodeIntegration: false, sandbox: true
 * - Uses Electron safeStorage (Windows DPAPI) to encrypt credentials at rest
 * - Runs the local Node/Express + local JSON storage backend without requiring system Node.js or any database
 * - Restricts external desktop app launching to explicitly allowlisted protocols/targets
 */

const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Lenovo G570 / 6 GB RAM optimization: keep GPU/background footprint low
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

let mainWindow = null;
let serverProcess = null;
const SERVER_PORT = Number(process.env.STRANGE_PORT || 3000);

function getVaultFilePath() {
  return path.join(app.getPath('userData'), 'strange-vault.json');
}

function readEncryptedVault() {
  const filePath = getVaultFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeEncryptedVault(data) {
  const filePath = getVaultFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadSecretsIntoEnv() {
  if (!safeStorage.isEncryptionAvailable()) return {};
  const vault = readEncryptedVault();
  const envPatch = {};
  for (const [key, b64] of Object.entries(vault)) {
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(String(b64), 'base64'));
      envPatch[key] = decrypted;
    } catch {
      // skip corrupted entry
    }
  }
  return envPatch;
}

function startEmbeddedBackend() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const decryptedSecrets = loadSecretsIntoEnv();

  const serverEntry = path.join(__dirname, '..', 'server.ts');
  const env = {
    ...process.env,
    ...decryptedSecrets,
    NODE_ENV: 'production',
    PORT: String(SERVER_PORT),
    STRANGE_DATA_DIR: dataDir,
  };

  // Spawn bundled Node runtime with tsx/server entry
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#07090D',
    title: 'STRANGE — Personal AI Operator',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single-instance lock to prevent RAM duplication on 6 GB laptops
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startEmbeddedBackend();
    setTimeout(createWindow, 1200);
  });
}

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

// --- Secure IPC Handlers (Electron safeStorage via Windows DPAPI) ---
const ALLOWED_SECRET_KEYS = new Set([
  'GEMINI_API_KEY',
  'WHOP_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_TOKEN',
]);

ipcMain.handle('strange:vault-available', () => {
  return safeStorage.isEncryptionAvailable();
});

ipcMain.handle('strange:vault-set', (_event, key, value) => {
  if (!ALLOWED_SECRET_KEYS.has(key) || typeof value !== 'string') {
    throw new Error('Disallowed credential key.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS credential encryption (Windows DPAPI) is unavailable.');
  }
  const vault = readEncryptedVault();
  vault[key] = safeStorage.encryptString(value).toString('base64');
  writeEncryptedVault(vault);
  return { ok: true };
});

ipcMain.handle('strange:vault-delete', (_event, key) => {
  if (!ALLOWED_SECRET_KEYS.has(key)) throw new Error('Disallowed credential key.');
  const vault = readEncryptedVault();
  delete vault[key];
  writeEncryptedVault(vault);
  return { ok: true };
});

ipcMain.handle('strange:open-external', async (_event, url) => {
  const parsed = new URL(String(url));
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http/https URLs may be opened externally.');
  }
  await shell.openExternal(parsed.toString());
  return { ok: true };
});
