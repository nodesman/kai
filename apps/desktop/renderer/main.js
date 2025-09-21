const selectBtn = document.getElementById('selectProject');
const startConvBtn = document.getElementById('startConversation');
const projectRootEl = document.getElementById('projectRoot');
const changesEl = document.getElementById('changes');
const filePathEl = document.getElementById('filePath');
const diffEl = document.getElementById('diff');
const applyBtn = document.getElementById('apply');
const statusEl = document.getElementById('status');
const sampleBtn = document.getElementById('populateSample');
const conversationMetaEl = document.getElementById('conversationMeta');
const messagesEl = document.getElementById('messages');
const messageInputEl = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');

let projectRoot = null;
let conversationPath = null;

selectBtn.addEventListener('click', async () => {
  if (!window.kai || !window.kai.selectProject) {
    statusEl.textContent = 'Preload not initialized. Please restart the app.';
    statusEl.style.color = '#b91c1c';
    return;
  }
  projectRoot = await window.kai.selectProject();
  projectRootEl.textContent = projectRoot || '';
});

applyBtn.addEventListener('click', async () => {
  statusEl.textContent = '';
  const filePath = filePathEl.value.trim();
  const diff = diffEl.value;
  if (!projectRoot) {
    statusEl.textContent = 'Pick a project first';
    statusEl.style.color = '#b91c1c';
    return;
  }
  if (!filePath || !diff.trim()) {
    statusEl.textContent = 'Provide file path and diff';
    statusEl.style.color = '#b91c1c';
    return;
  }
  const res = await window.kai.applyDiff({ projectRoot, filePath, diff });
  if (res?.ok) {
    statusEl.textContent = res.message || 'Applied (stub)';
    statusEl.style.color = '#065f46';
  } else {
    statusEl.textContent = (res && res.message) || 'Failed';
    statusEl.style.color = '#b91c1c';
  }
});

sampleBtn.addEventListener('click', () => {
  if (!filePathEl.value) filePathEl.value = 'src/example.ts';
  diffEl.value = `--- a/src/example.ts\n+++ b/src/example.ts\n@@\n-export const x = 1;\n+export const x = 2;\n`;
});

// Mock pending changes list (will be replaced with real data later)
changesEl.innerHTML = '';
['src/example.ts', 'src/lib/foo.ts'].forEach((p) => {
  const li = document.createElement('li');
  li.textContent = `~ ${p}`;
  changesEl.appendChild(li);
});

// Conversation controls
startConvBtn.addEventListener('click', async () => {
  if (!projectRoot) {
    projectRoot = await window.kai.selectProject();
    projectRootEl.textContent = projectRoot || '';
  }
  if (!projectRoot) return;

  const res = await window.kai.startConversation({ projectRoot });
  if (res?.ok) {
    conversationPath = res.conversationPath;
    conversationMetaEl.textContent = conversationPath;
    await loadAndRenderConversation();
  } else {
    conversationMetaEl.textContent = res?.message || 'Failed to start conversation';
  }
});

sendMessageBtn.addEventListener('click', async () => {
  const text = messageInputEl.value.trim();
  if (!text || !conversationPath) return;
  await window.kai.appendMessage({
    conversationPath,
    type: 'request',
    role: 'user',
    content: text,
  });
  messageInputEl.value = '';
  await loadAndRenderConversation();
});

async function loadAndRenderConversation() {
  if (!conversationPath) return;
  const res = await window.kai.loadConversation({ conversationPath });
  if (!res?.ok) {
    messagesEl.textContent = res?.message || 'Failed to load conversation';
    return;
  }
  renderMessages(res.entries || []);
}

function renderMessages(entries) {
  messagesEl.innerHTML = '';
  entries.forEach((e) => {
    const div = document.createElement('div');
    const role = e.role || (e.type === 'request' ? 'user' : e.type === 'response' ? 'assistant' : 'system');
    div.textContent = `${role}: ${e.content || e.error || ''}`;
    div.style.marginBottom = '6px';
    if (role === 'user') div.style.color = '#111827';
    if (role === 'assistant') div.style.color = '#1f2937';
    if (role === 'system') div.style.color = '#6b7280';
    messagesEl.appendChild(div);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
