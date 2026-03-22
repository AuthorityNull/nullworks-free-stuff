import React from 'react';

interface BentoCardProps {
  sectionNumber: string;
  title: string;
  count?: number;
  span2?: boolean;
  loading?: boolean;
  error?: string | null;
  children: React.ReactNode;
  onHeaderClick?: () => void;
}

export const BentoCard: React.FC<BentoCardProps> = ({
  sectionNumber,
  title,
  count,
  span2,
  loading,
  error,
  children,
  onHeaderClick,
}) => {
  return (
    <div
      className={`card crosshair-corners crosshair-bottom ${span2 ? 'bento-span-2' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 180 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between mb-4"
        style={{
          borderBottom: '1px solid var(--color-border-subtle)',
          paddingBottom: 'var(--space-3)',
          cursor: onHeaderClick ? 'pointer' : 'default',
        }}
        onClick={onHeaderClick}
      >
        <div className="flex items-center gap-3">
          <span
            className="font-mono font-bold"
            style={{
              fontSize: '16px',
              color: 'var(--color-text-secondary)',
              letterSpacing: '0.2em',
            }}
          >
            {sectionNumber}
            <span style={{ color: 'var(--color-accent)', opacity: 0.7 }}> &gt;&gt;</span>
          </span>
          <span
            className="font-mono font-medium uppercase"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-primary)',
              letterSpacing: '0.15em',
            }}
          >
            {title}
          </span>
        </div>
        {count !== undefined && (
          <span
            className="font-mono"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}
          >
            {count}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="loading-state">
            <span className="loading-cursor" />
          </div>
        ) : error ? (
          <div className="error-state">
            <span className="error-state__message">{error}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};

export default BentoCard;
