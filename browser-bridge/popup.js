async function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'ACOS_STATUS' }, (res) => {
    const el = document.getElementById('status');
    if (!res) return;
    el.innerHTML = res.connected
      ? `<span class="ok">● Connected</span> · ${res.bindings.length} tab(s) bound`
      : `<span class="off">○ Disconnected</span> · Paste pairing token below`;
  });

  try {
    const r = await fetch('http://localhost:3001/api/org');
    const data = await r.json();
    const sel = document.getElementById('agentSelect');
    sel.innerHTML = '';
    for (const a of data.agents.filter((x) => x.lifecycleState !== 'position_open')) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.name} (${a.provider}/${a.model})`;
      sel.appendChild(opt);
    }
  } catch {
    // server offline
  }
}

document.getElementById('connectBtn').addEventListener('click', () => {
  const token = document.getElementById('token').value.trim();
  chrome.runtime.sendMessage({ type: 'ACOS_CONNECT', token }, () => setTimeout(refreshStatus, 400));
});

document.getElementById('bindBtn').addEventListener('click', async () => {
  const agentId = document.getElementById('agentSelect').value;
  if (!agentId) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage(
    { type: 'ACOS_BIND_TAB', agentId, tabId: tab.id, tabUrl: tab.url || '', tabTitle: tab.title || '' },
    () => setTimeout(refreshStatus, 300),
  );
});

refreshStatus();
