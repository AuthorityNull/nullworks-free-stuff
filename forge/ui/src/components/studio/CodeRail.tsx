import React, { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { Code2, Loader, Save } from 'lucide-react';
import apiClient from '../../api/client';

// Lazy-load CodeMirror to avoid bloating initial bundle
const CodeEditor = lazy(() => import('./CodeEditor'));

interface CodeRailProps {
  projectId: string;
  projectName: string;
  disabled?: boolean;
  runLocked?: boolean;
  onHotUpdate?: (jsx: string) => void;
}

const CodeRail: React.FC<CodeRailProps> = ({ projectId, projectName, disabled = false, runLocked = false, onHotUpdate }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [exists, setExists] = useState(false);
  const [entryPath, setEntryPath] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const contentRef = useRef('');
  const enabledRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const disabledRef = useRef(disabled);
  const runLockedRef = useRef(runLocked);
  const pendingSaveOptionsRef = useRef<{ activate?: boolean; enabled?: boolean } | null>(null);
  const editLocked = disabled || runLocked;

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    runLockedRef.current = runLocked;
  }, [runLocked]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || disabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatusText(null);
    apiClient.getStudioSource(projectId)
      .then((res) => {
        if (cancelled) return;
        setEnabled(Boolean(res.source.enabled));
        setExists(Boolean(res.source.exists));
        setEntryPath(res.source.entryPath || '');
        setContent(res.source.content || '');
        setDirty(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatusText(err instanceof Error ? err.message : 'Failed to load React source');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, disabled]);

  const saveSource = useCallback(async (options: { activate?: boolean; enabled?: boolean } = {}) => {
    const liveContent = contentRef.current;
    if (!projectId || !liveContent.trim()) return;
    if (disabledRef.current || runLockedRef.current) return;
    if (savingRef.current) {
      pendingSaveOptionsRef.current = options;
      return;
    }

    const seq = ++requestSeqRef.current;
    const startContent = liveContent;
    const wasEnabled = enabledRef.current;
    const nextEnabled = typeof options.enabled === 'boolean' ? options.enabled : wasEnabled;
    savingRef.current = true;
    setSaving(true);
    setStatusText(
      nextEnabled
        ? (wasEnabled ? 'Publishing JSX updates to live preview...' : 'Enabling React live preview...')
        : (wasEnabled ? 'Disabling React live preview...' : 'Saving JSX draft...'),
    );

    try {
      const res = await apiClient.updateStudioSource(projectId, startContent, options);
      if (seq !== requestSeqRef.current) return;

      const latestContent = contentRef.current;
      const localChangedDuringSave = latestContent !== startContent;
      const nextExists = Boolean(res.source.exists);
      const nextEntryPath = res.source.entryPath || '';
      const serverEnabled = Boolean(res.source.enabled);

      enabledRef.current = serverEnabled;
      setEnabled(serverEnabled);
      setExists(nextExists);
      setEntryPath(nextEntryPath);

      if (!localChangedDuringSave) {
        setContent(res.source.content || startContent);
        dirtyRef.current = false;
        setDirty(false);
        setStatusText(
          serverEnabled
            ? 'React live preview enabled.'
            : (wasEnabled ? 'React live preview disabled. JSX draft preserved.' : 'JSX draft saved.'),
        );
      } else {
        dirtyRef.current = true;
        setDirty(true);
        setStatusText(serverEnabled ? 'Preview updated. Newer local edits still pending…' : 'JSX draft saved. Newer local edits still pending…');
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setStatusText(err instanceof Error ? err.message : 'Save failed');
    } finally {
      if (seq === requestSeqRef.current) {
        savingRef.current = false;
        setSaving(false);

        const queuedOptions = pendingSaveOptionsRef.current;
        pendingSaveOptionsRef.current = null;
        if (!disabledRef.current && !runLockedRef.current && (queuedOptions || (enabledRef.current && dirtyRef.current))) {
          window.setTimeout(() => {
            void saveSource(queuedOptions || { enabled: enabledRef.current });
          }, 0);
        }
      }
    }
  }, [projectId]);

  // Hot-update: send JSX to iframe immediately via postMessage (no file save, no reload)
  const hotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!enabled || !dirty || loading || editLocked || !onHotUpdate) return;
    if (hotTimerRef.current) clearTimeout(hotTimerRef.current);
    hotTimerRef.current = setTimeout(() => {
      onHotUpdate(contentRef.current);
    }, 150);
    return () => {
      if (hotTimerRef.current) clearTimeout(hotTimerRef.current);
    };
  }, [enabled, dirty, content, loading, editLocked, onHotUpdate]);

  // File save: persist to server on a longer debounce (2s) for durability
  useEffect(() => {
    if (!enabled || !dirty || loading || editLocked) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSource({ enabled: true });
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [enabled, dirty, content, loading, editLocked, saveSource]);

  const onContentChange = useCallback((value: string) => {
    if (editLocked) return;
    contentRef.current = value;
    setContent(value);
    dirtyRef.current = true;
    setDirty(true);
    if (!enabled) setExists(true);
  }, [enabled, editLocked]);

  const onSaveKey = useCallback(() => {
    if (editLocked) return;
    saveSource({ enabled });
  }, [editLocked, saveSource, enabled]);

  const isMirrorWrapper = useMemo(
    () => /React wrapper for the last HTML render|compatibility mirror|Legacy HTML compatibility mirror/i.test(content),
    [content]
  );

  const subtitle = useMemo(() => {
    if (enabled && isMirrorWrapper) return 'Live preview is on, but this file is still a starter copy of the current page';
    if (enabled) return 'Live preview follows this JSX file';
    if (exists && isMirrorWrapper) return 'The published page is still live. This JSX file is only a starter copy for now';
    if (exists) return 'This JSX draft is saved, but the published page is still live';
    return 'Turn on live preview to let this JSX file drive the canvas';
  }, [enabled, exists, isMirrorWrapper]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: '#9a9a9a', letterSpacing: '0.14em', textTransform: 'uppercase' }}>React source</span>
          <span style={{ fontSize: 12, color: '#6f6f6f', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{projectName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            aria-pressed={enabled}
            aria-label={enabled ? 'Disable JSX mode preview' : 'Enable JSX mode preview'}
            onClick={() => saveSource({ enabled: !enabled })}
            disabled={editLocked || loading || saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 30,
              padding: '0 12px',
              background: enabled ? 'rgba(74,124,68,0.18)' : 'rgba(255,255,255,0.04)',
              border: enabled ? '1px solid rgba(74,124,68,0.34)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              color: enabled ? '#a8d19d' : '#cfcfcf',
              cursor: editLocked || loading || saving ? 'default' : 'pointer',
              fontSize: 11,
              fontFamily: "'SF Mono', monospace",
              letterSpacing: '0.04em',
            }}
          >
            <Code2 size={12} />
            {enabled ? 'React ON' : 'React OFF'}
          </button>
          <button
            onClick={() => saveSource({ enabled })}
            disabled={editLocked || loading || saving || !dirty}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 10px',
              background: dirty ? 'rgba(74,124,68,0.18)' : 'rgba(255,255,255,0.04)',
              border: dirty ? '1px solid rgba(74,124,68,0.34)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, color: dirty ? '#a8d19d' : '#8a8a8a', cursor: editLocked || loading || saving || !dirty ? 'default' : 'pointer',
              fontSize: 11, fontFamily: "'SF Mono', monospace",
            }}
          >
            {saving ? <Loader size={12} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Save size={12} />}
            {saving ? 'Saving JSX...' : 'Save JSX'}
          </button>
        </div>
      </div>

      {/* Info bar */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#d1d1d1' }}>App.jsx</div>
            <div style={{ fontSize: 12, color: '#7a7a7a', marginTop: 4 }}>{subtitle}</div>
          </div>
        </div>
        {entryPath && (
          <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: '#626262', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entryPath}
          </div>
        )}
        {statusText && (
          <div style={{ fontSize: 11, color: enabled ? '#86b77b' : '#8a8a8a', fontFamily: "'SF Mono', monospace" }}>{statusText}</div>
        )}
        {isMirrorWrapper && (
          <div style={{ fontSize: 11, color: '#9b8a67', fontFamily: "'SF Mono', monospace" }}>
            {enabled
              ? 'Live preview is on, but this file is still a starter copy of the saved page. Replace it with your own JSX to take full control.'
              : 'The canvas is still showing the saved page. This JSX file is only a starter copy until you switch live preview on and rewrite it.'}
          </div>
        )}
        {runLocked && (
          <div style={{ fontSize: 11, color: '#9b8a67', fontFamily: "'SF Mono', monospace" }}>
            React source edits are locked while Echo is processing.
          </div>
        )}
      </div>

      {/* Editor area */}
      <div style={{ flex: 1, minHeight: 0, background: 'rgba(0,0,0,0.12)', position: 'relative' }}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <Loader size={16} style={{ color: '#444', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : (
          <Suspense fallback={
            <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <Loader size={16} style={{ color: '#444', animation: 'spin 0.8s linear infinite', marginBottom: 8 }} />
                <div style={{ fontSize: 10, color: '#555', fontFamily: "'SF Mono', monospace", letterSpacing: '0.1em' }}>Loading editor...</div>
              </div>
            </div>
          }>
            <CodeEditor
              value={content}
              onChange={onContentChange}
              onSave={onSaveKey}
              disabled={editLocked}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default CodeRail;
