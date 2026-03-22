import React from 'react';

export type StatusType = 
  | 'idle' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'pending' 
  | 'accepted' 
  | 'rejected'
  | 'active'
  | 'disabled'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'pending_approval';

export interface StatusChipProps {
  status: StatusType;
  children?: React.ReactNode;
  pulse?: boolean;
}

const statusConfig: Record<StatusType, { label: string; color: string }> = {
  idle: { label: 'IDLE', color: 'var(--color-text-disabled)' },
  running: { label: 'RUNNING', color: 'var(--color-info)' },
  completed: { label: 'COMPLETED', color: 'var(--color-success)' },
  failed: { label: 'FAILED', color: 'var(--color-danger)' },
  pending: { label: 'PENDING', color: 'var(--color-warning)' },
  pending_approval: { label: 'REVIEW', color: 'var(--color-warning)' },
  accepted: { label: 'ACCEPTED', color: 'var(--color-success)' },
  rejected: { label: 'REJECTED', color: 'var(--color-danger)' },
  active: { label: 'ACTIVE', color: 'var(--color-success)' },
  disabled: { label: 'DISABLED', color: 'var(--color-text-disabled)' },
  success: { label: 'SUCCESS', color: 'var(--color-success)' },
  warning: { label: 'WARNING', color: 'var(--color-warning)' },
  error: { label: 'ERROR', color: 'var(--color-danger)' },
  info: { label: 'INFO', color: 'var(--color-info)' },
};

export const StatusChip: React.FC<StatusChipProps> = ({ 
  status, 
  children,
  pulse = false 
}) => {
  const config = statusConfig[status] || statusConfig.idle;
  const displayText = children || config.label;
  const shouldPulse = pulse || status === 'running';

  return (
    <span 
      className="inline-flex items-center gap-1.5 px-2.5 py-1 font-mono tracking-wider uppercase border"
      style={{
        fontSize: '10px',
        fontWeight: 500,
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text-secondary)',
        letterSpacing: '0.12em',
      }}
    >
      <span 
        className="status-dot"
        style={{ 
          backgroundColor: config.color,
          animation: shouldPulse ? 'statusPulse 2s ease-in-out infinite' : 'none',
        }}
      />
      {displayText}
    </span>
  );
};

export default StatusChip;
