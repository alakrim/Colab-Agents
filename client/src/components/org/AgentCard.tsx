import React from 'react';
import type { AgentNode, Department } from '../../types';
import { CollabIcon } from '../Icons';

interface AgentCardProps {
  agent: AgentNode;
  selected: boolean;
  departments: Department[];
  managerName: string | null;
  onSelect: (agent: AgentNode) => void;
  onMessageAgent?: (agent: AgentNode) => void;
}

function lifecycleLabel(agent: AgentNode): { label: string; cls: string; dot: string } {
  if (agent.lifecycleState === 'position_open') {
    return { label: 'Open Position', cls: 'badge-planned', dot: 'vacant' };
  }
  if (agent.runtimeStatus === 'awaiting_handoff') {
    return { label: 'Awaiting Handoff', cls: 'badge-handoff', dot: 'awaiting_handoff' };
  }
  if (agent.runtimeStatus === 'dispatched') {
    return { label: 'Dispatched', cls: 'badge-handoff', dot: 'dispatched' };
  }
  if (agent.lifecycleState === 'running') {
    return { label: agent.bridgeConnected ? 'Running · Bridge' : 'Running', cls: 'badge-running', dot: 'running' };
  }
  return { label: 'Planned', cls: 'badge-planned', dot: 'planned' };
}

export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  selected,
  departments,
  managerName,
  onSelect,
  onMessageAgent,
}) => {
  const status = lifecycleLabel(agent);
  const workload = agent.activeWorkload ?? 0;
  const workloadPct = Math.min(100, Math.round((workload / Math.max(1, agent.maxConcurrentWorkload)) * 100));
  const directedNames = agent.directedDepartmentIds
    .map((id) => departments.find((d) => d.id === id)?.name)
    .filter(Boolean);

  const initials =
    agent.lifecycleState === 'position_open'
      ? '+'
      : agent.name
          .split(' ')
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();

  return (
    <div
      id={`agent-card-${agent.id}`}
      role="button"
      tabIndex={0}
      className={`agent-card lifecycle-${agent.lifecycleState} ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(agent)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(agent);
        }
      }}
    >
      <div className="agent-card-top">
        <div className="agent-identity">
          <div
            className={`agent-avatar ${agent.lifecycleState === 'position_open' ? 'vacant' : ''}`}
            style={{ background: agent.avatarColor }}
          >
            {initials}
          </div>
          <div className="agent-name-block">
            <div className="agent-name">{agent.name}</div>
            <div className="agent-title">{agent.title}</div>
          </div>
        </div>
        <span className={`badge ${status.cls}`}>
          <span className={`status-dot ${status.dot}`} />
          {status.label}
        </span>
      </div>

      <div className="agent-meta-row">
        <span className={`badge badge-${agent.provider}`}>
          {agent.provider.toUpperCase()} · {agent.model}
        </span>
        <span className="badge badge-effort" title="Enforced effort policy">
          {agent.effort}
        </span>
        {agent.isDynamicSubagent && <span className="badge">Dynamic Subagent</span>}
      </div>

      {agent.roles.length > 0 && (
        <div className="agent-roles-row">
          {agent.roles.slice(0, 3).map((role) => (
            <span key={role} className="role-chip">
              {role}
            </span>
          ))}
          {agent.roles.length > 3 && <span className="role-chip">+{agent.roles.length - 3}</span>}
        </div>
      )}

      {directedNames.length > 0 && (
        <div className="agent-directed-line">
          <span>Directs:</span>
          <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{directedNames.join(', ')}</strong>
        </div>
      )}

      {managerName && (
        <div className="agent-directed-line">
          <span>Reports to</span>
          <span>{managerName}</span>
          {(agent.directReportCount ?? 0) > 0 && <span>· {agent.directReportCount} direct</span>}
        </div>
      )}

      <div className="agent-metrics-row">
        <div className="workload-meter" title={`Active workload: ${workload} of ${agent.maxConcurrentWorkload} max tasks`}>
          <div className="meter-track">
            <div className={`meter-fill ${workloadPct >= 90 ? 'full' : ''}`} style={{ width: `${workloadPct}%` }} />
          </div>
          <span>
            {workload}/{agent.maxConcurrentWorkload} tasks
          </span>
        </div>

        <div className="agent-card-actions">
          {agent.maxSubagents > 0 && (
            <span title={`Dynamic subagents: ${agent.activeSubagentCount ?? 0} of ${agent.maxSubagents} quota`}>
              {agent.activeSubagentCount ?? 0}/{agent.maxSubagents} sub
            </span>
          )}
          {agent.lifecycleState !== 'position_open' && onMessageAgent && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title={`Message ${agent.name} in Collaboration`}
              onClick={(e) => {
                e.stopPropagation();
                onMessageAgent(agent);
              }}
            >
              <CollabIcon size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
