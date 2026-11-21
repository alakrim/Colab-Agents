import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type { AdapterDispatchResult, AdapterHealth, DispatchEnvelope, ProviderAdapter } from './types.js';

export interface BoundBrowserTab {
  agentId: string;
  provider: string;
  tabUrl: string;
  tabTitle: string;
  ws: WebSocket;
  connectedAt: string;
  lastHeartbeatAt: string;
}

export interface BridgeCallbacks {
  onResponse: (dispatchId: string, responseText: string) => void;
  onError: (dispatchId: string, errorMessage: string) => void;
  onAgentBindingChanged: (agentId: string, connected: boolean, tabUrl?: string) => void;
  onHeartbeat: (agentId: string) => void;
}

/**
 * Browser Companion Bridge Adapter.
 * Connects over authenticated localhost WebSocket (`/ws/bridge?token=...`) to the included
 * Chrome/Edge Manifest V3 Companion Extension (`browser-bridge/`).
 * Users stay signed into their own Claude.ai and Gemini.google.com subscriptions in their browser;
 * bound tabs receive real dispatches and stream back real replies autonomously.
 * If no live browser tab is bound for an agent, falls back transparently to `awaiting_handoff`.
 */
export class BrowserBridgeAdapter implements ProviderAdapter {
  public readonly kind = 'browser_bridge' as const;
  public readonly pairingToken: string;
  private boundTabs = new Map<string, BoundBrowserTab>();
  private callbacks: BridgeCallbacks | null = null;

  constructor(token?: string) {
    this.pairingToken = token || process.env.BRIDGE_PAIRING_TOKEN || `acos-${crypto.randomBytes(8).toString('hex')}`;
  }

  public setCallbacks(callbacks: BridgeCallbacks): void {
    this.callbacks = callbacks;
  }

  public handleSocketConnection(ws: WebSocket, providedToken: string | null): void {
    if (providedToken !== this.pairingToken) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid bridge pairing token.' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    const boundAgentIds = new Set<string>();
    ws.send(JSON.stringify({ type: 'welcome', status: 'authenticated' }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        const type = String(msg.type || '');

        if (type === 'bind') {
          const agentId = String(msg.agentId || '').trim();
          if (!agentId) return;
          const now = new Date().toISOString();
          const binding: BoundBrowserTab = {
            agentId,
            provider: String(msg.provider || 'unknown'),
            tabUrl: String(msg.tabUrl || ''),
            tabTitle: String(msg.tabTitle || 'Browser Tab'),
            ws,
            connectedAt: now,
            lastHeartbeatAt: now,
          };
          this.boundTabs.set(agentId, binding);
          boundAgentIds.add(agentId);
          ws.send(JSON.stringify({ type: 'bound', agentId }));
          this.callbacks?.onAgentBindingChanged(agentId, true, binding.tabUrl);
        } else if (type === 'unbind') {
          const agentId = String(msg.agentId || '');
          if (this.boundTabs.get(agentId)?.ws === ws) {
            this.boundTabs.delete(agentId);
            boundAgentIds.delete(agentId);
            this.callbacks?.onAgentBindingChanged(agentId, false);
          }
        } else if (type === 'heartbeat') {
          const agentId = String(msg.agentId || '');
          const tab = this.boundTabs.get(agentId);
          if (tab) {
            tab.lastHeartbeatAt = new Date().toISOString();
            this.callbacks?.onHeartbeat(agentId);
          }
        } else if (type === 'response') {
          const dispatchId = String(msg.dispatchId || '');
          const responseText = String(msg.responseText || '');
          if (dispatchId && responseText.trim()) {
            this.callbacks?.onResponse(dispatchId, responseText);
          }
        } else if (type === 'dispatch_error') {
          const dispatchId = String(msg.dispatchId || '');
          const errorMessage = String(msg.errorMessage || 'Browser bridge tab failed to deliver message.');
          if (dispatchId) {
            this.callbacks?.onError(dispatchId, errorMessage);
          }
        }
      } catch {
        // Ignore malformed bridge frames
      }
    });

    ws.on('close', () => {
      for (const agentId of boundAgentIds) {
        if (this.boundTabs.get(agentId)?.ws === ws) {
          this.boundTabs.delete(agentId);
          this.callbacks?.onAgentBindingChanged(agentId, false);
        }
      }
    });
  }

  public async dispatch(envelope: DispatchEnvelope): Promise<AdapterDispatchResult> {
    const tab = this.boundTabs.get(envelope.agentId);
    if (!tab || tab.ws.readyState !== 1) {
      return {
        status: 'awaiting_handoff',
        note: `No live browser tab bound to ${envelope.agentName}. Transparently queued for Human-Assisted Handoff (bind a ${envelope.provider} tab in the Companion Extension for automated relay).`,
      };
    }

    try {
      tab.ws.send(
        JSON.stringify({
          type: 'dispatch',
          dispatchId: envelope.dispatchId,
          agentId: envelope.agentId,
          agentName: envelope.agentName,
          provider: envelope.provider,
          model: envelope.model,
          enforcedEffort: envelope.enforcedEffort,
          contextPacket: envelope.contextPacket,
        }),
      );
      return {
        status: 'dispatched',
        note: `Dispatched automatically to live bound browser tab (${tab.tabUrl || tab.provider}). Waiting for real response.`,
      };
    } catch (err) {
      return {
        status: 'awaiting_handoff',
        note: `Browser bridge send failed (${err instanceof Error ? err.message : 'socket closed'}); fell back to Human-Assisted Handoff.`,
      };
    }
  }

  public isAgentConnected(agentId: string): boolean {
    const tab = this.boundTabs.get(agentId);
    return Boolean(tab && tab.ws.readyState === 1);
  }

  public getBoundTabs(): Array<{ agentId: string; provider: string; tabUrl: string; tabTitle: string; connectedAt: string; lastHeartbeatAt: string }> {
    return Array.from(this.boundTabs.values()).map((t) => ({
      agentId: t.agentId,
      provider: t.provider,
      tabUrl: t.tabUrl,
      tabTitle: t.tabTitle,
      connectedAt: t.connectedAt,
      lastHeartbeatAt: t.lastHeartbeatAt,
    }));
  }

  public getHealth(): AdapterHealth {
    const tabs = this.getBoundTabs();
    return {
      kind: this.kind,
      name: 'Browser Companion Bridge (Claude.ai & Gemini Tabs)',
      description:
        'Connects authenticated Claude.ai and Gemini.google.com browser tabs via the local Chrome Companion Extension for automated cross-provider messaging without API keys.',
      automated: true,
      connectedTargets: tabs.length,
      details: {
        wsPath: '/ws/bridge',
        pairingToken: this.pairingToken,
        boundTabs: tabs,
      },
    };
  }
}
