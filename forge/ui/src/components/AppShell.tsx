import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Play,
  Settings as SettingsIcon,
  LogOut,
  Sun,
  Moon,
  Palette,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { OutputPaneProvider } from '../context/OutputPaneContext';
import { RightPanelProvider } from '../context/RightPanelContext';
import ControlPanel from './ControlPanel';
import OutputPane from './OutputPane';
import RightPanel from './RightPanel';
import ForgeMark from './ForgeMark';
const THEME_KEY = 'forge-theme';
const RAIL_KEY = 'forge-rail-collapsed';

interface NavItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  route: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', icon: <LayoutDashboard size={16} />, label: 'Dashboard', route: '/' },
  { id: 'prompts', icon: <FileText size={16} />, label: 'Prompts', route: '/prompts' },
  { id: 'runs', icon: <Play size={16} />, label: 'Runs', route: '/runs' },
  { id: 'studio', icon: <Palette size={16} />, label: 'Studio', route: '/studio' },
  { id: 'settings', icon: <SettingsIcon size={16} />, label: 'Settings', route: '/settings' },
];

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === 'light' ? 'light' : 'dark';
    } catch { return 'dark'; }
  });

  const [collapsed] = useState(() => {
    try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0'); } catch { /* noop */ }
  }, [collapsed]);

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* noop */ }
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const isDashboard = location.pathname === '/';
  const railWidth = collapsed ? 56 : 180;

  return (
    <OutputPaneProvider>
      <RightPanelProvider>
        <div className="flex h-screen" style={{ backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
          {/* Column 1: Nav Rail */}
          <nav
            className="flex flex-col flex-shrink-0 items-center"
            style={{
              minHeight: 0,
              width: railWidth,
              transition: 'width 150ms linear',
              backgroundColor: 'var(--color-sidebar)',
              borderRight: '1px solid var(--color-border)',
            }}
            aria-label="Main navigation"
          >
            <div
              className="flex-shrink-0"
              style={{
                width: '100%',
                borderBottom: '1px solid var(--color-border-subtle)',
                padding: collapsed ? '12px 0' : '14px 12px 12px',
              }}
            >
              <div
                className="flex items-center"
                style={{
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: collapsed ? 0 : 10,
                }}
              >
                <div style={{ color: 'var(--color-text-primary)', display: 'grid', placeItems: 'center' }}>
                  <ForgeMark size={collapsed ? 18 : 20} />
                </div>
                {!collapsed && (
                  <div>
                    <div className="font-mono" style={{ fontSize: '11px', letterSpacing: '0.22em', color: 'var(--color-text-primary)' }}>FORGE</div>
                    <div className="font-mono uppercase" style={{ fontSize: '8px', letterSpacing: '0.14em', color: 'var(--color-text-muted)', marginTop: 2 }}>Prompt runtime</div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 py-3 flex flex-col items-center gap-1" style={{ overflowY: 'auto', overflowX: 'hidden', width: '100%' }}>
              {navItems.map((item) => {
                const isActive = item.route === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.route);

                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.route)}
                    className="flex items-center"
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      width: '100%',
                      height: 40,
                      paddingLeft: collapsed ? 18 : 12,
                      paddingRight: collapsed ? 0 : 8,
                      justifyContent: 'flex-start',
                      alignItems: 'center',
                      gap: 10,
                      background: isActive ? 'var(--color-surface-elevated)' : 'transparent',
                      border: 'none',
                      borderLeft: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 100ms linear',
                      borderRadius: 0,
                    }}
                    title={collapsed ? item.label : undefined}
                  >
                    <span style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)', flexShrink: 0 }}>
                      {item.icon}
                    </span>
                    {!collapsed && (
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '10px',
                          letterSpacing: '0.08em',
                          color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Theme toggle + Logout */}
            <div className="py-2 flex flex-col items-center gap-1 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border-subtle)', width: '100%' }}>
              <button
                onClick={toggleTheme}
                className="flex items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </span>
              </button>
              <button
                onClick={logout}
                className="flex items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title="Logout"
              >
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  <LogOut size={16} />
                </span>
              </button>
            </div>
          </nav>

          {/* Main Content Area */}
          {isDashboard ? (
            // Dashboard: Three-column layout
            <>
              {/* Column 2: Left Control Panel */}
              <div
                className="flex-shrink-0 overflow-hidden"
                style={{
                  width: 300,
                  borderRight: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                <ControlPanel />
              </div>

              {/* Column 3: Center Canvas - framed live run streaming */}
              <main
                className="flex-1 min-w-0 flex flex-col"
                style={{ backgroundColor: 'var(--color-bg)', padding: 10, overflow: 'hidden' }}
              >
                <div
                  className="h-full flex flex-col overflow-hidden"
                  style={{
                    border: '1px solid rgba(172, 170, 158, 0.18)',
                    backgroundColor: 'var(--color-bg)',
                  }}
                >
                  <OutputPane />
                </div>
              </main>
              <RightPanel />
            </>
          ) : (
            // Other pages: Full content area
            <>
              <main className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
                <div className="flex-1 overflow-auto animate-fade-in">
                  {children}
                </div>
              </main>
            </>
          )}
        </div>
      </RightPanelProvider>
    </OutputPaneProvider>
  );
};

export default AppShell;
