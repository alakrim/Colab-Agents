import type { AdapterKind } from '../domain/types.js';
import type { AdapterHealth, ProviderAdapter } from './types.js';
import { BrowserBridgeAdapter } from './browserBridgeAdapter.js';
import { HumanHandoffAdapter } from './humanHandoffAdapter.js';
import { WebhookRelayAdapter } from './webhookAdapter.js';

export class AdapterRegistry {
  public readonly humanHandoff: HumanHandoffAdapter;
  public readonly browserBridge: BrowserBridgeAdapter;
  public readonly webhookRelay: WebhookRelayAdapter;
  private adapters: Map<AdapterKind, ProviderAdapter>;

  constructor() {
    this.humanHandoff = new HumanHandoffAdapter();
    this.browserBridge = new BrowserBridgeAdapter();
    this.webhookRelay = new WebhookRelayAdapter();
    this.adapters = new Map<AdapterKind, ProviderAdapter>([
      ['human_handoff', this.humanHandoff],
      ['browser_bridge', this.browserBridge],
      ['webhook_relay', this.webhookRelay],
    ]);
  }

  public get(kind: AdapterKind): ProviderAdapter {
    return this.adapters.get(kind) ?? this.humanHandoff;
  }

  public isAgentConnected(agentId: string): boolean {
    return this.browserBridge.isAgentConnected(agentId);
  }

  public listHealth(): AdapterHealth[] {
    return [
      this.browserBridge.getHealth(),
      this.humanHandoff.getHealth(),
      this.webhookRelay.getHealth(),
    ];
  }
}
