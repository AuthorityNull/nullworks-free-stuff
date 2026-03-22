import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const CANVAS_URL = '/canvas-content/';
const REFRESH_INTERVAL = 5000;

const Canvas: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showBar, setShowBar] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const { logout } = useAuth();

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      if (iframeRef.current) {
        iframeRef.current.src = `${CANVAS_URL}?t=${Date.now()}`;
        setLastRefresh(Date.now());
      }
    }, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (e.clientY < 60) {
      setShowBar(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else if (showBar) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowBar(false), 1200);
    }
  }, [showBar]);

  const handleBarEnter = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowBar(true);
  }, []);

  const handleBarLeave = useCallback(() => {
    hideTimer.current = setTimeout(() => setShowBar(false), 600);
  }, []);

  const handleManualRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = `${CANVAS_URL}?t=${Date.now()}`;
      setLastRefresh(Date.now());
    }
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    >
      {/* Hover topbar */}
      <div
        onMouseEnter={handleBarEnter}
        onMouseLeave={handleBarLeave}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: 'rgba(10, 10, 10, 0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          zIndex: 100,
          transform: showBar ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 200ms ease',
          pointerEvents: showBar ? 'auto' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: '10px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            ← Dashboard
          </button>
          <span
            style={{
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: '11px',
              letterSpacing: '0.15em',
              color: '#aaa',
              textTransform: 'uppercase',
            }}
          >
            Echo Canvas
          </span>
          <span
            style={{
              fontSize: '10px',
              fontFamily: "'SF Mono', monospace",
              color: autoRefresh ? '#4a7c44' : '#555',
            }}
          >
            {autoRefresh ? '● LIVE' : '○ PAUSED'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleManualRefresh}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#888',
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 3,
              fontFamily: "'SF Mono', monospace",
              fontSize: '10px',
            }}
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              background: autoRefresh ? 'rgba(74, 124, 68, 0.15)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${autoRefresh ? 'rgba(74, 124, 68, 0.3)' : 'rgba(255,255,255,0.08)'}`,
              color: autoRefresh ? '#6b9e64' : '#888',
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 3,
              fontFamily: "'SF Mono', monospace",
              fontSize: '10px',
            }}
          >
            {autoRefresh ? 'Pause' : 'Resume'}
          </button>
          <span
            style={{
              fontFamily: "'SF Mono', monospace",
              fontSize: '9px',
              color: '#444',
            }}
          >
            {new Date(lastRefresh).toLocaleTimeString()}
          </span>
          <button
            onClick={logout}
            style={{
              background: 'none',
              border: 'none',
              color: '#555',
              cursor: 'pointer',
              fontFamily: "'SF Mono', monospace",
              fontSize: '10px',
              marginLeft: 8,
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Full-screen iframe */}
      <iframe
        ref={iframeRef}
        src={CANVAS_URL}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          background: '#0a0a0a',
        }}
        title="Echo Canvas Preview"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
};

export default Canvas;
