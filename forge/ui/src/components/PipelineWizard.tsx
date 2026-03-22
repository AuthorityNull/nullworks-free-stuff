import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import apiClient from '../api/client';
import { useOutputPane } from '../context/OutputPaneContext';

interface PhaseState {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
}

const DEFAULT_PHASES: PhaseState[] = [
  { name: 'INIT', status: 'pending', message: '' },
  { name: 'RESEARCH', status: 'pending', message: '' },
  { name: 'EVALUATE', status: 'pending', message: '' },
  { name: 'GENERATE', status: 'pending', message: '' },
  { name: 'VALIDATE', status: 'pending', message: '' },
  { name: 'COVERAGE', status: 'pending', message: '' },
  { name: 'APPROVE', status: 'pending', message: '' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--color-text-disabled)',
  running: 'var(--color-warning)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
};

const STATUS_MESSAGES = [
  'evaluating model profiles...',
  'scanning research corpus...',
  'computing coverage metrics...',
  'generating adversarial tests...',
  'writing AGENTS.md...',
  'writing SOUL.md...',
  'running adversarial pass...',
  'validating prompt integrity...',
  'checking constraint alignment...',
  'computing diff coverage...',
];

const PipelineWizard: React.FC = () => {
  const { activeRunId, clearPane } = useOutputPane();
  const [phases, setPhases] = useState<PhaseState[]>(DEFAULT_PHASES.map(p => ({ ...p })));
  const [summary, setSummary] = useState<string | null>(null);
  const [streamLog, setStreamLog] = useState<string[]>([]);
  const [statusText, setStatusText] = useState('Initializing pipeline...');
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connectStream = useCallback((id: string) => {
    setPhases(DEFAULT_PHASES.map(p => ({ ...p })));
    setSummary(null);
    setStreamLog([]);

    const es = apiClient.createRunStream(id);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'phase_update' && data.phase) {
          setPhases(prev =>
            prev.map(p =>
              p.name.toLowerCase() === data.phase.toLowerCase()
                ? { ...p, status: data.status || p.status, message: data.message || p.message }
                : p,
            ),
          );
          if (data.message) setStatusText(data.message);
        } else if (data.type === 'log') {
          setStreamLog(prev => [...prev, data.message || event.data].slice(-200));
          if (data.message) setStatusText(data.message);
        } else if (data.type === 'complete') {
          setSummary(data.summary || 'Pipeline completed');
          setStatusText('Pipeline completed');
        } else if (data.type === 'error') {
          setSummary(data.message || 'Pipeline failed');
          setStatusText('Pipeline failed');
        }
      } catch {
        setStreamLog(prev => [...prev, event.data].slice(-200));
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  // Rotating status text for demo feel
  useEffect(() => {
    if (!summary) {
      statusIntervalRef.current = setInterval(() => {
        const running = phases.find(p => p.status === 'running');
        if (!running) return;
        const msg = STATUS_MESSAGES[Math.floor(Math.random() * STATUS_MESSAGES.length)];
        setStatusText(msg);
      }, 2500);
    }
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    };
  }, [summary, phases]);

  useEffect(() => {
    if (activeRunId) connectStream(activeRunId);
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [activeRunId, connectStream]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [streamLog]);

  if (!activeRunId) return null;

  const completedCount = phases.filter(p => p.status === 'completed').length;
  const progress = Math.round((completedCount / phases.length) * 100);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5"
        style={{
          height: 56,
          minHeight: 56,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.15em', color: 'var(--color-text-muted)' }}>
            Pipeline Run
          </span>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--color-text-primary)' }}>
            {activeRunId}
          </span>
        </div>
        <button
          onClick={clearPane}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: 4 }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: 'var(--color-border)' }}>
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: summary ? 'var(--color-success)' : 'var(--color-accent)',
            transition: 'width 300ms linear',
          }}
        />
      </div>

      {/* Status text */}
      <div
        className="px-5 py-2 flex items-center gap-2"
        style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
      >
        {!summary && (
          <span className="loading-cursor" style={{ width: 4, height: 10 }} />
        )}
        <span className="font-mono" style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
          {statusText}
        </span>
      </div>

      {/* Phase indicators */}
      <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex gap-2 flex-wrap">
          {phases.map((phase, i) => (
            <React.Fragment key={phase.name}>
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{
                  border: '1px solid var(--color-border)',
                  background: phase.status === 'running' ? 'var(--color-surface-elevated)' : 'var(--color-surface)',
                }}
              >
                <span
                  className="status-dot"
                  style={{
                    backgroundColor: STATUS_COLORS[phase.status],
                    animation: phase.status === 'running' ? 'statusPulse 2s ease-in-out infinite' : 'none',
                  }}
                />
                <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.15em', color: 'var(--color-text-secondary)' }}>
                  {phase.name}
                </span>
              </div>
              {i < phases.length - 1 && (
                <span className="flex items-center" style={{ color: 'var(--color-text-disabled)', fontSize: '10px' }}>
                  &rarr;
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Live stream log */}
      <div
        ref={logRef}
        className="flex-1 overflow-auto p-5 font-mono"
        style={{
          fontSize: '11px',
          lineHeight: '1.6',
          color: 'var(--color-text-secondary)',
          background: 'var(--color-bg)',
        }}
      >
        {streamLog.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)' }}>
            Waiting for pipeline output...
          </div>
        ) : (
          streamLog.map((line, i) => (
            <div key={i} style={{ color: line.includes('error') || line.includes('fail') ? 'var(--color-danger)' : undefined }}>
              {line}
            </div>
          ))
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div
          className="px-5 py-3 font-mono"
          style={{
            fontSize: '12px',
            color: 'var(--color-text-primary)',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          {summary}
        </div>
      )}
    </div>
  );
};

export default PipelineWizard;
