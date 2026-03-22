import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const GoogleCallback: React.FC = () => {
  const { completeGoogleLogin, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (isAuthenticated) {
      const redirect = sessionStorage.getItem('forge_redirect') || '/';
      sessionStorage.removeItem('forge_redirect');
      navigate(redirect, { replace: true });
      return;
    }

    if (attempted.current) return;
    attempted.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      setError('Missing OAuth code or state. Please try signing in again.');
      return;
    }

    completeGoogleLogin(code, state)
      .then(() => {
        const redirect = sessionStorage.getItem('forge_redirect') || '/';
        sessionStorage.removeItem('forge_redirect');
        navigate(redirect, { replace: true });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Google authentication failed';
        if (msg.includes('not authorized') || msg.includes('not allowed')) {
          setError('This email is not authorized. Contact admin.');
        } else {
          setError(msg);
        }
      });
  }, [searchParams, completeGoogleLogin, navigate, isAuthenticated]);

  if (error) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <div className="w-full max-w-sm">
          <div
            className="p-8 text-center crosshair-corners crosshair-bottom"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div
              className="mb-4 p-3 font-mono border"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-danger)',
                backgroundColor: 'var(--color-danger-muted)',
                borderColor: 'var(--color-danger)',
              }}
              role="alert"
            >
              {error}
            </div>
            <button
              className="btn btn--secondary w-full"
              onClick={() => navigate('/login', { replace: true })}
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <div className="flex items-center gap-3">
        <span className="loading-cursor" />
        <span
          className="font-mono"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}
        >
          Completing sign-in...
        </span>
      </div>
    </div>
  );
};

export default GoogleCallback;
