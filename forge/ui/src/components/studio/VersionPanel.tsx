import React, { useEffect, useState } from 'react';
import type { StudioVersion } from '../../api/types';
import { Save, RotateCcw, Check } from 'lucide-react';

interface Props {
  versions: StudioVersion[];
  currentVersionId: string | null;
  onCheckpoint: (label?: string) => void;
  onRestore: (versionId: string) => void;
  checkpointPending?: boolean;
  restorePendingVersionId?: string | null;
  disabled: boolean;
}

const VersionPanel: React.FC<Props> = ({
  versions,
  currentVersionId,
  onCheckpoint,
  onRestore,
  checkpointPending = false,
  restorePendingVersionId = null,
  disabled,
}) => {
  const [checkpointLabel, setCheckpointLabel] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  useEffect(() => {
    if (disabled) {
      setShowCreate(false);
      setConfirmRestore(null);
    }
  }, [disabled]);

  const handleCheckpoint = () => {
    if (disabled || checkpointPending) return;
    onCheckpoint(checkpointLabel.trim() || undefined);
    setCheckpointLabel('');
    setShowCreate(false);
  };

  const handleRestore = (versionId: string) => {
    if (disabled || Boolean(restorePendingVersionId)) return;
    if (confirmRestore === versionId) {
      onRestore(versionId);
      setConfirmRestore(null);
    } else {
      setConfirmRestore(versionId);
      setTimeout(() => setConfirmRestore(null), 4000);
    }
  };

  const sourceLabel = (source: string) => {
    switch (source) {
      case 'ai': return 'AI';
      case 'manual': return 'Manual';
      case 'checkpoint': return 'Checkpoint';
      case 'autosave': return 'Autosave';
      default: return source;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: 10,
            letterSpacing: '0.14em',
            color: '#888',
            textTransform: 'uppercase',
          }}
        >
          Versions
        </span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          disabled={disabled || checkpointPending}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 26,
            padding: '0 8px',
            background: disabled ? 'transparent' : 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4,
            color: disabled ? '#444' : '#aaa',
            cursor: disabled ? 'default' : 'pointer',
            fontFamily: "'SF Mono', monospace",
            fontSize: 10,
          }}
          title="Create a new checkpoint"
        >
          <Save size={12} />
          New checkpoint
        </button>
      </div>

      {/* Checkpoint creator */}
      {showCreate && (
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            flexShrink: 0,
          }}
        >
          <input
            autoFocus
            disabled={disabled || checkpointPending}
            value={checkpointLabel}
            onChange={(e) => setCheckpointLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCheckpoint();
              if (e.key === 'Escape') setShowCreate(false);
            }}
            placeholder="Checkpoint label (optional)..."
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              padding: '6px 10px',
              color: '#e0e0e0',
              fontSize: 12,
              outline: 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
              marginBottom: 6,
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleCheckpoint} disabled={disabled || checkpointPending} style={{ ...actionBtnStyle, opacity: disabled || checkpointPending ? 0.45 : 1, cursor: disabled || checkpointPending ? 'default' : 'pointer' }}>
              <Save size={12} /> {checkpointPending ? 'Creating…' : 'Create checkpoint'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              disabled={disabled}
              style={{ ...actionBtnStyle, color: '#666', background: 'transparent', border: 'none', opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Version list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {versions.length === 0 && (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              height: '100%',
              color: '#444',
              fontSize: 12,
              textAlign: 'center',
              padding: '0 24px',
            }}
          >
            <div>
              <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>📋</div>
              No checkpoints yet.
              <br />
              Save one to track your design iterations.
            </div>
          </div>
        )}

        {versions.map((ver) => {
          const isCurrent = ver.id === currentVersionId;
          const isConfirming = confirmRestore === ver.id;
          const restorePending = restorePendingVersionId === ver.id;

          return (
            <div
              key={ver.id}
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: isCurrent ? '#e0e0e0' : '#999',
                    fontWeight: isCurrent ? 500 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {ver.label}
                  {isCurrent && (
                    <span
                      style={{
                        fontSize: 9,
                        color: '#4a7c44',
                        fontFamily: "'SF Mono', monospace",
                        fontWeight: 600,
                      }}
                    >
                      CURRENT
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: '#555',
                    fontFamily: "'SF Mono', monospace",
                    marginTop: 2,
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span>{sourceLabel(ver.source)}</span>
                  <span>
                    {new Date(ver.createdAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    {new Date(ver.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {!isCurrent && (
                <button
                  onClick={() => handleRestore(ver.id)}
                  disabled={disabled || Boolean(restorePendingVersionId)}
                  style={{
                    ...actionBtnStyle,
                    gap: 6,
                    color: disabled || Boolean(restorePendingVersionId) ? '#3f3f3f' : (isConfirming ? '#f0b45b' : '#a8a8a8'),
                    background: isConfirming && !disabled && !restorePending ? 'rgba(232,160,64,0.12)' : 'rgba(255,255,255,0.04)',
                    border: isConfirming && !disabled && !restorePending
                      ? '1px solid rgba(232,160,64,0.28)'
                      : '1px solid rgba(255,255,255,0.08)',
                    cursor: disabled || Boolean(restorePendingVersionId) ? 'default' : 'pointer',
                    opacity: disabled || Boolean(restorePendingVersionId) ? 0.45 : 1,
                  }}
                  title={restorePending ? 'Restoring version…' : (isConfirming ? 'Click again to confirm restore' : 'Restore this version')}
                >
                  {isConfirming ? <Check size={13} /> : <RotateCcw size={13} />}
                  {restorePending ? 'Restoring…' : (isConfirming ? 'Confirm restore' : 'Restore')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 10px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  color: '#ccc',
  fontSize: 11,
  fontFamily: "'SF Mono', monospace",
  cursor: 'pointer',
};

export default VersionPanel;
