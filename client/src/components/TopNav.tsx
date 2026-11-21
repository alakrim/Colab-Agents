import React from 'react';
import type { SystemTelemetry } from '../types';
import { CheckSquareIcon, CollabIcon, MoonIcon, OrgIcon, SparkIcon, SunIcon } from './Icons';

export type PrimaryScreen = 'organization' | 'workflow' | 'collaboration';

interface TopNavProps {
  activeScreen: PrimaryScreen;
  onSelectScreen: (screen: PrimaryScreen) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  wsConnected: boolean;
  pendingHandoffs: number;
  pendingApprovals: number;
  telemetry: SystemTelemetry | null;
  onTogglePause: () => void;
  onOpenConnectWizard: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeScreen,
  onSelectScreen,
  theme,
  onToggleTheme,
  wsConnected,
  pendingHandoffs,
  pendingApprovals,
  telemetry,
  onTogglePause,
  onOpenConnectWizard,
}) => {
  const collabAttentionCount = pendingHandoffs + pendingApprovals;
  const claudeFuel = telemetry?.fuel.find((f) => f.provider === 'claude');
  const geminiFuel = telemetry?.fuel.find((f) => f.provider === 'gemini');
  const fuelWarning = Boolean(claudeFuel?.warning || geminiFuel?.warning);
  const savedK = telemetry ? Math.round(telemetry.totalEstimatedTokensSaved / 100) / 10 : 0;

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-mark" aria-hidden="true">
          <OrgIcon size={15} />
        </div>
        <div>
          <div className="brand-title">Agent Company OS</div>
          <div className="brand-subtitle">Claude ↔ Gemini GitHub Studio</div>
        </div>
      </div>

      {/* THREE Primary Screens: Organization | Workflow | Collaboration */}
      <nav className="screen-switcher" aria-label="Primary workspaces">
        <button
          id="nav-organization"
          type="button"
          className={`screen-tab ${activeScreen === 'organization' ? 'active' : ''}`}
          onClick={() => onSelectScreen('organization')}
        >
          <OrgIcon size={14} />
          <span>Organization</span>
        </button>
        <button
          id="nav-workflow"
          type="button"
          className={`screen-tab ${activeScreen === 'workflow' ? 'active' : ''}`}
          onClick={() => onSelectScreen('workflow')}
        >
          <CheckSquareIcon size={14} />
          <span>Workflow</span>
        </button>
        <button
          id="nav-collaboration"
          type="button"
          className={`screen-tab ${activeScreen === 'collaboration' ? 'active' : ''}`}
          onClick={() => onSelectScreen('collaboration')}
        >
          <CollabIcon size={14} />
          <span>Collaboration</span>
          {collabAttentionCount > 0 && <span className="tab-count">{collabAttentionCount}</span>}
        </button>
      </nav>

      <div className="topbar-actions">
        {telemetry && (
          <div
            className={`fuel-pill ${fuelWarning ? 'warn' : ''}`}
            title={`Claude: ${claudeFuel?.fuelUsedPercent ?? 0}% (${claudeFuel?.dispatchesInWindow ?? 0}/${claudeFuel?.softMessageCap ?? 45}) · Gemini: ${geminiFuel?.fuelUsedPercent ?? 0}% · Delta saved ~${telemetry.totalEstimatedTokensSaved} tokens`}
          >
            <span className="mono">C:{claudeFuel?.fuelUsedPercent ?? 0}%</span>
            <span className="mono">G:{geminiFuel?.fuelUsedPercent ?? 0}%</span>
            {savedK > 0 && <span style={{ color: 'var(--status-running)' }}>−{savedK}k tok</span>}
          </div>
        )}

        <button type="button" className="btn btn-sm" onClick={onOpenConnectWizard}>
          <SparkIcon size={12} /> Connect AI
        </button>

        <button
          type="button"
          className={`btn btn-sm ${telemetry?.companyPaused ? 'btn-danger' : ''}`}
          onClick={onTogglePause}
          title="Global Kill Switch: pause or resume autonomous agent dispatches"
        >
          {telemetry?.companyPaused ? 'Paused · Resume' : 'Pause All'}
        </button>

        <div className="live-indicator" title={wsConnected ? 'Realtime WebSocket connected' : 'Reconnecting…'}>
          <span className={`status-dot ${wsConnected ? 'running' : 'awaiting_handoff'}`} />
        </div>

        <button
          id="toggle-theme-btn"
          type="button"
          className="btn btn-icon"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label="Toggle color theme"
        >
          {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        </button>
      </div>
    </header>
  );
};
