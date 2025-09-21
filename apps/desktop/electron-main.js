// Minimal Electron main process for Kai Desktop
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'Kai Desktop (Preview)'
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: select a project directory
ipcMain.handle('select-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// IPC: apply a diff (stub for now; will wire to Kai FileSystem.applyDiffToFile)
ipcMain.handle('apply-diff', async (_evt, payload) => {
  // payload: { projectRoot: string, filePath: string, diff: string }
  try {
    if (!payload || !payload.projectRoot || !payload.filePath || !payload.diff) {
      return { ok: false, message: 'Invalid payload for apply-diff' };
    }

    const req = createRequire(import.meta.url);
    let FileSystem;
    try {
      // Expect root to be built: bin/lib/FileSystem.js
      ({ FileSystem } = req('../../bin/lib/FileSystem.js'));
    } catch (e) {
      return { ok: false, message: 'Kai core not built. From repo root, run: npm run build' };
    }

    const fs = new FileSystem();
    const absPath = path.resolve(payload.projectRoot, payload.filePath);
    const ok = await fs.applyDiffToFile(absPath, payload.diff);
    return ok
      ? { ok: true, message: `Patched ${payload.filePath}` }
      : { ok: false, message: `Failed to apply diff to ${payload.filePath}. See .kai/logs/diff_failures.jsonl` };
  } catch (err) {
    return { ok: false, message: (err && err.message) || String(err) };
  }
});

// Helpers
function resolveCore() {
  const req = createRequire(import.meta.url);
  const core = req('../../bin/lib/FileSystem.js');
  return core;
}

function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// IPC: start a new conversation log under .kai/conversations
ipcMain.handle('start-conversation', async (_evt, payload) => {
  try {
    if (!payload?.projectRoot) return { ok: false, message: 'projectRoot required' };

    let FileSystem;
    try {
      ({ FileSystem } = resolveCore());
    } catch {
      return { ok: false, message: 'Kai core not built. From repo root, run: npm run build' };
    }

    const fs = new FileSystem();
    const convDir = path.resolve(payload.projectRoot, '.kai', 'conversations');
    await fs.ensureDirExists(convDir);
    const convPath = path.join(convDir, `conversation-${timestampName()}.jsonl`);

    // Seed with a system entry (compatible with AIClient log format)
    await fs.appendJsonlFile(convPath, {
      type: 'system',
      role: 'system',
      content: 'System: Started conversation in Kai Desktop',
      timestamp: new Date().toISOString()
    });

    return { ok: true, conversationPath: convPath };
  } catch (err) {
    return { ok: false, message: (err && err.message) || String(err) };
  }
});

// IPC: append a message to a conversation JSONL
ipcMain.handle('append-message', async (_evt, payload) => {
  try {
    if (!payload?.conversationPath || !payload?.type || !payload?.content) {
      return { ok: false, message: 'conversationPath, type, and content required' };
    }

    let FileSystem;
    try {
      ({ FileSystem } = resolveCore());
    } catch {
      return { ok: false, message: 'Kai core not built. From repo root, run: npm run build' };
    }

    const fs = new FileSystem();
    const entry = {
      type: payload.type, // 'request' | 'response' | 'system' | 'error'
      role: payload.role, // optional: 'user' | 'assistant' | 'system'
      content: payload.content,
      timestamp: new Date().toISOString()
    };
    await fs.appendJsonlFile(payload.conversationPath, entry);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err && err.message) || String(err) };
  }
});

// IPC: load conversation entries
ipcMain.handle('load-conversation', async (_evt, payload) => {
  try {
    if (!payload?.conversationPath) return { ok: false, message: 'conversationPath required' };
    let FileSystem;
    try {
      ({ FileSystem } = resolveCore());
    } catch {
      return { ok: false, message: 'Kai core not built. From repo root, run: npm run build' };
    }

    const fs = new FileSystem();
    const entries = await fs.readJsonlFile(payload.conversationPath);
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, message: (err && err.message) || String(err) };
  }
});
