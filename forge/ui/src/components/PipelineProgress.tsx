import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import apiClient from '../api/client';

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

interface PipelineProgressProps {
  runId: string | null;
  onClose: () => void;
}

const PipelineProgress: React.FC<PipelineProgressProps> = ({ runId, onClose }) => {
  const [phases, setPhases] = useState<PhaseState[]>(DEFAULT_PHASES);
  const [summary, setSummary] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const connectStream = useCallback((id: string) => {
    setPhases(DEFAULT_PHASES.map(p => ({ ...p })));
    setSummary(null);
    setExpanded(true);

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
        } else if (data.type === 'log' && data.phase) {
          setPhases(prev =>
            prev.map(p =>
              p.name.toLowerCase() === data.phase.toLowerCase()
                ? { ...p, message: data.message || p.message }
                : p,
            ),
          );
        } else if (data.type === 'complete') {
          setSummary(data.summary || 'Pipeline completed');
          setTimeout(() => setExpanded(false), 3000);
        } else if (data.type === 'error') {
          setSummary(data.message || 'Pipeline failed');
        }
      } catch {
        // raw text event - apply to first running phase
        setPhases(prev => {
          const idx = prev.findIndex(p => p.status === 'running');
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], message: event.data };
            return next;
          }
          return prev;
        });
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (runId) {
      connectStream(runId);
    }
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [runId, connectStream]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [phases]);

  if (!runId) return null;

  const activePhase = phases.find(p => p.status === 'running');

  return (
    <div
      style={{
        overflow: 'hidden',
        maxHeight: expanded ? 400 : (summary ? 40 : 0),
        transition: 'max-height 200ms linear',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      {/* Summary bar (collapsed state) */}
      {summary && !expanded && (
        <div
          className="flex items-center justify-between px-4 cursor-pointer"
          style={{ height: 40 }}
          onClick={() => setExpanded(true)}
        >
          <span
            className="font-mono"
            style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}
          >
            {summary}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-disabled)', padding: 4 }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Expanded progress view */}
      {expanded && (
        <div className="px-4 py-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <span
              className="font-mono uppercase"
              style={{ fontSize: '10px', letterSpacing: '0.15em', color: 'var(--color-text-muted)' }}
            >
              PIPELINE RUN {runId.slice(0, 8)}
            </span>
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-disabled)', padding: 4 }}
            >
              <X size={12} />
            </button>
          </div>

          {/* Phase rows */}
          <div className="space-y-1" ref={logRef}>
            {phases.map((phase) => (
              <div
                key={phase.name}
                className="flex items-center gap-3 py-1 px-2"
                style={{
                  backgroundColor: phase.status === 'running' ? 'var(--color-surface-elevated)' : 'transparent',
                  transition: 'background-color 100ms linear',
                }}
              >
                {/* Status dot */}
                <span
                  className="status-dot"
                  style={{
                    backgroundColor: STATUS_COLORS[phase.status],
                    animation: phase.status === 'running' ? 'statusPulse 2s ease-in-out infinite' : 'none',
                  }}
                />

                {/* Phase name */}
                <span
                  className="font-mono uppercase"
                  style={{
                    fontSize: '10px',
                    letterSpacing: '0.15em',
                    color: phase.status === 'running' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                    width: 80,
                    flexShrink: 0,
                  }}
                >
                  {phase.name}
                </span>

                {/* Streaming text */}
                <span
                  className="font-mono flex-1 truncate"
                  style={{
                    fontSize: '11px',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {phase.status === 'running' && (
                    <>
                      {phase.message || 'Processing...'}
                      <span className="loading-cursor ml-1" style={{ width: 4, height: 10, display: 'inline-block', verticalAlign: 'middle' }} />
                    </>
                  )}
                  {phase.status === 'completed' && (phase.message || 'Done')}
                  {phase.status === 'failed' && (
                    <span style={{ color: 'var(--color-danger)' }}>{phase.message || 'Failed'}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Active phase detail */}
          {activePhase && activePhase.message && (
            <div
              className="mt-2 px-2 py-1 font-mono"
              style={{
                fontSize: '10px',
                color: 'var(--color-text-muted)',
                borderTop: '1px solid var(--color-border-subtle)',
              }}
            >
              {activePhase.message}
            </div>
          )}

          {/* Summary */}
          {summary && (
            <div
              className="mt-3 px-2 py-2 font-mono"
              style={{
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
                borderTop: '1px solid var(--color-border)',
              }}
            >
              {summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PipelineProgress;
