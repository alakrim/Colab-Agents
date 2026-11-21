import type { AdapterDispatchResult, AdapterHealth, DispatchEnvelope, ProviderAdapter } from './types.js';

/**
 * Transparent Human-Assisted Subscription Handoff Adapter.
 * Works immediately with any Claude.ai, Gemini.google.com, or other web subscription
 * with zero API keys, zero CLI wrappers, and zero simulated/fake responses.
 * Dispatches transition honestly to `awaiting_handoff` until a real reply is submitted.
 */
export class HumanHandoffAdapter implements ProviderAdapter {
  public readonly kind = 'human_handoff' as const;

  public async dispatch(envelope: DispatchEnvelope): Promise<AdapterDispatchResult> {
    return {
      status: 'awaiting_handoff',
      note: `Compiled effort-enforced Context Packet for ${envelope.agentName} (${envelope.provider}/${envelope.model}). Ready for subscription handoff.`,
    };
  }

  public getHealth(): AdapterHealth {
    return {
      kind: this.kind,
      name: 'Transparent Subscription Handoff',
      description:
        'Compiles effort-enforced context envelopes for manual 1-click relay into your authenticated Claude.ai / Gemini web tabs. Never fakes execution.',
      automated: false,
      connectedTargets: 0,
      details: { mode: 'human_assisted', alwaysAvailable: true },
    };
  }

  public isAgentConnected(): boolean {
    return false;
  }
}
