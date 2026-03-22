import React, { useState, useEffect } from 'react';
import { RotateCcw, Wrench, ChevronRight } from 'lucide-react';
import apiClient from '../api/client';
import type { Run } from '../api/types';
import StatusChip from '../components/StatusChip';
import type { StatusType } from '../components/StatusChip';
import { useToast } from '../components/Toast';

function mapRunStatus(s: string): StatusType {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  if (s.includes('retry') || s.includes('autofix')) return 'warning';
  if (s === 'started' || s === 'running') return 'running';
  if (s === 'queued') return 'pending';
  return 'info';
}

const Runs: React.FC = () => {
  const { addToast } = useToast();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [detailRun, setDetailRun] = useState<Run | null>(null);
  const [streamEvents, setStreamEvents] = useState<string[]>([]);

  useEffect(() => {
    apiClient.getRuns()
      .then(setRuns)
      .catch(() => addToast('Failed to load runs', 'error'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectRun = async (run: Run) => {
    setSelectedRun(run);
    setStreamEvents([]);
    try {
      const detail = await apiClient.getRun(run.id);
      setDetailRun(detail);
    } catch {
      setDetailRun(run);
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await apiClient.retryRun(id);
      addToast('Retry scheduled', 'success');
      const updated = await apiClient.getRuns();
      setRuns(updated);
    } catch {
      addToast('Retry failed', 'error');
    }
  };

  const handleAutofix = async (id: string) => {
    try {
      await apiClient.autofixRun(id);
      addToast('Autofix scheduled', 'success');
      const updated = await apiClient.getRuns();
      setRuns(updated);
    } catch {
      addToast('Autofix failed', 'error');
    }
  };

  const watchStream = (runId: string) => {
    const es = apiClient.createRunStream(runId);
    es.onmessage = (e) => {
      setStreamEvents((prev) => [...prev, e.data].slice(-100));
    };
    es.onerror = () => es.close();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <span className="loading-cursor" />
      </div>
    );
  }

  return (
    <div className="flex h-full" style={{ minHeight: 0 }}>
      {/* Left list */}
      <div
        className="flex flex-col flex-shrink-0 overflow-auto"
        style={{
          width: 320,
          borderRight: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-sidebar)',
        }}
      >
        <div
          className="px-4 flex items-center"
          style={{
            height: 'var(--header-height)',
            minHeight: 'var(--header-height)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <h1
            className="font-ui font-semibold uppercase"
            style={{ fontSize: 'var(--text-sm)', letterSpacing: '0.15em', color: 'var(--color-text-primary)' }}
          >
            Run History
          </h1>
        </div>
        <div className="flex-1 py-1">
          {runs.map((r) => {
            const active = selectedRun?.id === r.id;
            return (
              <button
                key={r.id}
                onClick={() => selectRun(r)}
                className="flex items-center justify-between w-full px-4 py-3"
                style={{
                  background: active ? 'var(--color-surface-elevated)' : 'transparent',
                  borderLeft: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                  border: 'none',
                  borderLeftStyle: 'solid',
                  borderLeftWidth: 2,
                  borderLeftColor: active ? 'var(--color-accent)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background var(--transition-fast)',
                }}
              >
                <div className="text-left">
                  <div className="font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                    {r.id}
                  </div>
                  <div className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                    {r.requestedAt?.slice(0, 16).replace('T', ' ') || '-'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={mapRunStatus(r.status)}>{r.status.toUpperCase()}</StatusChip>
                  <ChevronRight size={12} style={{ color: 'var(--color-text-disabled)' }} />
                </div>
              </button>
            );
          })}
          {runs.length === 0 && (
            <div className="px-4 py-8 text-center">
              <span className="font-mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                No runs recorded
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Right detail */}
      <div className="flex-1 flex flex-col min-w-0 overflow-auto p-6">
        {detailRun ? (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="font-mono font-semibold" style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-primary)' }}>
                {detailRun.id}
              </h2>
              <StatusChip status={mapRunStatus(detailRun.status)}>{detailRun.status.toUpperCase()}</StatusChip>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="label">PHASE</span>
                <div className="mt-1 font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                  {detailRun.phase}
                </div>
              </div>
              <div>
                <span className="label">REQUESTED BY</span>
                <div className="mt-1 font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                  {detailRun.requestedBy || 'system'}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="btn btn--secondary btn--compact" onClick={() => handleRetry(detailRun.id)}>
                <RotateCcw size={12} /> Retry
              </button>
              <button className="btn btn--secondary btn--compact" onClick={() => handleAutofix(detailRun.id)}>
                <Wrench size={12} /> Autofix
              </button>
              <button className="btn btn--ghost btn--compact" onClick={() => watchStream(detailRun.id)}>
                Watch Stream
              </button>
            </div>

            {streamEvents.length > 0 && (
              <div
                className="p-3 font-mono overflow-auto"
                style={{
                  fontSize: '10px',
                  maxHeight: 200,
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {streamEvents.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}

            {detailRun.history && detailRun.history.length > 0 && (
              <div>
                <span className="label">HISTORY</span>
                <div className="mt-2 space-y-1">
                  {detailRun.history.map((h, i) => (
                    <div key={i} className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>{h.ts.slice(11, 19)}</span>{' '}
                      <span style={{ color: 'var(--color-text-primary)' }}>{h.event}</span>{' '}
                      {h.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Select a run to view details
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Runs;
