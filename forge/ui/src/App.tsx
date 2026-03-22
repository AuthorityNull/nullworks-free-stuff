import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import { ToastProvider } from './components/Toast';
import AppShell from './components/AppShell';
import Dashboard from './pages/Dashboard';
import Prompts from './pages/Prompts';
import Runs from './pages/Runs';
import Canvas from "./pages/Canvas";
import Studio from "./pages/Studio";
import Settings from './pages/Settings';
import Login from './pages/Login';
import GoogleCallback from './pages/GoogleCallback';

const AppRoutes: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/google/callback" element={<GoogleCallback />} />
      {/* Canvas renders outside AppShell for full-screen experience */}
      <Route
        path="/canvas"
        element={
          isAuthenticated ? (
            <Canvas />
          ) : (
            <Navigate to={`/login?redirect=${encodeURIComponent('/canvas')}`} replace />
          )
        }
      />
      {/* Echo Studio - full-screen AI canvas app */}
      <Route
        path="/studio"
        element={
          isAuthenticated ? (
            <Studio />
          ) : (
            <Navigate to={`/login?redirect=${encodeURIComponent('/studio')}`} replace />
          )
        }
      />
      <Route
        path="/*"
        element={
          isAuthenticated ? (
            <AppShell>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/prompts" element={<Prompts />} />
                  <Route path="/runs" element={<Runs />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppShell>
          ) : (
            <Navigate to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`} replace />
          )
        }
      />
    </Routes>
  );
};

const App: React.FC = () => (
  <AuthProvider>
    <ToastProvider>
      <Router>
        <AppRoutes />
      </Router>
    </ToastProvider>
  </AuthProvider>
);

export default App;
