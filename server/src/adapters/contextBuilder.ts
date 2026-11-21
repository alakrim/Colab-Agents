import type {
  AgentNode,
  Channel,
  EffortLevel,
  FileLease,
  KnowledgeEntry,
  Message,
  PacketMode,
  Task,
} from '../domain/types.js';
import { getEffortPolicy } from '../domain/effort.js';
import { EFFORT_TOKEN_CEILINGS, estimateTokens, truncateToTokenBudget } from '../domain/tokenBudget.js';

export interface ContextPacketInput {
  agent: AgentNode;
  enforcedEffort: EffortLevel;
  packetMode: PacketMode;
  channel: Channel;
  recentMessages: Message[];
  deltaMessages?: Message[];
  triggerMessage: Message | null;
  teammates: AgentNode[];
  knowledge: KnowledgeEntry[];
  activeTask: Task | null;
  activeLeases: FileLease[];
  repoFilePaths?: string[];
  hopDepth: number;
  customPromptOverride?: string;
}

export interface BuiltPacketResult {
  packet: string;
  packetMode: PacketMode;
  estimatedTokens: number;
  savedTokensEstimate: number;
  truncated: boolean;
}

/**
 * Token-Efficient Context Packet Builder.
 * - `bootstrap`: First turn in a persistent Claude/Gemini session — sends compact identity,
 *   repo file paths (tree only, never full contents), pinned ADRs, and concise shorthand commands.
 * - `delta`: Subsequent turns in the SAME session — sends ONLY new messages & task/lease deltas,
 *   cutting subscription token usage by ~70-85% and enforcing per-effort token ceilings.
 */
export function buildContextPacket(input: ContextPacketInput): BuiltPacketResult {
  const policy = getEffortPolicy(input.enforcedEffort);
  const tokenCeiling = EFFORT_TOKEN_CEILINGS[input.enforcedEffort] ?? 4000;

  if (input.customPromptOverride) {
    const capped = truncateToTokenBudget(input.customPromptOverride, tokenCeiling);
    return {
      packet: capped.text,
      packetMode: input.packetMode,
      estimatedTokens: capped.tokens,
      savedTokensEstimate: 0,
      truncated: capped.truncated,
    };
  }

  // Always compute full bootstrap baseline to measure exact tokens saved when using delta mode
  const fullBootstrapLines = buildBootstrapLines(input, policy.maxDelegationHops, policy.directiveInstruction);
  const fullBootstrapText = fullBootstrapLines.join('\n');
  const fullTokens = estimateTokens(fullBootstrapText);

  if (input.packetMode === 'delta') {
    const deltaLines: string[] = [];
    deltaLines.push(`[ACOS DELTA :: ${input.agent.name} | #${input.channel.name} | EFFORT=${input.enforcedEffort.toUpperCase()} | HOP=${input.hopDepth}/${policy.maxDelegationHops}]`);

    if (input.activeTask) {
      deltaLines.push(
        `TASK [${input.activeTask.id}] ${input.activeTask.title} (${input.activeTask.status})${
          input.activeTask.githubBranch ? ` | branch=${input.activeTask.githubBranch}` : ''
        }`,
      );
    }

    if (input.activeLeases.length > 0) {
      deltaLines.push(
        `LOCKS: ${input.activeLeases.map((l) => `${l.filePath}(${l.agentName})`).join(', ')}`,
      );
    }

    const msgs = input.deltaMessages && input.deltaMessages.length > 0 ? input.deltaMessages : input.triggerMessage ? [input.triggerMessage] : input.recentMessages.slice(-3);
    if (msgs.length > 0) {
      deltaLines.push(`NEW_MESSAGES (${msgs.length}):`);
      for (const m of msgs) {
        deltaLines.push(`- ${m.senderName}: ${m.content}`);
      }
    }

    deltaLines.push(`Reply concisely as ${input.agent.name}. Use [STEP_UPDATE ...], [DELEGATE ...], [CLAIM_FILE ...], or @Name when needed.`);

    const capped = truncateToTokenBudget(deltaLines.join('\n'), tokenCeiling);
    return {
      packet: capped.text,
      packetMode: 'delta',
      estimatedTokens: capped.tokens,
      savedTokensEstimate: Math.max(0, fullTokens - capped.tokens),
      truncated: capped.truncated,
    };
  }

  const capped = truncateToTokenBudget(fullBootstrapText, tokenCeiling);
  return {
    packet: capped.text,
    packetMode: 'bootstrap',
    estimatedTokens: capped.tokens,
    savedTokensEstimate: 0,
    truncated: capped.truncated,
  };
}

function buildBootstrapLines(input: ContextPacketInput, maxHops: number, directiveInstruction: string): string[] {
  const lines: string[] = [];
  lines.push(`=== AGENT COMPANY OS :: BOOTSTRAP ENVELOPE ===`);
  lines.push(`Identity: ${input.agent.name} (${input.agent.title}) | ${input.agent.provider.toUpperCase()}/${input.agent.model}`);
  lines.push(`Roles: ${input.agent.roles.join(', ')}`);
  if (input.agent.personality) lines.push(`Tone: ${input.agent.personality}`);
  lines.push(`Enforced Effort: ${input.enforcedEffort.toUpperCase()} (hop ${input.hopDepth}/${maxHops}, budget <= ${EFFORT_TOKEN_CEILINGS[input.enforcedEffort]} tok)`);
  lines.push(`Policy: ${directiveInstruction}`);
  if (input.agent.customInstructions) lines.push(`Instructions: ${input.agent.customInstructions}`);

  const activePeers = input.teammates
    .filter((t) => t.id !== input.agent.id && t.lifecycleState !== 'position_open')
    .map((t) => `@${t.name}(${t.provider}/${t.roles[0] ?? t.title})`);
  lines.push(`Channel: #${input.channel.name} | Team: ${activePeers.join(', ') || 'None'}`);

  if (input.repoFilePaths && input.repoFilePaths.length > 0) {
    lines.push(`Workspace Files (paths only): ${input.repoFilePaths.slice(0, 30).join(', ')}`);
  }

  if (input.activeTask) {
    lines.push(`Task [${input.activeTask.id}]: ${input.activeTask.title} | ${input.activeTask.status} | effort=${input.activeTask.effort}`);
    if (input.activeTask.githubRepoName) {
      lines.push(
        `GitHub Project: ${input.activeTask.githubRepoName}${
          input.activeTask.githubIssueNumber ? ` (Issue #${input.activeTask.githubIssueNumber})` : ''
        }`,
      );
    }
    if (input.activeTask.githubBranch) {
      lines.push(`Isolated Agent Branch: ${input.activeTask.githubBranch} (never push directly to main/master)`);
    }
    if (input.activeTask.description) lines.push(`Goal: ${input.activeTask.description}`);
  }

  if (input.knowledge.length > 0) {
    lines.push(`Memory (${input.knowledge.length}): ${input.knowledge.map((k) => `[${k.title}] ${k.content.slice(0, 140).replace(/\n+/g, ' ')}`).join(' || ')}`);
  }

  if (input.activeLeases.length > 0) {
    lines.push(`Active File Locks: ${input.activeLeases.map((l) => `${l.filePath} (${l.agentName})`).join(', ')}`);
  }

  if (input.recentMessages.length > 0) {
    lines.push(`--- HISTORY (${input.recentMessages.length}) ---`);
    for (const m of input.recentMessages) {
      lines.push(`${m.senderName}: ${m.content}`);
    }
  }

  if (input.triggerMessage) {
    lines.push(`--- TRIGGER ---`);
    lines.push(`${input.triggerMessage.senderName}: ${input.triggerMessage.content}`);
  }

  lines.push(`--- COMPACT COMMANDS (auto-updates the PM's Workflow cards in plain English) ---`);
  lines.push(`• Update your Workflow card (NO jargon — write for a non-technical PM):`);
  lines.push(`  [STEP_UPDATE id="step-..." progress="60" status="active" summary="Built login button" next="Verify password reset flow" todos="[x] Add login UI; [ ] Test error banner"]`);
  lines.push(`• Delegate to teammate: [DELEGATE to="Name" title="..." effort="high"]Plain instructions[/DELEGATE]`);
  lines.push(`• Claim file lock: [CLAIM_FILE path="..."] | Record ADR: [RECORD_DECISION title="..."]...[/RECORD_DECISION] | Mention: @Name`);
  lines.push(`=== RESPOND CONCISELY AS ${input.agent.name.toUpperCase()} ===`);
  return lines;
}
