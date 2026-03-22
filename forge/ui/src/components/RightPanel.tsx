import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Check, XCircle, FileText, ArrowRight, Activity, RotateCcw, Wrench, Edit3, Square, PauseCircle, PlayCircle } from 'lucide-react';
import { useRightPanel } from '../context/RightPanelContext';
import { useForge } from '../hooks/useForge';
import { useToast } from './Toast';
import StatusChip from './StatusChip';
import type { StatusType } from './StatusChip';
import type { Model, Run, ResearchItem, PipelinePhase, Mapping } from '../api/types';
import apiClient from '../api/client';

function mapRunStatus(s: string): StatusType {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  if (s.includes('retry') || s.includes('autofix')) return 'warning';
  if (s === 'started' || s === 'running') return 'running';
  if (s === 'queued') return 'pending';
  return 'info';
}

const Field: React.FC<{ label: string; value?: string; children?: React.ReactNode }> = ({
  label, value, children,
}) => (
  <div>
    <span className="label">{label}</span>
    {children ? (
      <div className="mt-1">{children}</div>
    ) : (
      <div className="mt-1 font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
        {value || '-'}
      </div>
    )}
  </div>
);

const PhaseSettingsPanel: React.FC = () => {
  const forge = useForge();
  const { addToast } = useToast();
  const [expandedPhase, setExpandedPhase] = useState<string | null>('scan');
  const [scanTimeoutMs, setScanTimeoutMs] = useState(120000);
  const [allowAutoRetry, setAllowAutoRetry] = useState(false);
  const [confidence, setConfidence] = useState(0.85);
  const [requireApproval, setRequireApproval] = useState(true);

  useEffect(() => {
    forge.phases.forEach((p) => {
      const s = p.settings || {};
      if (p.phase === 'scan') {
        if (typeof s.timeoutMs === 'number') setScanTimeoutMs(s.timeoutMs);
        if (typeof s.allowAutoRetry === 'boolean') setAllowAutoRetry(s.allowAutoRetry);
      }
      if (p.phase === 'analysis' && typeof s.confidenceThreshold === 'number') {
        setConfidence(s.confidenceThreshold);
      }
      if (p.phase === 'apply' && typeof s.requireApproval === 'boolean') {
        setRequireApproval(s.requireApproval);
      }
    });
  }, [forge.phases]);

  const savePhaseSettings = async (phase: string, settings: Record<string, unknown>) => {
    try {
      await apiClient.updatePipelinePhase(phase, { settings });
      addToast(`${phase} settings saved`, 'success');
    } catch {
      addToast('Settings save failed', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <span className="label" style={{ fontSize: '9px', letterSpacing: '0.15em' }}>PHASE SETTINGS</span>
        <p className="mt-2 font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          These toggles map to the real backend pipeline phase settings. They change whether each phase is enabled and update the persisted phase config, but they do not yet expose deeper execution semantics than the current backend supports.
        </p>
      </div>

      <div className="space-y-2">
        {forge.phases.map((p) => {
          const isExpanded = expandedPhase === p.phase;
          return (
            <div
              key={p.phase}
              className="p-3"
              style={{
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setExpandedPhase(isExpanded ? null : p.phase)}
                  className="flex items-center gap-2"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <span style={{ fontSize: '8px', color: 'var(--color-text-disabled)', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}>▶</span>
                  <div className="text-left">
                    <div className="font-mono uppercase" style={{ fontSize: '10px', color: 'var(--color-text-secondary)', letterSpacing: '0.12em' }}>
                      {p.phase}
                    </div>
                    <div className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {p.phase === 'scan' ? 'Controls scan timeout and retry behavior.' : p.phase === 'analysis' ? 'Controls confidence threshold for analysis output.' : 'Controls whether apply waits for approval.'}
                    </div>
                  </div>
                </button>
                <button
                  onClick={async () => {
                    try {
                      await apiClient.updatePipelinePhase(p.phase, { enabled: !p.enabled });
                      addToast(`${p.phase} ${p.enabled ? 'disabled' : 'enabled'}`, 'success');
                    } catch {
                      addToast('Phase toggle failed', 'error');
                    }
                  }}
                  style={{
                    width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer',
                    backgroundColor: p.enabled ? 'var(--color-accent)' : 'var(--color-surface)',
                    position: 'relative', transition: 'background 150ms linear',
                    flexShrink: 0,
                  }}
                  aria-label={`Toggle ${p.phase}`}
                >
                  <div style={{
                    width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff',
                    position: 'absolute', top: 2, left: p.enabled ? 18 : 2,
                    transition: 'left 150ms linear',
                  }} />
                </button>
              </div>

              {isExpanded && p.phase === 'scan' && (
                <div className="pl-4 pt-4 space-y-3" style={{ borderLeft: '2px solid var(--color-border-subtle)', marginLeft: 4 }}>
                  <div>
                    <label className="font-mono block mb-1" style={{ fontSize: '9px', color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
                      TIMEOUT: {Math.round(scanTimeoutMs / 1000)}s
                    </label>
                    <input
                      type="range"
                      min="10000"
                      max="300000"
                      step="10000"
                      value={scanTimeoutMs}
                      onChange={(e) => setScanTimeoutMs(parseInt(e.target.value, 10))}
                      onMouseUp={() => savePhaseSettings('scan', { timeoutMs: scanTimeoutMs, allowAutoRetry })}
                      className="w-full"
                      style={{ height: 4, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono" style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>Allow auto-retry</span>
                    <button
                      onClick={() => {
                        const next = !allowAutoRetry;
                        setAllowAutoRetry(next);
                        savePhaseSettings('scan', { timeoutMs: scanTimeoutMs, allowAutoRetry: next });
                      }}
                      style={{ width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', backgroundColor: allowAutoRetry ? 'var(--color-accent)' : 'var(--color-surface)', position: 'relative', transition: 'background 150ms linear' }}
                    >
                      <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff', position: 'absolute', top: 2, left: allowAutoRetry ? 18 : 2, transition: 'left 150ms linear' }} />
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && p.phase === 'analysis' && (
                <div className="pl-4 pt-4" style={{ borderLeft: '2px solid var(--color-border-subtle)', marginLeft: 4 }}>
                  <label className="font-mono block mb-1" style={{ fontSize: '9px', color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
                    CONFIDENCE: {confidence.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={confidence}
                    onChange={(e) => setConfidence(parseFloat(e.target.value))}
                    onMouseUp={() => savePhaseSettings('analysis', { confidenceThreshold: confidence })}
                    className="w-full"
                    style={{ height: 4, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
                  />
                </div>
              )}

              {isExpanded && p.phase === 'apply' && (
                <div className="pl-4 pt-4" style={{ borderLeft: '2px solid var(--color-border-subtle)', marginLeft: 4 }}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono" style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>Require approval</span>
                    <button
                      onClick={() => {
                        const next = !requireApproval;
                        setRequireApproval(next);
                        savePhaseSettings('apply', { requireApproval: next });
                      }}
                      style={{ width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', backgroundColor: requireApproval ? 'var(--color-accent)' : 'var(--color-surface)', position: 'relative', transition: 'background 150ms linear' }}
                    >
                      <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff', position: 'absolute', top: 2, left: requireApproval ? 18 : 2, transition: 'left 150ms linear' }} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SystemOverview: React.FC = () => {
  const forge = useForge();
  const activeModels = forge.models.filter((m) => m.status === 'active').length;
  const totalModels = forge.models.length;

  return (
    <div className="space-y-5">
      <div>
        <span className="label" style={{ fontSize: '9px', letterSpacing: '0.15em' }}>SYSTEM OVERVIEW</span>
      </div>

      <div className="p-3" style={{ backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Connected Models</span>
          <span className="font-mono font-semibold" style={{ fontSize: '12px', color: 'var(--color-text-primary)' }}>{activeModels}/{totalModels}</span>
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Health</span>
          <span className="status-dot" style={{ backgroundColor: forge.health?.status === 'ok' ? 'var(--color-success)' : 'var(--color-danger)' }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Version</span>
          <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>v1.0.0</span>
        </div>
      </div>

      <div className="p-3" style={{ backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)' }}>
        <span className="font-mono block mb-2" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Agents</span>
        {forge.mappings.length === 0 && (
          <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>No agent mappings</span>
        )}
        {forge.mappings.map((m) => (
          <div key={m.id} className="flex items-center justify-between py-1">
            <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{m.agentId}</span>
            <span className="font-mono" style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>{m.modelId}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ModelInspector: React.FC<{ item: Model }> = ({ item }) => {
  const { addToast } = useToast();
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [role, setRole] = useState('');
  const forge = useForge();

  return (
    <div className="space-y-4">
      <Field label="MODEL" value={item.name} />
      <Field label="PROVIDER" value={item.provider} />
      <Field label="STATUS">
        <StatusChip status={item.status as StatusType}>{item.status.toUpperCase()}</StatusChip>
      </Field>
      <Field label="ID" value={item.id} />

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
        <span className="label" style={{ fontSize: '9px', letterSpacing: '0.15em' }}>TUNING PARAMETERS</span>
      </div>

      <div>
        <label className="label block mb-1">Temperature: {temperature.toFixed(2)}</label>
        <input type="range" min="0" max="2" step="0.05" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full" style={{ height: 4, accentColor: 'var(--color-accent)', cursor: 'pointer' }} />
      </div>

      <div>
        <label className="label block mb-1">Max Tokens</label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="w-full font-mono"
          style={{ fontSize: '11px', height: 32, backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', padding: '0 10px', outline: 'none' }}
          value={maxTokens}
          onChange={(e) => {
            const v = parseInt(e.target.value.replace(/\D/g, ''), 10) || 4096;
            setMaxTokens(Math.min(128000, Math.max(256, v)));
          }}
        />
      </div>

      <div>
        <label className="label block mb-1">Role Assignment</label>
        <select className="input w-full font-mono" style={{ fontSize: '11px', height: 32 }} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Default</option>
          {forge.roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      <button className="btn btn--ghost btn--compact" onClick={() => addToast('Model tuning remains local UI state until backend support lands', 'info')}>
        <Save size={12} /> Save Settings
      </button>
    </div>
  );
};

const RunApplyPanel: React.FC<{ item: Run }> = ({ item }) => {
  const { addToast } = useToast();
  const [showDiff, setShowDiff] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const isComplete = item.status === 'completed';
  const isRunning = item.status === 'running' || item.status === 'started' || item.status === 'paused';
  const isFailed = item.status === 'failed';
  const isStopped = item.status === 'stopped';

  const handleRetry = async () => {
    try {
      await apiClient.retryRun(item.id);
      addToast('Retry scheduled', 'success');
    } catch {
      addToast('Retry failed', 'error');
    }
  };

  const handleAutofix = async () => {
    try {
      await apiClient.autofixRun(item.id);
      addToast('Autofix scheduled', 'success');
    } catch {
      addToast('Autofix failed', 'error');
    }
  };

  const handleApply = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const promptText = (item as Run & { generatedPrompt?: string; output?: string; content?: string }).generatedPrompt
      || (item as Run & { output?: string }).output
      || (item as Run & { content?: string }).content;
    if (typeof promptText !== 'string' || !promptText.trim()) {
      addToast('No exact prompt content available to apply', 'warning');
      setConfirming(false);
      return;
    }
    try {
      await apiClient.applyPrompt({
        runId: item.id,
        agentId: item.targetAgent || undefined,
        modelId: item.model || undefined,
        roleId: item.role || undefined,
        promptPath: item.promptPath || undefined,
        apply: promptText,
      });
      addToast('Prompt applied to target agent', 'success');
      setConfirming(false);
    } catch {
      addToast('Apply failed', 'error');
      setConfirming(false);
    }
  };

  const handleDeny = () => {
    setConfirming(false);
    addToast('Apply cancelled', 'info');
  };

  const toggleStream = () => {
    if (streaming && esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setStreaming(false);
      return;
    }
    const es = apiClient.createRunStream(item.id);
    esRef.current = es;
    setStreaming(true);
    const push = (label: string, data: string) => {
      try {
        const parsed = JSON.parse(data || '{}');
        const ts = typeof parsed.ts === 'string' ? parsed.ts.slice(11, 19) : '--:--:--';
        const msg = typeof parsed.message === 'string' ? parsed.message : data;
        setEvents((prev) => [...prev, `[${ts}] ${label} ${msg}`].slice(-50));
      } catch {
        setEvents((prev) => [...prev, data].slice(-50));
      }
    };
    ['phase.started', 'phase.completed', 'approval.required', 'approval.applied', 'run.completed'].forEach((name) => {
      es.addEventListener(name, (e: MessageEvent) => push(name, e.data));
    });
    es.onmessage = (e) => push('message', e.data);
    es.onerror = () => {
      es.close();
      setStreaming(false);
    };
  };

  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

  return (
    <div className="space-y-4">
      <Field label="RUN" value={item.id.slice(0, 12)} />
      <Field label="STATUS"><StatusChip status={mapRunStatus(item.status)}>{item.status.toUpperCase()}</StatusChip></Field>

      {item.phases && item.phases.length > 0 && (
        <div>
          <span className="label">PHASE BREAKDOWN</span>
          <div className="mt-2 space-y-1">
            {item.phases.map((p, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-1.5" style={{ backgroundColor: p.state === 'running' ? 'var(--color-surface-elevated)' : 'transparent', border: p.state === 'running' ? '1px solid var(--color-border-highlight)' : '1px solid transparent' }}>
                <span className="font-mono uppercase" style={{ fontSize: '10px', color: 'var(--color-text-secondary)', letterSpacing: '0.1em' }}>{p.name}</span>
                <span className="status-dot" style={{ backgroundColor: p.state === 'completed' ? 'var(--color-success)' : p.state === 'running' ? 'var(--color-accent)' : p.state === 'failed' ? 'var(--color-danger)' : 'var(--color-text-disabled)' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(isRunning || item.status === 'paused') && (
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <span className="label" style={{ fontSize: '9px', letterSpacing: '0.15em' }}>PIPELINE CONTROLS</span>
          <div className="flex gap-2 mt-3">
            {item.status === 'paused' ? (
              <button className="btn btn--secondary btn--compact" onClick={async () => { try { await apiClient.resumeRun(item.id); addToast('Pipeline resumed', 'success'); } catch { addToast('Resume failed', 'error'); } }}><PlayCircle size={12} /> RESUME</button>
            ) : (
              <button className="btn btn--ghost btn--compact" onClick={async () => { try { await apiClient.pauseRun(item.id); addToast('Pipeline paused', 'success'); } catch { addToast('Pause failed', 'error'); } }}><PauseCircle size={12} /> PAUSE</button>
            )}
            <button className="btn btn--danger btn--compact" onClick={async () => { try { await apiClient.stopRun(item.id); addToast('Pipeline stopped', 'success'); } catch { addToast('Stop failed', 'error'); } }}><Square size={12} /> STOP</button>
          </div>

          <button className="btn btn--ghost btn--compact font-mono mt-3" style={{ fontSize: '10px' }} onClick={toggleStream}>
            <Activity size={10} /> {streaming ? 'Hide Stream' : 'Watch Stream'}
          </button>
          {events.length > 0 && (
            <div className="mt-2 p-3 font-mono overflow-auto" style={{ fontSize: '10px', maxHeight: 120, background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              {events.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {isFailed && (
        <div className="flex gap-2 pt-2">
          <button className="btn btn--secondary btn--compact" onClick={handleRetry}><RotateCcw size={12} /> Retry</button>
          <button className="btn btn--secondary btn--compact" onClick={handleAutofix}><Wrench size={12} /> Autofix</button>
        </div>
      )}

      {isStopped && (
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <span className="label" style={{ fontSize: '9px', letterSpacing: '0.15em' }}>PIPELINE STOPPED</span>
          <button className="btn btn--secondary btn--compact mt-3" onClick={async () => { try { await apiClient.retryRun(item.id); addToast('Pipeline restarted', 'success'); } catch { addToast('Restart failed', 'error'); } }}>
            <PlayCircle size={14} /> START
          </button>
        </div>
      )}

      {isComplete && (
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <span className="label" style={{ fontSize: '9px', letterSpacing: '0.15em' }}>APPLY GENERATED PROMPT</span>

          <div className="mt-3 p-3" style={{ backgroundColor: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <FileText size={10} style={{ color: 'var(--color-text-muted)' }} />
              <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Generated prompt ready</span>
            </div>
            <div className="flex items-center gap-2">
              <ArrowRight size={10} style={{ color: 'var(--color-accent)' }} />
              <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Target: agent model directory</span>
            </div>
          </div>

          <button className="btn btn--ghost btn--compact mt-2 font-mono" style={{ fontSize: '10px' }} onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? 'Hide Diff' : 'Show Diff (new vs existing)'}
          </button>
          {showDiff && (
            <div className="mt-2 p-3 font-mono overflow-auto" style={{ fontSize: '10px', maxHeight: 200, background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <div style={{ color: 'var(--color-success)' }}>+ New prompt content from pipeline run</div>
              <div style={{ color: 'var(--color-danger)' }}>- Previous prompt content (will be overwritten)</div>
              <div style={{ color: 'var(--color-text-disabled)', marginTop: 8, fontStyle: 'italic' }}>
                Full diff available after backend provides content
              </div>
            </div>
          )}

          {!confirming ? (
            <button className="btn btn--forge-outline btn--compact mt-3" onClick={handleApply}><Check size={14} /> Apply prompt</button>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="p-3 font-mono" style={{ fontSize: '10px', backgroundColor: 'rgba(188, 13, 19, 0.1)', border: '1px solid var(--color-accent)', color: 'var(--color-text-primary)', lineHeight: '1.5' }}>
                This will overwrite the existing prompt file. Are you sure?
              </div>
              <div className="flex gap-2">
                <button className="btn btn--secondary btn--compact" onClick={handleApply}><Check size={12} /> Confirm</button>
                <button className="btn btn--ghost btn--compact" onClick={handleDeny}><XCircle size={12} /> Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {item.history && item.history.length > 0 && (
        <div className="pt-2">
          <span className="label">HISTORY</span>
          <div className="mt-2 space-y-1">
            {item.history.slice(0, 10).map((h, i) => (
              <div key={i} className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>{h.ts.slice(11, 19)}</span>{' '}
                {h.event}: {h.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const MappingPanel: React.FC<{ item: Mapping }> = ({ item }) => (
  <div className="space-y-4">
    <Field label="MAPPING ID" value={item.id} />
    <Field label="AGENT" value={item.agentId} />
    <Field label="MODEL" value={item.modelId} />
    <Field label="ROLE" value={item.roleId} />
    <Field label="PROMPT PATH" value={item.promptPath} />
    {item.createdAt && <Field label="CREATED" value={item.createdAt} />}
  </div>
);

const PhasePanel: React.FC<{ item: PipelinePhase }> = ({ item }) => (
  <div className="space-y-4">
    <Field label="PHASE" value={item.phase} />
    <Field label="ENABLED" value={item.enabled ? 'Yes' : 'No'} />
    <div>
      <span className="label">SETTINGS</span>
      <pre className="mt-2 p-3 font-mono overflow-auto" style={{ fontSize: '10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', maxHeight: 200 }}>
        {JSON.stringify(item.settings, null, 2)}
      </pre>
    </div>
  </div>
);

const ResearchPanel: React.FC<{ item: ResearchItem }> = ({ item }) => {
  const { addToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [summary, setSummary] = useState(item.summary || '');

  const handleAccept = async () => {
    try { await apiClient.acceptResearch(item.id); addToast('Research accepted', 'success'); } catch { addToast('Accept failed', 'error'); }
  };
  const handleReject = async () => {
    try { await apiClient.rejectResearch(item.id); addToast('Research rejected', 'success'); } catch { addToast('Reject failed', 'error'); }
  };
  const handleSave = async () => {
    try { await apiClient.updateResearch(item.id, { title, summary }); addToast('Research updated', 'success'); setEditing(false); } catch { addToast('Update failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      <Field label="ID" value={item.id} />
      <Field label="STATUS"><StatusChip status={item.status as StatusType}>{item.status.toUpperCase()}</StatusChip></Field>
      {editing ? (
        <>
          <div><span className="label">TITLE</span><input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><span className="label">SUMMARY</span><textarea className="textarea mt-1" value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
          <div className="flex gap-2">
            <button className="btn btn--primary btn--compact" onClick={handleSave}><Save size={12} /> Save</button>
            <button className="btn btn--ghost btn--compact" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <Field label="TITLE" value={item.title} />
          <Field label="SUMMARY" value={item.summary || '-'} />
          <Field label="CREATED" value={item.createdAt} />
        </>
      )}
      <div className="flex gap-2 pt-2">
        {item.status === 'pending' && (
          <>
            <button className="btn btn--secondary btn--compact" onClick={handleAccept}><Check size={12} /> Accept</button>
            <button className="btn btn--danger btn--compact" onClick={handleReject}><XCircle size={12} /> Reject</button>
          </>
        )}
        {!editing && <button className="btn btn--ghost btn--compact" onClick={() => setEditing(true)}><Edit3 size={12} /> Edit</button>}
      </div>
    </div>
  );
};

const ApprovalPanel: React.FC<{ item: Run }> = ({ item }) => {
  const { addToast } = useToast();
  const [reason, setReason] = useState('');

  const handleApprove = async () => {
    try { await apiClient.approveRun(item.id, reason || 'Approved via UI'); addToast('Approved', 'success'); } catch { addToast('Approve failed', 'error'); }
  };
  const handleDeny = async () => {
    try { await apiClient.denyRun(item.id, reason || 'Denied via UI'); addToast('Denied', 'success'); } catch { addToast('Deny failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      <Field label="RUN ID" value={item.id} />
      <Field label="STATUS"><StatusChip status="pending_approval">REVIEW</StatusChip></Field>
      <Field label="REQUESTED BY" value={item.requestedBy || 'system'} />
      <div><span className="label">REASON</span><input className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional reason..." /></div>
      <div className="flex gap-2 pt-2">
        <button className="btn btn--secondary btn--compact" onClick={handleApprove}><Check size={12} /> Approve</button>
        <button className="btn btn--danger btn--compact" onClick={handleDeny}><XCircle size={12} /> Deny</button>
      </div>
    </div>
  );
};

export const RightPanel: React.FC = () => {
  const { panelOpen, panelType, panelItem, activeTab, setActiveTab, closePanel } = useRightPanel();

  const renderTabContent = () => {
    switch (activeTab) {
      case 'model':
        return panelType === 'model' && panelItem ? <ModelInspector item={panelItem as Model} /> : <div className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Select a model to inspect it here.</div>;
      case 'run':
        if ((panelType === 'run' || panelType === 'approval') && panelItem) {
          return panelType === 'approval' ? <ApprovalPanel item={panelItem as Run} /> : <RunApplyPanel item={panelItem as Run} />;
        }
        return <div className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Select a run to inspect stream, controls, and apply actions.</div>;
      case 'phase':
        if (panelType === 'phase' && panelItem) {
          return <PhasePanel item={panelItem as PipelinePhase} />;
        }
        return <PhaseSettingsPanel />;
      case 'overview':
      default:
        if (panelType === 'research' && panelItem) return <ResearchPanel item={panelItem as ResearchItem} />;
        if (panelType === 'mapping' && panelItem) return <MappingPanel item={panelItem as Mapping} />;
        return <SystemOverview />;
    }
  };

  const tabs: Array<{ key: 'overview' | 'run' | 'model' | 'phase'; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'run', label: 'Run' },
    { key: 'model', label: 'Model' },
    { key: 'phase', label: 'Phase Settings' },
  ];

  return (
    <div className="flex-shrink-0 flex flex-col" style={{ width: 'var(--inspector-width)', minWidth: 'var(--inspector-width)', backgroundColor: 'var(--color-inspector-bg)', borderLeft: '1px solid var(--color-border)', overflow: 'hidden' }}>
      <div className="px-5" style={{ height: 'var(--header-height)', minHeight: 'var(--header-height)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="font-mono font-medium uppercase" style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.15em', color: 'var(--color-text-secondary)' }}>
          Inspector
        </span>
        {panelOpen && panelType && (
          <button onClick={closePanel} className="btn--ghost" style={{ background: 'transparent', border: 'none', padding: 4, color: 'var(--color-text-secondary)' }} aria-label="Close panel">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="px-3 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
        <div className="flex gap-2 flex-wrap">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="font-mono"
                style={{
                  height: 28,
                  padding: '0 10px',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  border: isActive ? '1px solid var(--color-border-highlight)' : '1px solid var(--color-border-subtle)',
                  background: isActive ? 'rgba(172, 170, 158, 0.05)' : 'transparent',
                  color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 animate-fade-in">
        {renderTabContent()}
      </div>
    </div>
  );
};

export default RightPanel;
