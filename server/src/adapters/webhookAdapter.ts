import crypto from 'node:crypto';
import type { AdapterDispatchResult, AdapterHealth, DispatchEnvelope, ProviderAdapter } from './types.js';

/**
 * Authenticated Webhook / External Subscription Relay Adapter.
 * Dispatches signed JSON envelopes via HTTP POST to an external user-configured relay
 * (e.g., self-hosted bot bridge, Slack/Discord relay, or workflow automation) and awaits
 * a real callback at `POST /api/adapters/callback/:dispatchId`.
 */
export class WebhookRelayAdapter implements ProviderAdapter {
  public readonly kind = 'webhook_relay' as const;

  public async dispatch(envelope: DispatchEnvelope): Promise<AdapterDispatchResult> {
    const url = envelope.adapterConfig.webhookUrl?.trim();
    if (!url) {
      return {
        status: 'awaiting_handoff',
        note: `No webhookUrl configured for ${envelope.agentName}. Fell back transparently to Human-Assisted Handoff.`,
      };
    }

    const payload = JSON.stringify({
      dispatchId: envelope.dispatchId,
      agentId: envelope.agentId,
      agentName: envelope.agentName,
      provider: envelope.provider,
      model: envelope.model,
      enforcedEffort: envelope.enforcedEffort,
      channelId: envelope.channelId,
      contextPacket: envelope.contextPacket,
      callbackPath: `/api/adapters/callback/${envelope.dispatchId}`,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Company-Dispatch': envelope.dispatchId,
    };

    if (envelope.adapterConfig.webhookSecret) {
      const sig = crypto
        .createHmac('sha256', envelope.adapterConfig.webhookSecret)
        .update(payload)
        .digest('hex');
      headers['X-Agent-Company-Signature'] = `sha256=${sig}`;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          status: 'failed',
          note: `Webhook relay responded HTTP ${res.status}.`,
          errorMessage: `Webhook endpoint returned HTTP ${res.status}`,
        };
      }

      return {
        status: 'dispatched',
        note: `Dispatched signed envelope to webhook relay (${url}). Awaiting asynchronous callback.`,
      };
    } catch (err) {
      return {
        status: 'awaiting_handoff',
        note: `Webhook unreachable (${err instanceof Error ? err.message : 'network error'}). Queued transparently for Human-Assisted Handoff.`,
      };
    }
  }

  public getHealth(): AdapterHealth {
    return {
      kind: this.kind,
      name: 'Authenticated Webhook Relay',
      description:
        'Sends HMAC-signed message envelopes to external self-hosted messaging relays and ingests real responses via callback endpoint.',
      automated: true,
      connectedTargets: 0,
      details: { callbackEndpoint: '/api/adapters/callback/:dispatchId' },
    };
  }

  public isAgentConnected(): boolean {
    return false;
  }
}
