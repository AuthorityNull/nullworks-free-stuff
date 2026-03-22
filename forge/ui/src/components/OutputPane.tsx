import React, { useState, useEffect, useRef } from 'react';
import { Loader, Check, X, Clock3, Activity } from 'lucide-react';
import { useOutputPane } from '../context/OutputPaneContext';
import apiClient from '../api/client';
import type { PipelineStreamEvent } from '../api/types';
import ForgeMark from './ForgeMark';

type StreamPhase = { name: string; status: string };
type StreamLane = 'research' | 'prompt' | 'system' | 'error';
type StreamEntry = {
  id: string;
  eventName: string;
  label: string;
  message: string;
  rawData?: string;
  ts?: string;
  phase?: string;
  artifactKind?: 'research' | 'prompt' | 'log';
  lane: StreamLane;
};

const PhaseIndicator: React.FC<{ name: string; status: string }> = ({ name, status }) => (
  <div
    className="flex items-center gap-2 px-3 py-1.5 font-mono uppercase"
    style={{
      fontSize: '10px',
      letterSpacing: '0.12em',
      color:
        status === 'completed' ? 'var(--color-success)'
        : status === 'running' ? 'var(--color-accent)'
        : status === 'failed' ? 'var(--color-danger)'
        : 'var(--color-text-disabled)',
    }}
  >
    {status === 'running' && (
      <Loader size={10} style={{ animation: 'spin 1.5s linear infinite' }} />
    )}
    {status === 'completed' && <span style={{ fontSize: '10px' }}>{'\u2713'}</span>}
    {status === 'failed' && <span style={{ fontSize: '10px' }}>{'\u2717'}</span>}
    {status === 'pending' && <span style={{ fontSize: '10px', opacity: 0.4 }}>{'\u25CB'}</span>}
    {name}
  </div>
);

const emberStyleId = 'forge-ember-glow';
if (typeof document !== 'undefined' && !document.getElementById(emberStyleId)) {
  const style = document.createElement('style');
  style.id = emberStyleId;
  style.textContent = `
    @keyframes emberPulse {
      0%, 100% { filter: drop-shadow(0 0 40px rgba(188, 13, 19, 0.18)) drop-shadow(0 0 90px rgba(188, 13, 19, 0.1)); opacity: 0.12; }
      50% { filter: drop-shadow(0 0 58px rgba(188, 13, 19, 0.34)) drop-shadow(0 0 120px rgba(188, 13, 19, 0.18)); opacity: 0.22; }
    }

    @keyframes clawStrike {
      0%, 18%, 100% { transform: rotate(-18deg) translateY(-6px); }
      28% { transform: rotate(12deg) translateY(18px); }
      34% { transform: rotate(-4deg) translateY(8px); }
      44% { transform: rotate(-18deg) translateY(-4px); }
    }

    @keyframes clawRecoil {
      0%, 18%, 100% { transform: translateY(0); }
      28% { transform: translateY(8px); }
      36% { transform: translateY(2px); }
      44% { transform: translateY(0); }
    }

    @keyframes forgeSparks {
      0%, 100% { opacity: 0.12; transform: scale(0.92) translateY(0); }
      30% { opacity: 0.9; transform: scale(1.06) translateY(-8px); }
      60% { opacity: 0.2; transform: scale(0.98) translateY(-18px); }
    }

    @keyframes forgeWordmarkPulse {
      0%, 100% { opacity: 0.12; letter-spacing: 0.18em; }
      50% { opacity: 0.2; letter-spacing: 0.22em; }
    }
  `;
  document.head.appendChild(style);
}

function patchPhases(prev: StreamPhase[], eventName: string, payload: Record<string, unknown>): StreamPhase[] {
  const phase = typeof payload.phase === 'string' ? payload.phase : '';
  if (!phase) return prev;

  const status =
    eventName === 'phase.started' ? 'running'
    : eventName === 'phase.completed' ? 'completed'
    : eventName === 'phase.failed' ? 'failed'
    : '';

  if (!status) return prev;

  const next = [...prev];
  const index = next.findIndex((entry) => entry.name === phase);
  if (index === -1) {
    next.push({ name: phase, status });
  } else {
    next[index] = { ...next[index], status };
  }
  return next;
}

function prettyEventLabel(eventName: string, payload: Record<string, unknown>): string {
  const phase = typeof payload.phase === 'string' ? payload.phase : '';
  switch (eventName) {
    case 'phase.started':
      return phase ? `${phase.toUpperCase()} STARTED` : 'PHASE STARTED';
    case 'phase.completed':
      return phase ? `${phase.toUpperCase()} COMPLETED` : 'PHASE COMPLETED';
    case 'phase.failed':
      return phase ? `${phase.toUpperCase()} FAILED` : 'PHASE FAILED';
    case 'approval.required':
      return 'APPROVAL REQUIRED';
    case 'approval.applied':
      return 'APPROVAL UPDATED';
    case 'run.started':
      return 'RUN STARTED';
    case 'run.completed':
      return 'RUN COMPLETED';
    case 'run.failed':
      return 'RUN FAILED';
    case 'log':
      return 'STREAM';
    case 'token':
      return 'TOKEN';
    case 'connected':
      return 'STREAM CONNECTED';
    default:
      return eventName.replace(/\./g, ' ').toUpperCase();
  }
}

function inferArtifactKind(eventName: string, payload: Record<string, unknown>, raw: string): 'research' | 'prompt' | 'log' {
  const haystack = `${eventName}\n${typeof payload.message === 'string' ? payload.message : ''}\n${raw}`.toLowerCase();
  if (haystack.includes('research') || haystack.includes('artifact') || haystack.includes('source note') || haystack.includes('accepted item')) {
    return 'research';
  }
  if (haystack.includes('assembled prompt') || haystack.includes('generated prompt') || haystack.includes('system prompt') || haystack.includes('prompt text') || haystack.includes('prompt source') || eventName === 'token') {
    return 'prompt';
  }
  return 'log';
}

function inferLane(entry: Pick<StreamEntry, 'eventName' | 'artifactKind'>): StreamLane {
  if (entry.eventName === 'run.failed' || entry.eventName === 'phase.failed' || entry.eventName === 'error') return 'error';
  if (entry.artifactKind === 'research') return 'research';
  if (entry.artifactKind === 'prompt' || entry.eventName === 'token') return 'prompt';
  return 'system';
}

function narrativeMessage(eventName: string, payload: Record<string, unknown>, raw: string): string {
  const phase = typeof payload.phase === 'string' ? payload.phase : '';
  const message = typeof payload.message === 'string' ? payload.message : '';
  const phaseLabel = phase ? phase.replace(/[-_]+/g, ' ') : '';

  if (message) {
    if (eventName === 'token') return message;
    if (eventName === 'log') return message;
    return message;
  }

  switch (eventName) {
    case 'phase.started':
      return phaseLabel ? `Entering ${phaseLabel}.` : 'Entering next phase.';
    case 'phase.completed':
      return phaseLabel ? `${phaseLabel} finished.` : 'Phase finished.';
    case 'phase.failed':
      return phaseLabel ? `${phaseLabel} failed.` : 'Phase failed.';
    case 'approval.required':
      return 'Waiting for approval before writing the prompt.';
    case 'approval.applied':
      return 'Approval decision recorded.';
    case 'run.started':
      return 'Run opened. Building the research and prompt story now.';
    case 'run.completed':
      return 'Run completed. Full assembled system prompt is ready below.';
    case 'run.failed':
      return 'Run failed.';
    case 'connected':
      return 'Live stream connected.';
    case 'token':
      return raw || '';
    default:
      return raw || eventName;
  }
}

const OutputPane: React.FC = () => {
  const { view, activeRunId } = useOutputPane();
  const [events, setEvents] = useState<StreamEntry[]>([]);
  const [phases, setPhases] = useState<StreamPhase[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedText, setGeneratedText] = useState('');
  const [approving, setApproving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (view !== 'pipeline' || !activeRunId) {
      return;
    }

    setEvents([]);
    setPhases([]);
    setIsComplete(false);
    setError(null);
    setGeneratedText('');

    const es = apiClient.createRunStream(activeRunId);
    esRef.current = es;

    const pushEntry = (eventName: string, rawData: string) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = rawData ? JSON.parse(rawData) : {};
      } catch {
        payload = {};
      }

      setPhases((prev) => patchPhases(prev, eventName, payload));
      setEvents((prev) => ([
        ...prev,
        (() => {
          const artifactKind = inferArtifactKind(eventName, payload, rawData);
          return {
            id: `${eventName}-${(payload.ts as string | undefined) || Date.now()}-${prev.length}`,
            eventName,
            label: prettyEventLabel(eventName, payload),
            message: narrativeMessage(eventName, payload, rawData),
            rawData,
            ts: typeof payload.ts === 'string' ? payload.ts : undefined,
            phase: typeof payload.phase === 'string' ? payload.phase : undefined,
            artifactKind,
            lane: inferLane({ eventName, artifactKind }),
          };
        })(),
      ].slice(-80)));

      if (eventName === 'run.completed') {
        setIsComplete(true);
        if (typeof (payload as any).generatedPrompt === 'string') {
          setGeneratedText((payload as any).generatedPrompt as string);
        }
      }

      if (eventName === 'run.failed' || eventName === 'phase.failed' || eventName === 'error') {
        setError((typeof payload.message === 'string' && payload.message) || 'Stream error');
      }
    };

    es.addEventListener('connected', () => pushEntry('connected', ''));
    es.addEventListener('heartbeat', () => {});
    es.addEventListener('phase.started', (e: MessageEvent) => pushEntry('phase.started', e.data));
    es.addEventListener('phase.completed', (e: MessageEvent) => pushEntry('phase.completed', e.data));
    es.addEventListener('phase.failed', (e: MessageEvent) => pushEntry('phase.failed', e.data));
    es.addEventListener('approval.required', (e: MessageEvent) => pushEntry('approval.required', e.data));
    es.addEventListener('approval.applied', (e: MessageEvent) => pushEntry('approval.applied', e.data));
    es.addEventListener('run.started', (e: MessageEvent) => pushEntry('run.started', e.data));
    es.addEventListener('log', (e: MessageEvent) => pushEntry('log', e.data));
    es.addEventListener('token', (e: MessageEvent) => pushEntry('token', e.data));
    es.addEventListener('run.completed', (e: MessageEvent) => {
      pushEntry('run.completed', e.data);
      es.close();
    });
    es.addEventListener('run.failed', (e: MessageEvent) => {
      pushEntry('run.failed', e.data);
      es.close();
    });
    es.addEventListener('error', (e: MessageEvent) => {
      pushEntry('error', e.data || '');
      es.close();
    });

    es.onmessage = (e) => {
      try {
        const data: PipelineStreamEvent = JSON.parse(e.data);
        if (data.type === 'phase_update' && data.phases) {
          setPhases(data.phases.map((p) => ({ name: p.name, status: p.status })));
        }
        pushEntry(data.type || 'message', e.data);
      } catch {
        pushEntry('message', e.data);
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [view, activeRunId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const handleApprove = async () => {
    if (!activeRunId) return;
    setApproving(true);
    try {
      const targetEvent = [...events].reverse().find((entry) => entry.eventName === 'run.started');
      const target = targetEvent ? JSON.parse((targetEvent as any).rawData || '{}') : {};
      await apiClient.applyPrompt({
        runId: activeRunId,
        agentId: typeof target.targetAgent === 'string' ? target.targetAgent : undefined,
        modelId: typeof target.model === 'string' ? target.model : undefined,
        promptPath: typeof target.promptPath === 'string' ? target.promptPath : undefined,
        apply: generatedText,
      });
    } catch {
      // errors surfaced via toasts elsewhere
    }
    setApproving(false);
  };

  const researchEntries = events.filter((entry) => entry.lane === 'research');
  const promptEntries = events.filter((entry) => entry.lane === 'prompt');
  const systemEntries = events.filter((entry) => entry.lane === 'system');
  const errorEntries = events.filter((entry) => entry.lane === 'error');

  const handleDiscard = () => {
    setGeneratedText('');
    setIsComplete(false);
  };

  if (view === 'pipeline' && activeRunId) {
    return (
      <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
        {phases.length > 0 && (
          <div
            className="flex items-center gap-4 px-4 py-2 flex-shrink-0"
            style={{
              borderBottom: '1px solid var(--color-border-subtle)',
              backgroundColor: 'rgba(172, 170, 158, 0.02)',
            }}
          >
            {phases.map((p) => (
              <PhaseIndicator key={p.name} name={p.name} status={p.status} />
            ))}
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto p-5 font-mono"
          style={{
            fontSize: '11px',
            color: 'var(--color-text-secondary)',
            lineHeight: '1.6',
          }}
        >
          {events.length === 0 && !isComplete && !error && (
            <div
              className="flex flex-col items-center justify-center gap-4"
              style={{ color: 'var(--color-text-muted)', minHeight: '100%' }}
            >
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{
                  border: '1px solid rgba(172, 170, 158, 0.18)',
                  background: 'rgba(172, 170, 158, 0.02)',
                }}
              >
                <Activity size={12} style={{ color: 'var(--color-accent)', animation: 'statusPulse 1.6s ease-in-out infinite' }} />
                <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: 'var(--color-text-primary)' }}>
                  Connecting run stream
                </span>
              </div>
              <div className="grid gap-2" style={{ width: '100%', maxWidth: 560 }}>
                {['Research discovered', 'Research selected', 'Prompt assembled', 'Prompt ready to apply'].map((step, index) => (
                  <div
                    key={step}
                    className="flex items-center gap-3 px-3 py-2"
                    style={{
                      border: '1px solid rgba(172, 170, 158, 0.12)',
                      background: index === 0 ? 'rgba(188, 13, 19, 0.04)' : 'rgba(172, 170, 158, 0.02)',
                    }}
                  >
                    <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.12em', color: 'var(--color-text-disabled)' }}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="font-mono" style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {events.length > 0 && (
            <div className="grid gap-4">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)' }}>
                <div
                  className="p-3"
                  style={{
                    border: '1px solid var(--color-border-subtle)',
                    background: 'rgba(172, 170, 158, 0.02)',
                  }}
                >
                  <div className="font-mono uppercase mb-2" style={{ fontSize: '9px', letterSpacing: '0.16em', color: 'var(--color-text-muted)' }}>
                    Research used
                  </div>
                  <div className="grid gap-2">
                    {researchEntries.length === 0 ? (
                      <div className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
                        Waiting for research artifacts.
                      </div>
                    ) : researchEntries.map((entry) => (
                      <div key={entry.id} className="p-2" style={{ border: '1px solid rgba(172, 170, 158, 0.1)', background: 'rgba(172, 170, 158, 0.025)' }}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.14em', color: 'var(--color-text-muted)' }}>{entry.label}</span>
                          <span className="font-mono" style={{ fontSize: '9px', color: 'var(--color-text-disabled)' }}>{entry.ts ? entry.ts.slice(11, 19) : ''}</span>
                        </div>
                        <div className="font-mono" style={{ fontSize: '11px', lineHeight: '1.55', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {entry.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className="p-3"
                  style={{
                    border: '1px solid rgba(188, 13, 19, 0.22)',
                    background: 'rgba(188, 13, 19, 0.04)',
                  }}
                >
                  <div className="font-mono uppercase mb-2" style={{ fontSize: '9px', letterSpacing: '0.16em', color: 'var(--color-accent)' }}>
                    System prompt assembly
                  </div>
                  <div className="grid gap-2">
                    {promptEntries.length === 0 ? (
                      <div className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
                        Waiting for prompt text.
                      </div>
                    ) : promptEntries.map((entry) => (
                      <div key={entry.id} className="p-2" style={{ border: '1px solid rgba(188, 13, 19, 0.14)', background: entry.eventName === 'token' ? 'rgba(188, 13, 19, 0.08)' : 'rgba(188, 13, 19, 0.03)' }}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.14em', color: 'var(--color-accent)' }}>{entry.label}</span>
                          <span className="font-mono" style={{ fontSize: '9px', color: 'var(--color-text-disabled)' }}>{entry.ts ? entry.ts.slice(11, 19) : ''}</span>
                        </div>
                        <div className="font-mono" style={{ fontSize: entry.eventName === 'token' ? '12px' : '11px', lineHeight: '1.6', color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {entry.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                className="p-3"
                style={{
                  border: '1px solid var(--color-border-subtle)',
                  background: 'rgba(172, 170, 158, 0.02)',
                }}
              >
                <div className="font-mono uppercase mb-2" style={{ fontSize: '9px', letterSpacing: '0.16em', color: 'var(--color-text-muted)' }}>
                  Run orchestration
                </div>
                <div className="grid gap-2">
                  {systemEntries.map((entry) => {
                    const isCritical = entry.lane === 'error';
                    const isApproval = entry.eventName.startsWith('approval.');
                    const isCompletion = entry.eventName === 'run.completed';
                    const isPhase = entry.eventName.startsWith('phase.');

                    return (
                      <div
                        key={entry.id}
                        className="p-2"
                        style={{
                          border: '1px solid var(--color-border-subtle)',
                          background: isApproval ? 'var(--color-accent-subtle)' : 'rgba(172, 170, 158, 0.025)',
                        }}
                      >
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <div
                            className="font-mono uppercase"
                            style={{
                              fontSize: '9px',
                              letterSpacing: '0.16em',
                              color: isCritical
                                ? 'var(--color-danger)'
                                : isCompletion
                                  ? 'var(--color-success)'
                                  : isApproval
                                    ? 'var(--color-accent)'
                                    : isPhase
                                      ? 'var(--color-text-primary)'
                                      : 'var(--color-text-secondary)',
                            }}
                          >
                            {entry.label}
                          </div>
                          <div className="flex items-center gap-2" style={{ color: 'var(--color-text-disabled)' }}>
                            {entry.ts && <Clock3 size={10} />}
                            <span className="font-mono" style={{ fontSize: '9px' }}>
                              {entry.ts ? entry.ts.slice(11, 19) : ''}
                            </span>
                          </div>
                        </div>
                        <div className="font-mono" style={{ color: 'var(--color-text-secondary)', fontSize: '11px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {entry.message}
                        </div>
                      </div>
                    );
                  })}
                  {errorEntries.map((entry) => (
                    <div key={entry.id} className="p-2" style={{ border: '1px solid rgba(188, 13, 19, 0.28)', background: 'var(--color-danger-muted)' }}>
                      <div className="font-mono uppercase mb-1" style={{ fontSize: '9px', letterSpacing: '0.16em', color: 'var(--color-danger)' }}>{entry.label}</div>
                      <div className="font-mono" style={{ color: 'var(--color-text-primary)', fontSize: '11px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{entry.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isComplete && (
            <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
              {generatedText && (
                <>
                  <label
                    className="font-mono block mb-2 uppercase"
                    style={{ fontSize: '9px', letterSpacing: '0.15em', color: 'var(--color-text-muted)' }}
                  >
                    Full Assembled System Prompt
                  </label>
                  <textarea
                    className="w-full font-mono"
                    style={{
                      fontSize: '11px',
                      lineHeight: '1.6',
                      backgroundColor: 'rgba(172, 170, 158, 0.03)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                      padding: '12px',
                      minHeight: 160,
                      resize: 'vertical',
                      outline: 'none',
                    }}
                    value={generatedText}
                    onChange={(e) => setGeneratedText(e.target.value)}
                  />
                </>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  className="btn btn--forge-outline btn--compact"
                  style={{ minWidth: 148 }}
                  onClick={handleApprove}
                  disabled={approving}
                >
                  <Check size={12} /> {approving ? 'Applying...' : 'Approve'}
                </button>
                <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                  Apply the exact assembled prompt shown above to the resolved target prompt path.
                </span>
              </div>

              <button
                className="flex items-center justify-center gap-1 font-mono mt-2"
                style={{
                  height: 32,
                  fontSize: '10px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  transition: 'color 100ms linear',
                }}
                onClick={handleDiscard}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-danger)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
              >
                <X size={10} /> Discard
              </button>
            </div>
          )}

          {error && (
            <div
              className="mt-4 pt-3 flex items-center gap-2"
              style={{ borderTop: '1px solid var(--color-border-subtle)', color: 'var(--color-danger)' }}
            >
              <span style={{ fontSize: '12px' }}>{'\u2717'}</span>
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Idle state - OpenClaw pulse
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 260,
          height: 260,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(188, 13, 19, 0.12) 0%, rgba(188, 13, 19, 0.03) 46%, transparent 74%)',
          animation: 'emberPulse 4s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 120,
            height: 120,
            border: '1px solid rgba(172, 170, 158, 0.16)',
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(172, 170, 158, 0.015)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, transparent 0%, rgba(188, 13, 19, 0.14) 50%, transparent 100%)',
              transform: 'translateY(-100%)',
              animation: 'openclawSweep 2.4s linear infinite',
            }}
          />
          <div
            style={{
              animation: 'emberPulse 4s ease-in-out infinite',
              color: '#35322f',
              position: 'relative',
              textAlign: 'center',
            }}
          >
            <ForgeMark size={92} />
          </div>
        </div>
        <div className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.16em', color: 'var(--color-text-muted)' }}>
          OpenClaw standby
        </div>
      </div>
    </div>
  );
};

export default OutputPane;