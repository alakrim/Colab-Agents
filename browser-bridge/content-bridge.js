// Content script injected into authenticated Claude.ai and Gemini.google.com tabs.
// Inserts dispatched Context Packets into the active subscription chat composer
// and observes DOM settlement to relay the real model response back to Agent Company OS.

function detectProvider() {
  if (location.hostname.includes('claude.ai')) return 'claude';
  if (location.hostname.includes('gemini.google.com')) return 'gemini';
  return 'unknown';
}

function getComposer(provider) {
  if (provider === 'claude') {
    return document.querySelector('div[contenteditable="true"].ProseMirror, div[contenteditable="true"]');
  }
  if (provider === 'gemini') {
    return document.querySelector('rich-textarea div[contenteditable="true"], div[contenteditable="true"][role="textbox"]');
  }
  return null;
}

function getSendButton(provider) {
  if (provider === 'claude') {
    return document.querySelector('button[aria-label*="Send"], button[type="submit"]');
  }
  if (provider === 'gemini') {
    return document.querySelector('button[aria-label*="Send"], button.send-button');
  }
  return null;
}

function getLatestAssistantText(provider) {
  const selector =
    provider === 'claude'
      ? '[data-is-streaming], .font-claude-message, [data-testid*="message"]'
      : 'model-response .markdown, message-content';
  const nodes = Array.from(document.querySelectorAll(selector));
  if (nodes.length === 0) return '';
  return (nodes[nodes.length - 1].innerText || '').trim();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'ACOS_DELIVER_PROMPT') return false;

  const provider = detectProvider();
  const composer = getComposer(provider);
  if (!composer) {
    sendResponse({ ok: false, error: `Could not locate active ${provider} chat composer on this tab.` });
    return true;
  }

  const baselineText = getLatestAssistantText(provider);
  composer.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, msg.prompt);
  composer.dispatchEvent(new InputEvent('input', { bubbles: true }));

  setTimeout(() => {
    const sendBtn = getSendButton(provider);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }

    // Wait for response text to appear and stabilize for 2.5 seconds
    let lastText = baselineText;
    let stableTicks = 0;
    let elapsed = 0;
    const poll = setInterval(() => {
      elapsed += 1000;
      const cur = getLatestAssistantText(provider);
      if (cur && cur !== baselineText) {
        if (cur === lastText) {
          stableTicks += 1;
        } else {
          lastText = cur;
          stableTicks = 0;
        }
        if (stableTicks >= 3) {
          clearInterval(poll);
          chrome.runtime.sendMessage({
            type: 'ACOS_TAB_RESPONSE',
            dispatchId: msg.dispatchId,
            responseText: cur,
          });
        }
      }
      if (elapsed >= 120000) {
        clearInterval(poll);
      }
    }, 1000);
  }, 350);

  sendResponse({ ok: true });
  return true;
});
