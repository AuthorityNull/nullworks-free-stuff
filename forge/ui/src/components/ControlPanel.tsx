import React, { useState } from 'react';
import { Play, Info, Clock, ChevronRight } from 'lucide-react';
import { useForge } from '../hooks/useForge';
import { useOutputPane } from '../context/OutputPaneContext';
import { useRightPanel } from '../context/RightPanelContext';
import { useToast } from './Toast';
import StatusChip from './StatusChip';
import type { StatusType } from './StatusChip';

/* ---- Status line ---- */
const StatusLine: React.FC<{ health: { ok: boolean; service: string; status: string } | null }> = ({ health }) => (
  <div className="flex items-center gap-2">
    <span
      className="status-dot"
      style={{
        backgroundColor: health?.status === 'ok' ? 'var(--color-success)' : 'var(--color-danger)',
        animation: health?.status === 'ok' ? 'none' : 'statusPulse 2s ease-in-out infinite',
      }}
    />
    <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
      {health?.status === 'ok' ? 'System operational' : 'System degraded'}
    </span>
  </div>
);

/* ---- Run status helper ---- */
function runStatusType(s: string): StatusType {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'running' || s === 'started') return 'running';
  if (s === 'queued') return 'pending';
  return 'info';
}

/* ---- Main ControlPanel ---- */
const ControlPanel: React.FC = () => {
  const forge = useForge();
  const { showPipeline } = useOutputPane();
  const { openPanel } = useRightPanel();
  const { addToast } = useToast();

  const [selectedModel, setSelectedModel] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [runFeedback, setRunFeedback] = useState<string>('Choose a model and target agent.');

  // Derive unique agents from mappings
  const agentOptions = React.useMemo(() => {
    const agents = forge.agents;
    if (agents.length > 0) return agents;
    const seen = new Set<string>();
    return forge.mappings
      .filter((m) => {
        if (seen.has(m.agentId)) return false;
        seen.add(m.agentId);
        return true;
      })
      .map((m) => ({ id: m.agentId, name: m.agentId, description: '' }));
  }, [forge.agents, forge.mappings]);

  // When model selected, open inspector
  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    if (modelId) {
      const model = forge.models.find((m) => m.id === modelId);
      if (model) openPanel('model', model, 'model');
    }
  };

  const handleRunPipeline = async () => {
    if (!selectedModel || !selectedAgent) {
      const message = 'Select both a model and target agent before running';
      setRunFeedback(message);
      addToast(message, 'warning');
      return;
    }
    const normalizeAgentId = (value: string) => String(value || '').trim().toLowerCase();
    const selectedMapping = forge.mappings.find((mapping) => (
      normalizeAgentId(mapping.agentId) === normalizeAgentId(selectedAgent)
      && mapping.modelId === selectedModel
      && (!selectedRole || mapping.roleId === selectedRole)
    ));
    if (!selectedMapping?.promptPath) {
      const message = 'No prompt mapping found for that selection';
      setRunFeedback(message);
      addToast(message, 'warning');
      return;
    }
    try {
      setRunFeedback('Starting pipeline...');
      const resp = await forge.runPipeline({
        modelId: selectedModel,
        agentId: selectedAgent,
        roleId: selectedRole || undefined,
        promptPath: selectedMapping?.promptPath,
      });
      if (resp?.runId) {
        showPipeline(resp.runId);
        setRunFeedback(`Pipeline started - ${resp.runId.slice(0, 8)}`);
      } else {
        setRunFeedback('Pipeline started');
      }
      addToast('Pipeline started', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipeline start failed';
      setRunFeedback(msg);
      addToast(msg, 'error');
    }
  };

  const recentRuns = forge.runs.slice(0, 5);

  /* Shared select style */
  const selectStyle: React.CSSProperties = {
    fontSize: '11px',
    height: 36,
    backgroundColor: 'transparent',
    border: '1px solid rgba(172, 170, 158, 0.22)',
    color: '#acaa9e',
    cursor: 'pointer',
    padding: '0 10px',
    appearance: 'none',
    WebkitAppearance: 'none',
    outline: 'none',
    boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.22)',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23acaa9e' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    paddingRight: '28px',
  };

  const panelCardStyle: React.CSSProperties = {
    border: '1px solid rgba(172, 170, 158, 0.2)',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.02)',
    background: 'transparent',
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* FORGE header */}
      <div
        className="px-5 pt-6 pb-4"
        style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
      >
        <div className="mb-4" style={{ width: '100%' }}>
          <div
            className="font-mono font-bold"
            style={{
              fontSize: '42px',
              color: '#acaa9e',
              letterSpacing: '0.24em',
              lineHeight: 1.1,
              textAlign: 'left',
              width: '100%',
            }}
          >
            FORGE
          </div>
          <div
            className="font-mono uppercase"
            style={{
              fontSize: '9px',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em',
              marginTop: 8,
              textAlign: 'left',
            }}
          >
            The agentic system prompt builder
          </div>
        </div>

        <div
          className="p-3"
          style={panelCardStyle}
        >
          <p
            className="font-mono"
            style={{
              fontSize: '10px',
              color: 'var(--color-text-secondary)',
              lineHeight: '1.6',
            }}
          >
            Choose your model, target agent, and role first. When you run, the center pane shows the full story of what Forge is scanning, choosing, and writing. Details and knobs live in the inspector.
          </p>
          <div className="mt-2">
            <StatusLine health={forge.health} />
          </div>
        </div>
      </div>

      {/* Pipeline configuration */}
      <div className="px-4 py-4 space-y-4" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
        <div
          className="p-3 space-y-3"
          style={panelCardStyle}
        >
          <div className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.16em', color: 'var(--color-text-muted)' }}>
            Model selection
          </div>

          <div>
            <label
              className="label block mb-1.5"
              style={{ fontSize: '9px', letterSpacing: '0.15em' }}
            >
              MODEL
            </label>
            <select
              className="w-full font-mono"
              style={selectStyle}
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              <option value="">Select model...</option>
              {forge.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="label block mb-1.5"
              style={{ fontSize: '9px', letterSpacing: '0.15em' }}
            >
              TARGET AGENT
            </label>
            <select
              className="w-full font-mono"
              style={selectStyle}
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              <option value="">Select agent...</option>
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="label block mb-1.5"
              style={{ fontSize: '9px', letterSpacing: '0.15em' }}
            >
              ROLE
            </label>
            <select
              className="w-full font-mono"
              style={selectStyle}
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
            >
              <option value="">Default role</option>
              {forge.roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="p-3"
          style={panelCardStyle}
        >
          <div className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.16em', color: 'var(--color-text-muted)', marginBottom: 10 }}>
            Run pipeline
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <div className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.16em', color: 'var(--color-text-muted)' }}>Ready state</div>
              <div className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: 6, lineHeight: 1.5, maxWidth: '48ch' }}>
                {selectedModel && selectedAgent
                  ? `Run ${selectedModel} against ${selectedAgent}${selectedRole ? ` with ${selectedRole}` : ''}.`
                  : 'Select a model and agent to start the pipeline.'}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                className="btn btn--forge-outline btn--compact"
                style={{
                  minWidth: 120,
                  opacity: forge.loading.pipeline || !selectedModel || !selectedAgent ? 0.55 : 1,
                }}
                onClick={handleRunPipeline}
                disabled={forge.loading.pipeline || !selectedModel || !selectedAgent}
                title={!selectedModel || !selectedAgent ? 'Select a model and agent first' : 'Start pipeline'}
              >
                <Play size={12} />
                {forge.loading.pipeline ? 'Running...' : 'Run pipeline'}
              </button>
            </div>
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: '10px',
              color: forge.loading.pipeline ? 'var(--color-accent)' : 'var(--color-text-muted)',
              marginTop: 12,
              lineHeight: 1.5,
            }}
          >
            {runFeedback}
          </div>
        </div>
      </div>
      {/* Recent runs */}
      <div className="flex-1 overflow-auto">
        <div className="px-4 pt-3 pb-1">
          <span
            className="label"
            style={{ fontSize: '9px', letterSpacing: '0.15em' }}
          >
            RECENT RUNS
          </span>
        </div>
        <div className="px-2">
          {recentRuns.length === 0 && !forge.loading.runs && (
            <div className="px-2 py-4 text-center">
              <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                No runs yet
              </span>
            </div>
          )}
          {forge.loading.runs && (
            <div className="flex justify-center py-3">
              <span className="loading-cursor" />
            </div>
          )}
          {recentRuns.map((r) => (
            <button
              key={r.id}
              className="flex items-center justify-between w-full py-2 px-2"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 100ms linear',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
              onClick={() => {
                showPipeline(r.id);
                openPanel('run', r, 'run');
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div className="flex items-center gap-2">
                <Clock size={10} style={{ color: 'var(--color-text-muted)' }} />
                <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                  {r.id.slice(0, 8)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={runStatusType(r.status)}>
                  {r.status.toUpperCase()}
                </StatusChip>
                <ChevronRight size={10} style={{ color: 'var(--color-text-disabled)' }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Contextual tip */}
      <div
        className="px-4 py-3 flex items-start gap-2"
        style={{
          borderTop: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <Info size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0, marginTop: 1 }} />
        <span
          className="font-mono"
          style={{ fontSize: '9px', color: 'var(--color-text-disabled)', lineHeight: '1.4' }}
        >
          Model details open in the inspector. Phase settings live there too, so the center stays focused on the live stream.
        </span>
      </div>
    </div>
  );
};

export default ControlPanel;
