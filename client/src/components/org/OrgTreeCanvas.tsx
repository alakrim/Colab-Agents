import React, { useMemo, useState } from 'react';
import type { AgentNode, Department } from '../../types';
import { AgentCard } from './AgentCard';

interface OrgTreeCanvasProps {
  agents: AgentNode[];
  allAgents: AgentNode[];
  departments: Department[];
  selectedAgentId: string | null;
  onSelectAgent: (agent: AgentNode) => void;
  onMessageAgent: (agent: AgentNode) => void;
}

interface PositionedNode {
  agent: AgentNode;
  x: number;
  y: number;
}

const CARD_W = 286;
const CARD_H = 178;
const H_GAP = 32;
const V_GAP = 64;

/**
 * Deterministic hierarchical tree layout computing clean non-overlapping coordinates
 * and smooth SVG cubic-bezier reporting lines across multi-root org graphs.
 */
function computeLayout(agents: AgentNode[]): {
  nodes: PositionedNode[];
  edges: Array<{ from: PositionedNode; to: PositionedNode; isSubagent: boolean }>;
  width: number;
  height: number;
} {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenMap = new Map<string, AgentNode[]>();
  const roots: AgentNode[] = [];

  for (const a of agents) {
    if (a.reportsToId && byId.has(a.reportsToId)) {
      const list = childrenMap.get(a.reportsToId) ?? [];
      list.push(a);
      childrenMap.set(a.reportsToId, list);
    } else {
      roots.push(a);
    }
  }

  const widthMemo = new Map<string, number>();
  const measureSubtree = (id: string, stack = new Set<string>()): number => {
    if (widthMemo.has(id)) return widthMemo.get(id)!;
    if (stack.has(id)) return CARD_W;
    stack.add(id);
    const kids = childrenMap.get(id) ?? [];
    if (kids.length === 0) {
      widthMemo.set(id, CARD_W);
      return CARD_W;
    }
    const total = kids.reduce((acc, k) => acc + measureSubtree(k.id, stack), 0) + H_GAP * (kids.length - 1);
    const w = Math.max(CARD_W, total);
    widthMemo.set(id, w);
    return w;
  };

  for (const r of roots) measureSubtree(r.id);

  const placed = new Map<string, PositionedNode>();
  const placeSubtree = (agent: AgentNode, leftX: number, depth: number, visited = new Set<string>()) => {
    if (visited.has(agent.id)) return;
    visited.add(agent.id);
    const subW = widthMemo.get(agent.id) ?? CARD_W;
    const x = leftX + (subW - CARD_W) / 2;
    const y = depth * (CARD_H + V_GAP);
    placed.set(agent.id, { agent, x, y });

    const kids = childrenMap.get(agent.id) ?? [];
    if (kids.length > 0) {
      const kidsTotal = kids.reduce((s, k) => s + (widthMemo.get(k.id) ?? CARD_W), 0) + H_GAP * (kids.length - 1);
      let cursor = leftX + (subW - kidsTotal) / 2;
      for (const k of kids) {
        const kw = widthMemo.get(k.id) ?? CARD_W;
        placeSubtree(k, cursor, depth + 1, visited);
        cursor += kw + H_GAP;
      }
    }
  };

  let rootCursor = 24;
  for (const r of roots) {
    const rw = widthMemo.get(r.id) ?? CARD_W;
    placeSubtree(r, rootCursor, 0);
    rootCursor += rw + H_GAP * 1.5;
  }

  const nodes = Array.from(placed.values());
  const edges: Array<{ from: PositionedNode; to: PositionedNode; isSubagent: boolean }> = [];
  for (const n of nodes) {
    if (n.agent.reportsToId && placed.has(n.agent.reportsToId)) {
      edges.push({
        from: placed.get(n.agent.reportsToId)!,
        to: n,
        isSubagent: n.agent.isDynamicSubagent,
      });
    }
  }

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + CARD_W + 40), 900);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + CARD_H + 60), 480);

  return { nodes, edges, width: maxX, height: maxY };
}

export const OrgTreeCanvas: React.FC<OrgTreeCanvasProps> = ({
  agents,
  allAgents,
  departments,
  selectedAgentId,
  onSelectAgent,
  onMessageAgent,
}) => {
  const [zoom, setZoom] = useState(1);
  const allById = useMemo(() => new Map(allAgents.map((a) => [a.id, a])), [allAgents]);
  const layout = useMemo(() => computeLayout(agents), [agents]);

  if (agents.length === 0) {
    return (
      <div className="empty-state">
        <h3>No agents or positions match this filter</h3>
        <p>Clear your filter or add a new agent, open position, or predefined team blueprint.</p>
      </div>
    );
  }

  return (
    <div className="org-canvas-wrap">
      <div className="org-zoom-controls" aria-label="Hierarchy zoom controls">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom((z) => Math.max(0.55, +(z - 0.1).toFixed(2)))}>
          −
        </button>
        <span className="org-zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))}>
          +
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom(1)}>
          Reset
        </button>
      </div>

      <div
        className="org-tree-stage"
        style={{
          width: layout.width * zoom,
          height: layout.height * zoom,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: layout.width,
            height: layout.height,
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
          }}
        >
          <svg className="org-connectors-svg" width={layout.width} height={layout.height}>
            {layout.edges.map(({ from, to, isSubagent }) => {
              const x1 = from.x + CARD_W / 2;
              const y1 = from.y + CARD_H;
              const x2 = to.x + CARD_W / 2;
              const y2 = to.y;
              const midY = y1 + (y2 - y1) * 0.5;
              const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
              const highlighted = selectedAgentId === from.agent.id || selectedAgentId === to.agent.id;
              return (
                <path
                  key={`${from.agent.id}->${to.agent.id}`}
                  d={d}
                  className={`org-connector-path ${highlighted ? 'highlighted' : ''} ${isSubagent ? 'subagent' : ''}`}
                />
              );
            })}
          </svg>

          {layout.nodes.map(({ agent, x, y }) => {
            const mgr = agent.reportsToId ? allById.get(agent.reportsToId)?.name ?? null : null;
            return (
              <div key={agent.id} style={{ position: 'absolute', left: x, top: y }}>
                <AgentCard
                  agent={agent}
                  selected={selectedAgentId === agent.id}
                  departments={departments}
                  managerName={mgr}
                  onSelect={onSelectAgent}
                  onMessageAgent={onMessageAgent}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
