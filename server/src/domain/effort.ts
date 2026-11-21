import type { EffortLevel } from './types.js';

export interface EffortPolicy {
  level: EffortLevel;
  label: string;
  /** Weighted effort units consumed against department effort budgets */
  budgetWeight: number;
  /** Number of recent channel/thread messages included in context packets */
  contextMessageLimit: number;
  /** Number of accepted/pinned knowledge records injected */
  knowledgeRecordLimit: number;
  /** Maximum autonomous cross-agent delegation hop depth before human checkpoint */
  maxDelegationHops: number;
  /** Whether file integrations at this effort level MUST go through human approval */
  requireApprovalForIntegration: boolean;
  /** Default file lease duration in seconds */
  defaultLeaseSeconds: number;
  /** Mandatory reasoning/verification instruction injected into every context packet */
  directiveInstruction: string;
}

export const EFFORT_POLICIES: Record<EffortLevel, EffortPolicy> = {
  low: {
    level: 'low',
    label: 'Low',
    budgetWeight: 1,
    contextMessageLimit: 6,
    knowledgeRecordLimit: 2,
    maxDelegationHops: 1,
    requireApprovalForIntegration: false,
    defaultLeaseSeconds: 180,
    directiveInstruction:
      'EFFORT=LOW: Respond concisely and directly. Focus on immediate actionable steps without lengthy exploration. Limit sub-delegation to at most 1 hop.',
  },
  medium: {
    level: 'medium',
    label: 'Medium',
    budgetWeight: 2,
    contextMessageLimit: 15,
    knowledgeRecordLimit: 5,
    maxDelegationHops: 3,
    requireApprovalForIntegration: false,
    defaultLeaseSeconds: 300,
    directiveInstruction:
      'EFFORT=MEDIUM: Provide balanced analysis, verify assumptions against shared project decisions, clearly state risks, and coordinate cleanly with teammates.',
  },
  high: {
    level: 'high',
    label: 'High',
    budgetWeight: 3,
    contextMessageLimit: 30,
    knowledgeRecordLimit: 10,
    maxDelegationHops: 5,
    requireApprovalForIntegration: false,
    defaultLeaseSeconds: 600,
    directiveInstruction:
      'EFFORT=HIGH: Perform deep, thorough reasoning. Cross-check dependencies, edge cases, and security implications. Include a brief verification checklist before finalizing deliverables.',
  },
  max: {
    level: 'max',
    label: 'Max',
    budgetWeight: 4,
    contextMessageLimit: 60,
    knowledgeRecordLimit: 20,
    maxDelegationHops: 6,
    requireApprovalForIntegration: true,
    defaultLeaseSeconds: 900,
    directiveInstruction:
      'EFFORT=MAX: Apply exhaustive rigor. Audit all assumptions, alternatives, failure modes, and downstream impacts. All file integrations at MAX effort are automatically gated by human executive approval.',
  },
};

const EFFORT_RANK: Record<EffortLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  max: 4,
};

export function getEffortPolicy(level: EffortLevel): EffortPolicy {
  return EFFORT_POLICIES[level] ?? EFFORT_POLICIES.medium;
}

/**
 * Resolves the effective enforced effort for a dispatch:
 * uses the higher of the agent's baseline effort and the task's required effort,
 * while clamping if a department/system policy caps it.
 */
export function resolveEffectiveEffort(
  agentEffort: EffortLevel,
  taskEffort?: EffortLevel | null,
): EffortLevel {
  if (!taskEffort) return agentEffort;
  return EFFORT_RANK[taskEffort] > EFFORT_RANK[agentEffort] ? taskEffort : agentEffort;
}

export function isValidEffort(value: string): value is EffortLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'max';
}
