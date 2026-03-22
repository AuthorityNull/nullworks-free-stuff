import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import apiClient, { type ForgeUser, type AuthSessionResponse } from '../api/client';

interface AuthContextValue {
  isAuthenticated: boolean;
  loading: boolean;
  user: ForgeUser | null;
  authError: string | null;
  checkAuth: () => Promise<boolean>;
  login: (token: string) => Promise<void>;
  loginWithGoogle: (inviteCode?: string) => Promise<void>;
  completeGoogleLogin: (code: string, state: string, inviteCode?: string) => Promise<void>;
  setAuthError: (value: string | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Session refresh interval - check every 5 minutes
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
// Silence errors for this long after an auth error to prevent spam
const ERROR_COOLDOWN_MS = 5000;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<ForgeUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  
  // Track last error time to prevent spam
  const lastErrorTimeRef = useRef<number>(0);
  // Track if we've done initial auth check
  const initialCheckDoneRef = useRef(false);
  // Track if component is mounted
  const mountedRef = useRef(true);

  const applySession = useCallback((session: AuthSessionResponse | null) => {
    const authed = Boolean(session?.user);
    setIsAuthenticated(authed);
    setUser(session?.user || null);
    setAuthError(null);
    return authed;
  }, []);

  const checkAuth = useCallback(async (): Promise<boolean> => {
    try {
      const session = await apiClient.getAuthSession();
      if (!mountedRef.current) return false;
      return applySession(session);
    } catch (err) {
      if (!mountedRef.current) return false;
      
      // Only show error if not an expected 401 (unauthorized is normal when not logged in)
      if (err instanceof Error && err.message === 'Unauthorized') {
        setIsAuthenticated(false);
        setUser(null);
        setAuthError(null);
        return false;
      }
      
      // Prevent error spam - only show error if cooldown has passed
      const now = Date.now();
      if (now - lastErrorTimeRef.current > ERROR_COOLDOWN_MS) {
        lastErrorTimeRef.current = now;
        const message = err instanceof Error ? err.message : 'Session check failed';
        setAuthError(message);
      }
      
      setIsAuthenticated(false);
      setUser(null);
      return false;
    }
  }, [applySession]);

  const login = useCallback(async (token: string): Promise<void> => {
    setLoading(true);
    setAuthError(null);
    try {
      const result = await apiClient.login(token);
      if (!mountedRef.current) return;
      applySession(result);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Token login failed';
      setAuthError(message);
      throw err;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applySession]);

  const loginWithGoogle = useCallback(async (inviteCode?: string): Promise<void> => {
    setLoading(true);
    setAuthError(null);
    try {
      const { url } = await apiClient.getGoogleAuthUrl(inviteCode);
      if (!url) {
        throw new Error('No redirect URL returned from server');
      }
      // Navigate to Google OAuth - loading stays true during redirect
      window.location.href = url;
    } catch (err) {
      if (!mountedRef.current) return;
      setLoading(false);
      const message = err instanceof Error ? err.message : 'Google sign-in could not be started';
      setAuthError(message);
      throw err;
    }
    // Note: don't setLoading(false) on success - page is navigating away
  }, []);

  const completeGoogleLogin = useCallback(async (code: string, state: string, inviteCode?: string): Promise<void> => {
    setLoading(true);
    setAuthError(null);
    try {
      const result = await apiClient.loginWithGoogle(code, state, inviteCode);
      if (!mountedRef.current) return;
      applySession(result);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Google authentication failed';
      setAuthError(message);
      throw err;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applySession]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.logout();
    } finally {
      if (mountedRef.current) {
        setIsAuthenticated(false);
        setUser(null);
        setAuthError(null);
      }
    }
  }, []);

  // Initial auth check on mount
  useEffect(() => {
    mountedRef.current = true;
    
    checkAuth().finally(() => {
      if (mountedRef.current) {
        setInitializing(false);
        initialCheckDoneRef.current = true;
      }
    });
    
    return () => {
      mountedRef.current = false;
    };
  }, [checkAuth]);

  // Periodic session refresh - silently refresh without showing errors
  useEffect(() => {
    if (!initialCheckDoneRef.current || !isAuthenticated) return;
    
    const interval = setInterval(() => {
      // Silently check session - don't show errors during refresh
      apiClient.getAuthSession()
        .then(session => {
          if (mountedRef.current) {
            applySession(session);
          }
        })
        .catch(err => {
          // Only logout on 401, ignore other errors to prevent spam
          if (err instanceof Error && err.message === 'Unauthorized') {
            if (mountedRef.current) {
              setIsAuthenticated(false);
              setUser(null);
            }
          }
          // Don't show error toast for background refresh failures
        });
    }, SESSION_CHECK_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [isAuthenticated, applySession]);

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="loading-state__spinner" />
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        loading,
        user,
        authError,
        checkAuth,
        login,
        loginWithGoogle,
        completeGoogleLogin,
        setAuthError,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};

export default AuthContext;
