import type { ParsedDirective } from '../domain/types.js';

function parseKeyValueAttrs(rawAttrs: string): Record<string, string> {
  const params: Record<string, string> = {};
  const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    params[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return params;
}

/**
 * Extracts @AgentName mentions from natural message text.
 */
export function extractMentions(content: string): string[] {
  const found = new Set<string>();
  const regex = /(?:^|[\s(])@([A-Za-z][A-Za-z0-9_-]{1,32})\b/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

/**
 * Parses lightweight plain-text inter-agent directives emitted naturally by Claude, Gemini,
 * or any other subscription model without requiring proprietary tool-calling APIs.
 *
 * Supported directives:
 * - [DELEGATE to="Vega" title="Implement API" effort="high"]Task details...[/DELEGATE]
 *   or single-line: [DELEGATE to="Vega" title="Implement API" effort="high" description="..."]
 * - [CLAIM_FILE path="docs/architecture.md"]
 * - [PROPOSE_EDIT path="docs/architecture.md"]...new content...[/PROPOSE_EDIT]
 * - [REQUEST_APPROVAL title="Deploy config" reason="Sensitive change"]
 * - [RECORD_DECISION title="ADR-002: ..." kind="decision"]...content...[/RECORD_DECISION]
 * - [SPAWN_SUBAGENT name="Echo" role="Test Engineer" provider="gemini" model="gemini-2.5-flash"]
 */
export function parseDirectives(content: string): ParsedDirective[] {
  const directives: ParsedDirective[] = [];

  // 1. Block directives with closing tags
  const blockTypes: Array<{ tag: string; type: ParsedDirective['type'] }> = [
    { tag: 'DELEGATE', type: 'delegate' },
    { tag: 'PROPOSE_EDIT', type: 'propose_edit' },
    { tag: 'RECORD_DECISION', type: 'record_decision' },
    { tag: 'WORKFLOW_PLAN', type: 'workflow_plan' },
  ];

  const consumedRanges: Array<[number, number]> = [];

  for (const { tag, type } of blockTypes) {
    const regex = new RegExp(`\\[${tag}\\s*([^\\]]*)\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      consumedRanges.push([match.index, match.index + match[0].length]);
      directives.push({
        type,
        raw: match[0],
        params: parseKeyValueAttrs(match[1] || ''),
        body: match[2].trim(),
      });
    }
  }

  const isConsumed = (idx: number) => consumedRanges.some(([s, e]) => idx >= s && idx < e);

  // 2. Self-closing / single-tag directives
  const singleTypes: Array<{ tag: string; type: ParsedDirective['type'] }> = [
    { tag: 'DELEGATE', type: 'delegate' },
    { tag: 'CLAIM_FILE', type: 'claim_file' },
    { tag: 'REQUEST_APPROVAL', type: 'request_approval' },
    { tag: 'RECORD_DECISION', type: 'record_decision' },
    { tag: 'SPAWN_SUBAGENT', type: 'spawn_subagent' },
    { tag: 'STEP_UPDATE', type: 'step_update' },
  ];

  for (const { tag, type } of singleTypes) {
    const regex = new RegExp(`\\[${tag}\\s+([^\\]]+)\\]`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (isConsumed(match.index)) continue;
      directives.push({
        type,
        raw: match[0],
        params: parseKeyValueAttrs(match[1]),
      });
    }
  }

  return directives;
}

export interface ParsedWorkflowBox {
  stage: 'discovery' | 'blueprint' | 'build' | 'review' | 'ship';
  scopeTier: 'core' | 'aaa_polish';
  ownerName: string;
  effort: 'low' | 'medium' | 'high' | 'max';
  title: string;
  plainGoal: string;
  userImpact: string;
  nextSteps: string;
  todos: Array<{ text: string; done: boolean }>;
}

export function parseTodoList(raw?: string): Array<{ text: string; done: boolean }> {
  if (!raw) return [];
  return raw
    .split(/[;\n]/)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)
    .map((item) => {
      if (/^\[x\]/i.test(item)) return { text: item.replace(/^\[x\]\s*/i, ''), done: true };
      if (/^\[\s?\]/.test(item)) return { text: item.replace(/^\[\s?\]\s*/, ''), done: false };
      return { text: item, done: false };
    });
}

/**
 * Parses compact [BOX stage="build" tier="core" owner="Vega" effort="high" title="..." next="..." todos="Item 1; Item 2"]Goal | Impact[/BOX]
 * inside a [WORKFLOW_PLAN]...[/WORKFLOW_PLAN] block — plus forgiving JSON fallback if a model outputs JSON.
 */
export function parseWorkflowBoxes(planBody: string): ParsedWorkflowBox[] {
  const boxes: ParsedWorkflowBox[] = [];
  const regex = /\[BOX\s+([^\]]+)\]([\s\S]*?)\[\/BOX\]/gi;
  const validStages = new Set(['discovery', 'blueprint', 'build', 'review', 'ship']);
  const validEfforts = new Set(['low', 'medium', 'high', 'max']);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(planBody)) !== null) {
    const attrs = parseKeyValueAttrs(match[1]);
    const body = match[2].trim();
    const parts = body.split('|').map((s) => s.trim());
    const goalPart = parts[0] || body || attrs.title || '';
    const impactPart = parts[1] || 'Moves the project closer to shipping cleanly.';
    const nextPart = attrs.next || attrs.nextsteps || parts[2] || 'Start execution on isolated branch.';
    const todos = parseTodoList(attrs.todos || parts[3] || '');

    const stage = validStages.has(attrs.stage) ? (attrs.stage as ParsedWorkflowBox['stage']) : 'build';
    const effort = validEfforts.has(attrs.effort) ? (attrs.effort as ParsedWorkflowBox['effort']) : 'medium';
    const scopeTier = attrs.tier === 'aaa_polish' || attrs.tier === 'aaa' ? 'aaa_polish' : 'core';

    boxes.push({
      stage,
      scopeTier,
      ownerName: attrs.owner || attrs.to || '',
      effort,
      title: attrs.title || 'Workflow Step',
      plainGoal: goalPart,
      userImpact: impactPart,
      nextSteps: nextPart,
      todos,
    });
  }

  // Forgiving JSON fallback in case a model outputs a JSON array of steps
  if (boxes.length === 0) {
    const jsonMatch = planBody.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
        for (const item of parsed) {
          const st = String(item.stage || 'build').toLowerCase();
          const ef = String(item.effort || 'medium').toLowerCase();
          boxes.push({
            stage: validStages.has(st) ? (st as ParsedWorkflowBox['stage']) : 'build',
            scopeTier: item.tier === 'aaa_polish' || item.scopeTier === 'aaa_polish' ? 'aaa_polish' : 'core',
            ownerName: String(item.owner || item.ownerName || ''),
            effort: validEfforts.has(ef) ? (ef as ParsedWorkflowBox['effort']) : 'medium',
            title: String(item.title || 'Workflow Step'),
            plainGoal: String(item.plainGoal || item.goal || item.title || ''),
            userImpact: String(item.userImpact || item.impact || 'Improves user experience.'),
            nextSteps: String(item.nextSteps || item.next || 'Begin work on isolated branch.'),
            todos: Array.isArray(item.todos)
              ? item.todos.map((t) =>
                  typeof t === 'string'
                    ? { text: t, done: false }
                    : { text: String((t as { text?: string }).text || ''), done: Boolean((t as { done?: boolean }).done) },
                )
              : parseTodoList(String(item.todos || '')),
          });
        }
      } catch {
        // ignore invalid JSON fallback
      }
    }
  }

  return boxes;
}
