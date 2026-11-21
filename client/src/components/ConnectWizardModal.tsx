import React, { useState } from 'react';
import type { AdapterHealth, GitHubRepo } from '../types';
import { api } from '../api/client';
import { CloseIcon, CopyIcon, ExternalIcon } from './Icons';

interface ConnectWizardModalProps {
  adapters: AdapterHealth[];
  githubRepos: GitHubRepo[];
  onClose: () => void;
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const ConnectWizardModal: React.FC<ConnectWizardModalProps> = ({
  adapters,
  githubRepos,
  onClose,
  onRefresh,
  onNotify,
}) => {
  const [repoInput, setRepoInput] = useState('');
  const bridge = adapters.find((a) => a.kind === 'browser_bridge');
  const pairingToken = bridge?.details?.pairingToken ? String(bridge.details.pairingToken) : '';
  const boundTabs = Array.isArray(bridge?.details?.boundTabs)
    ? (bridge.details.boundTabs as Array<{ agentId: string; provider: string; tabUrl: string }>)
    : [];

  const claudeConnected = boundTabs.some((t) => t.provider === 'claude');
  const geminiConnected = boundTabs.some((t) => t.provider === 'gemini');

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(pairingToken);
      onNotify('Copied Chrome Bridge pairing token!');
    } catch {
      onNotify('Copy failed — highlight and copy the token manually.', true);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Quick Setup: Connect Claude, Gemini &amp; GitHub</h2>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Zero API keys or CLIs. Works immediately via 1-click Handoff, or automate with the Chrome Bridge.
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="setup-grid">
            <div className="setup-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="badge badge-claude">Claude Subscription</span>
                <span className={`badge ${claudeConnected ? 'badge-running' : 'badge-planned'}`}>
                  {claudeConnected ? 'Live Tab Bound' : 'Handoff Ready'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Sign into your normal Claude web account. Recommended: attach your GitHub repo in Claude Projects for ultra-low token usage.
              </div>
              <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className="btn btn-sm" style={{ textDecoration: 'none' }}>
                <ExternalIcon size={12} /> Open claude.ai
              </a>
            </div>

            <div className="setup-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="badge badge-gemini">Gemini Subscription</span>
                <span className={`badge ${geminiConnected ? 'badge-running' : 'badge-planned'}`}>
                  {geminiConnected ? 'Live Tab Bound' : 'Handoff Ready'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Sign into your normal Gemini web account. Recommended: import your GitHub repository directly in Gemini so only small deltas are sent.
              </div>
              <a href="https://gemini.google.com/app" target="_blank" rel="noreferrer" className="btn btn-sm" style={{ textDecoration: 'none' }}>
                <ExternalIcon size={12} /> Open gemini.google.com
              </a>
            </div>
          </div>

          <div className="setup-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 13 }}>Optional: Automate Tabs with Chrome Companion Bridge</strong>
              <span className={`badge ${boundTabs.length > 0 ? 'badge-running' : ''}`}>
                {boundTabs.length} live tab(s)
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              1. Open <code className="mono">chrome://extensions</code> → enable <strong>Developer Mode</strong> → <strong>Load unpacked</strong> → choose <code className="mono">browser-bridge/</code>.<br />
              2. Paste this pairing token into the extension popup, then click <strong>Bind Active Tab</strong> on your Claude and Gemini tabs.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input mono" readOnly value={pairingToken} style={{ fontSize: 12 }} />
              <button type="button" className="btn btn-primary btn-sm" onClick={copyToken}>
                <CopyIcon size={12} /> Copy Token
              </button>
            </div>
          </div>

          <div className="setup-card">
            <strong style={{ fontSize: 13 }}>Connected GitHub Repositories ({githubRepos.length})</strong>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {githubRepos.map((r) => (
                <span key={r.id} className="badge mono">
                  {r.fullName} ({r.defaultBranch})
                </span>
              ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!repoInput.trim()) return;
                try {
                  await api.connectGitHubRepo({ fullName: repoInput.trim() });
                  setRepoInput('');
                  onNotify(`Connected ${repoInput.trim()}!`);
                  onRefresh();
                } catch (err) {
                  onNotify(err instanceof Error ? err.message : 'Invalid repo', true);
                }
              }}
              style={{ display: 'flex', gap: 6 }}
            >
              <input
                className="input mono"
                placeholder="owner/repo (e.g. alakrim/Colab-Agents)"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
              />
              <button type="submit" className="btn btn-sm">
                Add Repo
              </button>
            </form>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done — Ready to Work
          </button>
        </div>
      </div>
    </div>
  );
};
