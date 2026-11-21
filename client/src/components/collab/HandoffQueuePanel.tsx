import React, { useState } from 'react';
import type { AdapterHealth, Dispatch } from '../../types';
import { api } from '../../api/client';
import { CopyIcon, ExternalIcon, SendIcon } from '../Icons';

interface HandoffQueuePanelProps {
  dispatches: Dispatch[];
  adapters: AdapterHealth[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const HandoffQueuePanel: React.FC<HandoffQueuePanelProps> = ({
  dispatches,
  adapters,
  onRefresh,
  onNotify,
}) => {
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [expandedPackets, setExpandedPackets] = useState<Record<string, boolean>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [showBridgeSetup, setShowBridgeSetup] = useState(false);

  const pending = dispatches.filter((d) => d.status === 'awaiting_handoff' || d.status === 'dispatched' || d.status === 'queued');
  const recent = dispatches.filter((d) => d.status === 'responded' || d.status === 'failed').slice(0, 6);
  const bridge = adapters.find((a) => a.kind === 'browser_bridge');
  const pairingToken = bridge?.details?.pairingToken ? String(bridge.details.pairingToken) : '';

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(`Copied ${label} to clipboard.`);
    } catch {
      onNotify(`Could not access clipboard — select text manually.`, true);
    }
  };

  const handleSubmitReply = async (dispatch: Dispatch) => {
    const text = (replyDrafts[dispatch.id] || '').trim();
    if (!text) return;
    setSubmittingId(dispatch.id);
    try {
      const res = await api.respondDispatch(dispatch.id, text);
      setReplyDrafts((prev) => ({ ...prev, [dispatch.id]: '' }));
      onNotify(
        `Delivered ${dispatch.agentName}'s real response${
          res.downstreamDispatches.length > 0
            ? ` · routed ${res.downstreamDispatches.length} cross-agent follow-up(s)`
            : ''
        }.`,
      );
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to deliver reply', true);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="bridge-info-box">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>Subscription Bridge</div>
          <span className={`badge ${(bridge?.connectedTargets ?? 0) > 0 ? 'badge-running' : 'badge-planned'}`}>
            {bridge?.connectedTargets ?? 0} live tab(s)
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Zero API keys or CLIs. Bind live Claude.ai / Gemini tabs with the Chrome Companion Bridge, or use transparent 1-click Handoff below.
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setShowBridgeSetup((s) => !s)}>
          {showBridgeSetup ? 'Hide Bridge Token' : 'Show Companion Bridge Token'}
        </button>

        {showBridgeSetup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Load <code className="mono">browser-bridge/</code> as an unpacked Chrome extension and paste this token:
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input mono" readOnly value={pairingToken} style={{ fontSize: 11.5, padding: '4px 7px' }} />
              <button type="button" className="btn btn-sm" onClick={() => copyText(pairingToken, 'bridge token')}>
                <CopyIcon size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 12px' }}>
          <h3>Queue is clear</h3>
          <p>Mention an agent (e.g. @Atlas or @Vega) or delegate a task to dispatch an effort-enforced Context Packet.</p>
        </div>
      ) : (
        pending.map((d) => {
          const isExpanded = Boolean(expandedPackets[d.id]);
          return (
            <div key={d.id} className={`handoff-card ${d.status}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{d.agentName}</div>
                <span className="badge badge-handoff">
                  {d.status === 'dispatched' ? 'Waiting on Live Tab' : 'Awaiting Handoff'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <span className={`badge badge-${d.provider}`}>
                  {d.provider.toUpperCase()} · {d.model}
                </span>
                <span className="badge badge-effort">{d.enforcedEffort}</span>
                <span className={`badge mono ${d.packetMode === 'delta' ? 'badge-running' : ''}`}>
                  {d.packetMode === 'delta' ? `DELTA ~${d.estimatedTokens}t` : `BOOT ~${d.estimatedTokens}t`}
                </span>
                {d.savedTokensEstimate > 0 && (
                  <span className="badge badge-running mono">−{d.savedTokensEstimate}t saved</span>
                )}
                <span className="badge">#{d.channelName}</span>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => copyText(d.contextPacket, `${d.agentName}'s Context Packet`)}
                >
                  <CopyIcon size={12} /> Copy Packet
                </button>
                {d.conversationUrl && (
                  <a
                    href={d.conversationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    <ExternalIcon size={12} /> Open {d.provider === 'gemini' ? 'Gemini' : 'Claude'}
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setExpandedPackets((p) => ({ ...p, [d.id]: !p[d.id] }))}
                >
                  {isExpanded ? 'Hide Packet' : 'Inspect'}
                </button>
              </div>

              {isExpanded && <pre className="packet-preview">{d.contextPacket}</pre>}

              <div className="field-group">
                <textarea
                  className="textarea"
                  style={{ minHeight: 68, fontSize: 12.5 }}
                  placeholder={`Paste ${d.agentName}'s real response from ${d.provider}... (@mentions & [DELEGATE ...] parse automatically)`}
                  value={replyDrafts[d.id] || ''}
                  onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      await api.cancelDispatch(d.id);
                      onRefresh();
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={submittingId === d.id || !(replyDrafts[d.id] || '').trim()}
                    onClick={() => handleSubmitReply(d)}
                  >
                    <SendIcon size={12} /> {submittingId === d.id ? 'Routing…' : `Post as ${d.agentName}`}
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}

      {recent.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="channel-section-header" style={{ paddingLeft: 2 }}>
            Recent Dispatches
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {recent.map((r) => (
              <div key={r.id} className="roster-item" style={{ padding: '6px 9px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{r.agentName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    #{r.channelName} · {r.enforcedEffort}
                  </div>
                </div>
                <span className={`badge ${r.status === 'responded' ? 'badge-running' : 'badge-danger'}`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
