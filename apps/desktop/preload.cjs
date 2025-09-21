// Preload script (CommonJS) to expose safe IPC APIs to the renderer
const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('kai', {
    selectProject: async () => ipcRenderer.invoke('select-project'),
    applyDiff: async (payload) => ipcRenderer.invoke('apply-diff', payload),
    startConversation: async (payload) => ipcRenderer.invoke('start-conversation', payload),
    appendMessage: async (payload) => ipcRenderer.invoke('append-message', payload),
    loadConversation: async (payload) => ipcRenderer.invoke('load-conversation', payload),
  });
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('Kai preload failed to initialize:', e);
}

