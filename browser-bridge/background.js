// Background service worker maintaining authenticated WebSocket connection
// between open Claude.ai / Gemini.google.com tabs and Agent Company OS server.

let socket = null;
let config = { serverUrl: 'ws://localhost:3001/ws/bridge', token: '' };
const bindings = new Map(); // agentId -> { tabId, provider, tabUrl, tabTitle }

chrome.storage.local.get(['serverUrl', 'token'], (res) => {
  if (res.serverUrl) config.serverUrl = res.serverUrl;
  if (res.token) config.token = res.token;
  if (config.token) connectSocket();
});

function connectSocket() {
  if (!config.token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const wsUrl = `${config.serverUrl}?token=${encodeURIComponent(config.token)}`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    for (const [agentId, b] of bindings.entries()) {
      socket.send(JSON.stringify({ type: 'bind', agentId, provider: b.provider, tabUrl: b.tabUrl, tabTitle: b.tabTitle }));
    }
  };

  socket.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'dispatch') {
        const binding = bindings.get(msg.agentId);
        if (!binding) {
          socket.send(JSON.stringify({ type: 'dispatch_error', dispatchId: msg.dispatchId, errorMessage: 'No tab bound to agent.' }));
          return;
        }
        chrome.tabs.sendMessage(
          binding.tabId,
          { type: 'ACOS_DELIVER_PROMPT', dispatchId: msg.dispatchId, prompt: msg.contextPacket },
          (response) => {
            if (chrome.runtime.lastError || !response?.ok) {
              socket?.send(
                JSON.stringify({
                  type: 'dispatch_error',
                  dispatchId: msg.dispatchId,
                  errorMessage: chrome.runtime.lastError?.message || response?.error || 'Could not reach tab content script.',
                }),
              );
            }
          },
        );
      }
    } catch {
      // ignore malformed frame
    }
  };

  socket.onclose = () => {
    socket = null;
  };
}

// Keep-alive heartbeats for bound tabs so active file leases renew automatically
setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  for (const agentId of bindings.keys()) {
    socket.send(JSON.stringify({ type: 'heartbeat', agentId }));
  }
}, 20000);

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [agentId, b] of bindings.entries()) {
    if (b.tabId === tabId) {
      bindings.delete(agentId);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'unbind', agentId }));
      }
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ACOS_CONNECT') {
    config = { serverUrl: msg.serverUrl || config.serverUrl, token: msg.token || '' };
    chrome.storage.local.set(config);
    if (socket) socket.close();
    connectSocket();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'ACOS_BIND_TAB') {
    const provider = msg.tabUrl.includes('claude.ai') ? 'claude' : msg.tabUrl.includes('gemini.google.com') ? 'gemini' : 'custom';
    bindings.set(msg.agentId, { tabId: msg.tabId, provider, tabUrl: msg.tabUrl, tabTitle: msg.tabTitle });
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'bind', agentId: msg.agentId, provider, tabUrl: msg.tabUrl, tabTitle: msg.tabTitle }));
    } else {
      connectSocket();
    }
    sendResponse({ ok: true, boundCount: bindings.size });
    return true;
  }

  if (msg.type === 'ACOS_TAB_RESPONSE') {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'response', dispatchId: msg.dispatchId, responseText: msg.responseText }));
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'ACOS_STATUS') {
    sendResponse({
      connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
      serverUrl: config.serverUrl,
      hasToken: Boolean(config.token),
      bindings: Array.from(bindings.entries()).map(([agentId, b]) => ({ agentId, ...b })),
    });
    return true;
  }
  return false;
});
