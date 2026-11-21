import type { AdapterConfig, AdapterKind, EffortLevel, ProviderKind } from '../domain/types.js';

export interface DispatchEnvelope {
  dispatchId: string;
  agentId: string;
  agentName: string;
  provider: ProviderKind;
  model: string;
  enforcedEffort: EffortLevel;
  channelId: string;
  channelName: string;
  parentMessageId: string | null;
  taskId: string | null;
  adapterConfig: AdapterConfig;
  contextPacket: string;
}

export interface AdapterDispatchResult {
  status: 'awaiting_handoff' | 'dispatched' | 'failed';
  note: string;
  errorMessage?: string;
}

export interface AdapterHealth {
  kind: AdapterKind;
  name: string;
  description: string;
  automated: boolean;
  connectedTargets: number;
  details: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly kind: AdapterKind;
  dispatch(envelope: DispatchEnvelope): Promise<AdapterDispatchResult>;
  getHealth(): AdapterHealth;
  isAgentConnected(agentId: string): boolean;
}
