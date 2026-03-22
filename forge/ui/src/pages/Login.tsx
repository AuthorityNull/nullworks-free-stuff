import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ForgeMark from '../components/ForgeMark';

const Login: React.FC = () => {
  const { login, loginWithGoogle, isAuthenticated, authError, setAuthError } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('token-user');
  const [showTokenLogin, setShowTokenLogin] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  /* Single active-auth tracker prevents duplicate loading indicators.
     Only the auth method that was clicked shows its loading state. */
  const [activeAuth, setActiveAuth] = useState<'google' | 'token' | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      const redirect = searchParams.get('redirect') || sessionStorage.getItem('forge_redirect') || '/';
      sessionStorage.removeItem('forge_redirect');
      navigate(redirect, { replace: true });
    }
  }, [isAuthenticated, navigate, searchParams]);

  const displayError = localError || authError;

  const clearErrors = () => {
    setLocalError(null);
    setAuthError(null);
  };

  const handleGoogleSignIn = async () => {
    clearErrors();
    setActiveAuth('google');
    // Persist redirect target across OAuth round-trip
    const redirect = searchParams.get('redirect');
    if (redirect) sessionStorage.setItem('forge_redirect', redirect);
    try {
      await loginWithGoogle();
    } catch (err) {
      setActiveAuth(null);
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setLocalError('Cannot reach the server. Check your connection.');
      } else {
        setLocalError(msg);
      }
    }
  };

  const handleTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();
    setActiveAuth('token');
    try {
      await login(password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setActiveAuth(null);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <div className="w-full max-w-sm animate-fade-in">
        <div
          className="p-8 relative crosshair-corners"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div
                className="flex items-center justify-center"
                style={{
                  width: 48,
                  height: 48,
                  border: '1px solid var(--color-border-highlight)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <ForgeMark size={28} />
              </div>
              <h1
                className="font-ui font-semibold"
                style={{
                  fontSize: 'var(--text-2xl)',
                  color: 'var(--color-text-primary)',
                  letterSpacing: '0.15em',
                }}
              >
                FORGE
              </h1>
            </div>
            <p
              className="font-mono"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-secondary)',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Prompt Engineering System
            </p>
          </div>

          {/* Google Sign-In - PRIMARY */}
          <div className="mb-6">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={activeAuth !== null}
              className="w-full flex items-center justify-center gap-3 px-4 font-mono uppercase"
              style={{
                height: 44,
                fontSize: 'var(--text-xs)',
                letterSpacing: '0.15em',
                backgroundColor: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                cursor: activeAuth === 'google' ? 'not-allowed' : 'pointer',
                opacity: activeAuth === 'google' ? 0.5 : 1,
                transition: 'border-color var(--transition-base)',
              }}
              onMouseEnter={(e) => { if (activeAuth !== 'google') e.currentTarget.style.borderColor = 'var(--color-border-highlight)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
            >
              {activeAuth === 'google' ? (
                <span className="loading-cursor" style={{ width: 6, height: 12 }} />
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 2.58z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google
                </>
              )}
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
            <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
              or
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
          </div>

          {/* Token Login - collapsed */}
          <div>
            <button
              type="button"
              onClick={() => { setShowTokenLogin(!showTokenLogin); clearErrors(); }}
              className="w-full flex items-center justify-between py-2"
              style={{
                color: 'var(--color-text-secondary)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <span
                className="font-mono uppercase"
                style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.15em' }}
              >
                Token Login
              </span>
              {showTokenLogin ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showTokenLogin && (
              <form onSubmit={handleTokenSubmit} className="space-y-4 mt-3 animate-fade-in">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="sr-only"
                />
                <div>
                  <label className="label block mb-2">Access Token</label>
                  <div className="relative">
                    <Lock
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--color-text-disabled)' }}
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input"
                      style={{ paddingLeft: '36px' }}
                      placeholder="Enter access token"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn--secondary w-full"
                  disabled={activeAuth !== null || !password.trim()}
                >
                  {activeAuth === 'token' ? <span className="loading-cursor" style={{ width: 6, height: 12 }} /> : 'Sign In'}
                </button>
              </form>
            )}
          </div>

          {/* Single error display */}
          {displayError && (
            <div
              className="mt-4 p-3 text-center font-mono border"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-danger)',
                backgroundColor: 'var(--color-danger-muted)',
                borderColor: 'var(--color-danger)',
              }}
              role="alert"
              aria-live="assertive"
            >
              {displayError}
            </div>
          )}

          {/* Footer */}
          <div
            className="mt-8 pt-4 text-center"
            style={{ borderTop: '1px solid var(--color-border-subtle)' }}
          >
            <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
              v1.0.0
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
