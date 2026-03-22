import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import type { StudioProject, StudioMessage, StudioRun, StudioVersion } from '../api/types';
import ProjectDrawer from '../components/studio/ProjectDrawer';
import ChatRail from '../components/studio/ChatRail';
import VersionPanel from '../components/studio/VersionPanel';
import CodeRail from '../components/studio/CodeRail';
import {
  Layers,
  MessageSquare,
  History,
  Code2,
  RotateCw,
  ExternalLink,
  Maximize2,
  Minimize2,
  RefreshCw,
} from 'lucide-react';

type RightPane = 'chat' | 'versions' | 'code' | null;

type StudioRunTimelineEntry = {
  id: string;
  stage: string;
  message: string;
  ts: string;
  tone?: 'info' | 'success' | 'error';
};

type UiNotice = {
  tone: 'success' | 'error';
  text: string;
};

const normalizeStudioProgressText = (message: string | null | undefined, hasPartialText = false): string | null => {
  if (hasPartialText) return null;
  const value = String(message || '').trim();
  if (!value) return 'Preparing your run...';
  const normalized = value.toLowerCase();

  if (normalized.includes('queued the request') || normalized.includes('preparing project context')) {
    return 'Preparing project context...';
  }
  if (normalized.includes('sending echo request') || normalized.includes('sending request to echo') || normalized.includes('via websocket')) {
    return 'Sending request to Echo...';
  }
  if (normalized.includes('echo started processing') || normalized.includes('echo is replying') || normalized.includes('streaming assistant response')) {
    return 'Echo is replying...';
  }
  if (normalized.includes('saved a recovery snapshot')) {
    return 'Saving recovery snapshot...';
  }
  if (normalized.includes('received echo reply')) {
    return 'Reply received. Finalizing...';
  }
  if (normalized.includes('echo updated the preview') || normalized.includes('echo updated the react source')) {
    return 'Updating preview...';
  }
  if (normalized.includes('still waiting on echo')) {
    return 'Still waiting on Echo...';
  }
  return value;
};

const extractErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    const message = ((err as { message?: string }).message || '').trim();
    if (message) return message;
  }
  return fallback;
};

const Studio: React.FC = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const iframeARef = useRef<HTMLIFrameElement>(null);
  const iframeBRef = useRef<HTMLIFrameElement>(null);
  const visibleFrameRef = useRef<'a' | 'b'>('a');
  const pendingFrameRef = useRef<'a' | 'b' | null>(null);
  const pendingScrollRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const [versions, setVersions] = useState<StudioVersion[]>([]);
  const [rightPane, setRightPane] = useState<RightPane>('chat');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [echoThinking, setEchoThinking] = useState(false);
  const [echoProgressText, setEchoProgressText] = useState<string | null>(null);
  const [echoStreamingText, setEchoStreamingText] = useState<string | null>(null);
  const [echoLastError, setEchoLastError] = useState<string | null>(null);
  const [echoTimeline, setEchoTimeline] = useState<StudioRunTimelineEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stopRunPending, setStopRunPending] = useState(false);
  const [uiNotice, setUiNotice] = useState<UiNotice | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [visibleFrame, setVisibleFrame] = useState<'a' | 'b'>('a');
  const [frameUrls, setFrameUrls] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  const [frameReady, setFrameReady] = useState<{ a: boolean; b: boolean }>({ a: false, b: false });
  const [projectActionPending, setProjectActionPending] = useState<string | null>(null);
  const [checkpointPending, setCheckpointPending] = useState(false);
  const [restorePendingVersionId, setRestorePendingVersionId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const runStreamRef = useRef<EventSource | null>(null);
  const runStreamReconnectTimerRef = useRef<number | null>(null);
  const runStreamRetryRef = useRef(0);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) || null,
    [projects, selectedId],
  );
  const reactLiveEnabled = selectedProject?.renderMode === 'react';
  const showToolbarLabels = viewportWidth >= 1180;
  const drawerWidth = viewportWidth < 900 ? Math.max(232, Math.min(320, viewportWidth - 32)) : viewportWidth < 1280 ? 248 : 272;
  const rightPaneWidth = viewportWidth < 900 ? Math.max(320, Math.min(420, viewportWidth - 32)) : viewportWidth < 1320 ? 360 : viewportWidth < 1520 ? 400 : 430;
  const drawerOverlay = !fullscreen && viewportWidth < 1040;
  const rightPaneOverlay = !fullscreen && viewportWidth < 1180;
  const showOverlayScrim = (drawerOpen && drawerOverlay) || Boolean(rightPane && rightPaneOverlay);
  const projectTitleMaxWidth = viewportWidth < 1080 ? 180 : viewportWidth < 1320 ? 220 : 280;

  const pushTimeline = useCallback((stage: string, message: string, tone: 'info' | 'success' | 'error' = 'info') => {
    setEchoTimeline((prev) => {
      const next = [...prev, {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        stage,
        message,
        tone,
        ts: new Date().toISOString(),
      }];
      return next.slice(-12);
    });
  }, []);

  useEffect(() => {
    if (!uiNotice) return undefined;
    const timer = window.setTimeout(() => setUiNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [uiNotice]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (fullscreen) return;
    if (viewportWidth < 900 && drawerOpen && rightPane) {
      setDrawerOpen(false);
    }
  }, [viewportWidth, drawerOpen, rightPane, fullscreen]);

  const flashUiNotice = useCallback((tone: 'success' | 'error', text: string) => {
    setUiNotice({ tone, text });
  }, []);

  const closeRunStream = useCallback(() => {
    if (runStreamReconnectTimerRef.current) {
      window.clearTimeout(runStreamReconnectTimerRef.current);
      runStreamReconnectTimerRef.current = null;
    }
    if (runStreamRef.current) {
      runStreamRef.current.close();
      runStreamRef.current = null;
    }
    runStreamRetryRef.current = 0;
    activeRunIdRef.current = null;
  }, []);

  const hasAttachedRunStream = useCallback((runId: string | null | undefined) => {
    return Boolean(runId && activeRunIdRef.current === runId && runStreamRef.current);
  }, []);

  const syncFromRun = useCallback((run: StudioRun | null | undefined) => {
    if (!run) return;
    activeRunIdRef.current = run.id || null;
    setActiveRunId(run.id || null);
    setEchoThinking(run.status === 'queued' || run.status === 'running');
    setEchoProgressText(normalizeStudioProgressText(run.progressText || null, Boolean(run.partialText)));
    setEchoStreamingText(run.partialText || null);
    setEchoLastError(run.error || null);
    if (Array.isArray(run.timeline)) {
      setEchoTimeline(run.timeline.slice(-12));
    }
  }, []);

  const finalizeRunUi = useCallback((
    status: 'completed' | 'failed' | 'cancelled',
    run?: StudioRun | null,
    fallbackMessage?: string,
  ) => {
    if (run) syncFromRun(run);

    const message = status === 'failed'
      ? (run?.error || fallbackMessage || 'Run failed.')
      : status === 'cancelled'
        ? (run?.note || fallbackMessage || 'Run stopped.')
        : null;

    setEchoThinking(false);
    setEchoStreamingText(null);
    setEchoProgressText(message);
    setEchoLastError(status === 'failed' ? (message || 'Run failed.') : null);
    setActiveRunId(null);
    closeRunStream();
    pushTimeline(
      status,
      status === 'completed' ? (run?.note || fallbackMessage || 'Run completed.') : (message || fallbackMessage || 'Run finished.'),
      status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'info',
    );
  }, [closeRunStream, pushTimeline, syncFromRun]);

  const attachRunStream = useCallback((projectId: string, runId: string) => {
    if (!projectId || !runId) return;
    if (activeRunIdRef.current === runId && runStreamRef.current) return;

    const switchingRuns = activeRunIdRef.current !== runId;
    if (switchingRuns) {
      closeRunStream();
    } else if (runStreamReconnectTimerRef.current) {
      window.clearTimeout(runStreamReconnectTimerRef.current);
      runStreamReconnectTimerRef.current = null;
    }

    activeRunIdRef.current = runId;
    const es = apiClient.createRunStream(runId);
    runStreamRef.current = es;

    const markRunStreamHealthy = () => {
      if (runStreamReconnectTimerRef.current) {
        window.clearTimeout(runStreamReconnectTimerRef.current);
        runStreamReconnectTimerRef.current = null;
      }
      runStreamRetryRef.current = 0;
      setEchoLastError((current) => (current === 'Live run updates disconnected. Waiting for background status checks.' ? null : current));
    };

    es.addEventListener('studio.run.snapshot', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.run) {
          markRunStreamHealthy();
          syncFromRun(data.run as StudioRun);
        }
      } catch {}
    });

    es.addEventListener('studio.run.started', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.run) {
          markRunStreamHealthy();
          syncFromRun(data.run as StudioRun);
        }
      } catch {}
    });

    es.addEventListener('studio.run.progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (activeRunIdRef.current !== runId) return;
        markRunStreamHealthy();
        if (typeof data?.partialText === 'string') setEchoStreamingText(data.partialText || null);
        if (data?.message || typeof data?.partialText === 'string') {
          setEchoProgressText(normalizeStudioProgressText(data?.message, Boolean(data?.partialText)));
        }
        if (data?.message && data?.stage !== 'streaming') {
          pushTimeline(data?.stage || 'progress', data.message, 'info');
        }
      } catch {}
    });

    es.addEventListener('studio.run.completed', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (activeRunIdRef.current !== runId) return;
        markRunStreamHealthy();
        finalizeRunUi('completed', (data?.run as StudioRun | undefined) || null, data?.run?.note || 'Run completed.');
      } catch {
        if (activeRunIdRef.current !== runId) return;
        finalizeRunUi('completed', null, 'Run completed.');
      }
    });

    es.addEventListener('studio.run.failed', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (activeRunIdRef.current !== runId) return;
        markRunStreamHealthy();
        finalizeRunUi('failed', (data?.run as StudioRun | undefined) || null, data?.run?.error || 'Run failed.');
      } catch {
        if (activeRunIdRef.current !== runId) return;
        finalizeRunUi('failed', null, 'Run failed.');
      }
    });

    es.addEventListener('studio.run.cancelled', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (activeRunIdRef.current !== runId) return;
        markRunStreamHealthy();
        finalizeRunUi('cancelled', (data?.run as StudioRun | undefined) || null, data?.run?.note || 'Run stopped.');
      } catch {
        if (activeRunIdRef.current !== runId) return;
        finalizeRunUi('cancelled', null, 'Run stopped.');
      }
    });

    es.onerror = () => {
      if (activeRunIdRef.current !== runId) return;
      if (runStreamRef.current !== es) return;
      try { es.close(); } catch {}
      runStreamRef.current = null;

      const retryCount = runStreamRetryRef.current + 1;
      runStreamRetryRef.current = retryCount;
      if (retryCount > 6) {
        setEchoLastError('Live run updates disconnected. Waiting for background status checks.');
        setEchoProgressText((current) => current || 'Live updates disconnected. Waiting for background status checks.');
        pushTimeline('stream-disconnected', 'Live run stream disconnected. Falling back to background status checks.', 'error');
        return;
      }

      const delay = Math.min(8000, 1000 * (2 ** (retryCount - 1)));
      setEchoProgressText((current) => current || 'Reconnecting live updates…');
      if (runStreamReconnectTimerRef.current) window.clearTimeout(runStreamReconnectTimerRef.current);
      runStreamReconnectTimerRef.current = window.setTimeout(() => {
        runStreamReconnectTimerRef.current = null;
        if (activeRunIdRef.current === runId && !runStreamRef.current) {
          attachRunStream(projectId, runId);
        }
      }, delay);
    };
  }, [closeRunStream, finalizeRunUi, pushTimeline, syncFromRun]);

  // --- Data fetching ---

  const fetchProjects = useCallback(async () => {
    try {
      const res = await apiClient.getStudioProjects();
      setProjects(res.projects);
      setSelectedId((current) => {
        if (current && res.projects.some((project) => project.id === current)) return current;
        if (res.selectedProjectId) return res.selectedProjectId;
        if (res.projects.length > 0) return res.projects[0].id;
        return null;
      });
    } catch (err) {
      console.error('[Studio] Failed to fetch projects', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const fetchMessages = useCallback(async (projectId: string) => {
    try {
      const res = await apiClient.getStudioMessages(projectId);
      if (selectedIdRef.current !== projectId) return; // stale response guard
      setMessages(res.messages);
    } catch (err) {
      console.error('[Studio] Failed to fetch messages', err);
    }
  }, []);

  const fetchVersions = useCallback(async (projectId: string) => {
    try {
      const res = await apiClient.getStudioVersions(projectId);
      if (selectedIdRef.current !== projectId) return; // stale response guard
      setVersions(res.versions);
    } catch (err) {
      console.error('[Studio] Failed to fetch versions', err);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => () => closeRunStream(), [closeRunStream]);

  useEffect(() => {
    closeRunStream();
    setMessages([]);
    setVersions([]);
    setEchoThinking(false);
    setEchoProgressText(null);
    setEchoStreamingText(null);
    setEchoLastError(null);
    setEchoTimeline([]);
    setActiveRunId(null);
    setStopRunPending(false);
    if (!selectedId) return;
    fetchMessages(selectedId);
    fetchVersions(selectedId);
  }, [selectedId, closeRunStream, fetchMessages, fetchVersions]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) return undefined;
    void apiClient.getStudioRuns(selectedId)
      .then((res) => {
        if (cancelled) return;
        const activeRun = res.runs.find((run) => run.status === 'queued' || run.status === 'running');
        if (activeRun?.id) {
          syncFromRun(activeRun);
          attachRunStream(selectedId, activeRun.id);
        }
      })
      .catch((err) => {
        console.error('[Studio] Failed to recover active run', err);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, attachRunStream, syncFromRun]);

  useEffect(() => {
    if (!selectedId || !activeRunId || !echoThinking) return undefined;
    let cancelled = false;
    const reconcile = async () => {
      try {
        const res = await apiClient.getStudioRuns(selectedId);
        if (cancelled) return;
        const matchingRun = res.runs.find((run) => run.id === activeRunId);
        if (!matchingRun) {
          setEchoThinking(false);
          setEchoStreamingText(null);
          setEchoProgressText(null);
          setEchoLastError(null);
          setActiveRunId(null);
          closeRunStream();
          return;
        }
        if (matchingRun.status !== 'queued' && matchingRun.status !== 'running') {
          if (matchingRun.status === 'failed') {
            finalizeRunUi('failed', matchingRun, matchingRun.error || 'Run failed.');
          } else if (matchingRun.status === 'cancelled') {
            finalizeRunUi('cancelled', matchingRun, matchingRun.note || 'Run stopped.');
          } else {
            finalizeRunUi('completed', matchingRun, matchingRun.note || 'Run completed.');
          }
        } else if (!runStreamRef.current && selectedId && matchingRun.id) {
          // Run is still active but the run stream died - reattach
          attachRunStream(selectedId, matchingRun.id);
        }
      } catch (err) {
        console.error('[Studio] Failed to reconcile active run', err);
      }
    };
    void reconcile();
    const timer = window.setInterval(reconcile, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedId, activeRunId, echoThinking, closeRunStream, finalizeRunUi, attachRunStream]);

  useEffect(() => {
    if (!selectedId) {
      setFrameUrls({ a: null, b: null });
      setFrameReady({ a: false, b: false });
      setVisibleFrame('a');
      visibleFrameRef.current = 'a';
      pendingFrameRef.current = null;
      return;
    }
    const canonicalUrl = `/studio-canvas/${encodeURIComponent(selectedId)}/renders/current/index.html`;
    setFrameUrls({ a: canonicalUrl, b: null });
    setFrameReady({ a: false, b: false });
    setVisibleFrame('a');
    visibleFrameRef.current = 'a';
    pendingFrameRef.current = null;
  }, [selectedId]);

  // --- SSE for live updates ---

  useEffect(() => {
    if (!selectedId) return;
    const es = apiClient.createStudioEventStream(selectedId);

    es.addEventListener('studio.message.created', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.message) {
          if (data.message.role === 'assistant') {
            setEchoStreamingText(null);
            setEchoThinking(false);
            setEchoProgressText(null);
            setEchoLastError(null);
          }
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.message.id)) return prev;

            const normalizedIncoming = String(data.message.content || '').trim();
            const optimisticIdx = prev.findIndex((m) => {
              if (!m.id?.startsWith('optimistic-')) return false;
              if (m.role !== data.message.role) return false;
              return String(m.content || '').trim() === normalizedIncoming;
            });
            if (optimisticIdx >= 0) {
              const next = [...prev];
              next[optimisticIdx] = data.message;
              return next;
            }

            const nearDuplicateIdx = prev.findIndex((m) => {
              if (m.role !== data.message.role) return false;
              if (String(m.content || '').trim() !== normalizedIncoming) return false;
              const existingTs = Date.parse(m.createdAt || '');
              const incomingTs = Date.parse(data.message.createdAt || '');
              if (!Number.isFinite(existingTs) || !Number.isFinite(incomingTs)) return false;
              return Math.abs(existingTs - incomingTs) < 15000;
            });
            if (nearDuplicateIdx >= 0) {
              const next = [...prev];
              next[nearDuplicateIdx] = { ...next[nearDuplicateIdx], ...data.message };
              return next;
            }

            return [...prev, data.message];
          });
        }
      } catch {}
    });

    es.addEventListener('studio.render.updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.projectId) {
          setProjects((prev) =>
            prev.map((p) => (
              p.id === data.projectId
                ? {
                    ...p,
                    renderMode: data.renderMode || p.renderMode,
                    renderUrl: data.renderUrl || p.renderUrl,
                    sourceEntryPath: data.sourceEntryPath || p.sourceEntryPath,
                  }
                : p
            )),
          );
        }
      } catch {}
      refreshCanvas();
    });

    es.addEventListener('studio.run.started', (e) => {
      try {
        const data = JSON.parse(e.data);
        const incomingRunId = data?.run?.id || data?.runId || null;
        if (hasAttachedRunStream(incomingRunId)) return;
        if (data?.run && incomingRunId) {
          syncFromRun(data.run as StudioRun);
          attachRunStream(selectedId, incomingRunId);
        } else if (incomingRunId) {
          setActiveRunId(incomingRunId);
          activeRunIdRef.current = incomingRunId;
          attachRunStream(selectedId, incomingRunId);
          setEchoThinking(true);
          setEchoLastError(null);
          setEchoStreamingText(null);
          setEchoProgressText('Echo is thinking');
          setEchoTimeline([]);
        } else {
          setEchoThinking(true);
          setEchoLastError(null);
          setEchoStreamingText(null);
          setEchoProgressText('Echo is thinking');
          setEchoTimeline([]);
        }
      } catch {
        setEchoThinking(true);
        setEchoLastError(null);
        setEchoStreamingText(null);
        setEchoProgressText('Echo is thinking');
        setEchoTimeline([]);
      }
      pushTimeline('started', 'Run started.', 'info');
    });

    es.addEventListener('studio.run.progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        // Project SSE progress only bootstraps a run stream attachment.
        // It never applies progress state directly - the run stream owns that.
        if (hasAttachedRunStream(data?.runId)) return;
        if (data?.runId && activeRunIdRef.current === data.runId && !runStreamRef.current) {
          attachRunStream(selectedId, data.runId);
        } else if (data?.runId && !activeRunIdRef.current) {
          setActiveRunId(data.runId);
          activeRunIdRef.current = data.runId;
          attachRunStream(selectedId, data.runId);
        }
      } catch {}
    });

    // Terminal run events (completed/failed/cancelled) are NOT handled on the
    // project SSE lane. The run-scoped SSE stream owns terminal state while
    // attached, and the reconcile poll catches anything the run stream misses.
    // This eliminates the duplicated handler surface and the hasAttachedRunStream
    // guards that were the main source of ownership complexity.

    es.addEventListener('studio.checkpoint.created', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.version) {
          setVersions((prev) => (prev.some((version) => version.id === data.version.id) ? prev : [data.version, ...prev]));
        }
      } catch {}
    });

    es.addEventListener('studio.project.renamed', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.project) {
          setProjects((prev) =>
            prev.map((p) => (p.id === data.project.id ? { ...p, ...data.project } : p)),
          );
        }
      } catch {}
    });

    return () => es.close();
  }, [selectedId, attachRunStream, finalizeRunUi, hasAttachedRunStream, pushTimeline, syncFromRun]);

  // --- Auto-refresh timer ---
  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    if (autoRefresh && selectedId) {
      autoRefreshRef.current = setInterval(() => {
        refreshCanvas();
      }, 3000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, selectedId]);

  // --- Scroll-preserving canvas refresh ---
  // We keep the visible iframe stable and swap in a refreshed sibling frame.
  // Refresh can be triggered by SSE render updates and, when enabled, by the
  // timer-based auto-refresh path above.

  const refreshCanvas = useCallback(() => {
    if (!selectedId) return;
    const currentFrame = visibleFrameRef.current;
    const currentIframe = currentFrame === 'a' ? iframeARef.current : iframeBRef.current;
    const nextFrame: 'a' | 'b' = currentFrame === 'a' ? 'b' : 'a';
    const canonicalUrl = `/studio-canvas/${encodeURIComponent(selectedId)}/renders/current/index.html`;

    let scrollX = 0;
    let scrollY = 0;
    try {
      const iframeWindow = currentIframe?.contentWindow;
      if (iframeWindow) {
        scrollX = iframeWindow.scrollX || 0;
        scrollY = iframeWindow.scrollY || 0;
      }
    } catch {
      // cross-origin - can't read scroll
    }

    pendingScrollRef.current = { x: scrollX, y: scrollY };
    pendingFrameRef.current = nextFrame;
    setFrameReady((prev) => ({ ...prev, [nextFrame]: false }));
    setFrameUrls((prev) => ({
      ...prev,
      [nextFrame]: `${canonicalUrl}?t=${Date.now()}`,
    }));
  }, [selectedId]);

  const handleFrameLoad = useCallback((frame: 'a' | 'b') => {
    const pendingFrame = pendingFrameRef.current;
    const isSwapLoad = pendingFrame === frame;
    const isInitialVisibleLoad = !pendingFrame && frame === visibleFrameRef.current;
    if (!isSwapLoad && !isInitialVisibleLoad) return;

    const targetIframe = frame === 'a' ? iframeARef.current : iframeBRef.current;
    const { x, y } = pendingScrollRef.current;

    try {
      const doc = targetIframe?.contentDocument;
      if (doc?.head) {
        let styleEl = doc.getElementById('forge-studio-scrollbar-style') as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = doc.createElement('style');
          styleEl.id = 'forge-studio-scrollbar-style';
          doc.head.appendChild(styleEl);
        }
        styleEl.textContent = `
          :root { color-scheme: dark; }
          html, body {
            scrollbar-width: thin !important;
            scrollbar-color: rgba(130, 130, 130, 0.32) rgba(255,255,255,0.02) !important;
          }
          html::-webkit-scrollbar,
          body::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          html::-webkit-scrollbar-track,
          body::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.02);
          }
          html::-webkit-scrollbar-thumb,
          body::-webkit-scrollbar-thumb {
            background: rgba(130, 130, 130, 0.32);
            border-radius: 999px;
            border: 2px solid transparent;
            background-clip: padding-box;
          }
          html::-webkit-scrollbar-thumb:hover,
          body::-webkit-scrollbar-thumb:hover {
            background: rgba(160, 160, 160, 0.42);
            background-clip: padding-box;
          }
          html::-webkit-scrollbar-corner,
          body::-webkit-scrollbar-corner {
            background: transparent;
          }
        `;
      }
    } catch {}

    setFrameReady((prev) => ({ ...prev, [frame]: true }));
    setVisibleFrame(frame);
    visibleFrameRef.current = frame;

    if (isSwapLoad) {
      pendingFrameRef.current = null;
      window.requestAnimationFrame(() => {
        try {
          targetIframe?.contentWindow?.scrollTo(x, y);
        } catch {}
      });
    }
  }, []);

  // --- Actions ---

  const handleSelectProject = async (projectId: string) => {
    setSelectedId(projectId);
    try {
      await apiClient.selectStudioProject(projectId);
    } catch {}
  };

  const handleCreateProject = async (name: string) => {
    if (projectActionPending) return;
    setProjectActionPending('create');
    try {
      const res = await apiClient.createStudioProject(name);
      setProjects((prev) => [res.project, ...prev]);
      setSelectedId(res.project.id);
      flashUiNotice('success', `Created project ${res.project.name}.`);
    } catch (err) {
      console.error('[Studio] Failed to create project', err);
      flashUiNotice('error', extractErrorMessage(err, 'Failed to create project.'));
    } finally {
      setProjectActionPending(null);
    }
  };

  const handleDuplicateProject = async (projectId: string) => {
    if (projectActionPending) return;
    setProjectActionPending(`duplicate:${projectId}`);
    try {
      const res = await apiClient.duplicateStudioProject(projectId);
      setProjects((prev) => [res.project, ...prev]);
      setSelectedId(res.project.id);
      flashUiNotice('success', `Duplicated project as ${res.project.name}.`);
    } catch (err) {
      console.error('[Studio] Failed to duplicate project', err);
      flashUiNotice('error', extractErrorMessage(err, 'Failed to duplicate project.'));
    } finally {
      setProjectActionPending(null);
    }
  };

  const handleRenameProject = async (projectId: string, name: string) => {
    if (projectActionPending) return;
    setProjectActionPending(`rename:${projectId}`);
    try {
      const res = await apiClient.renameStudioProject(projectId, name);
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, ...res.project } : p)),
      );
      flashUiNotice('success', `Renamed project to ${res.project.name}.`);
    } catch (err) {
      console.error('[Studio] Failed to rename project', err);
      flashUiNotice('error', extractErrorMessage(err, 'Failed to rename project.'));
    } finally {
      setProjectActionPending(null);
    }
  };

  const handleSendMessage = async (content: string, mode: 'chat' | 'instruction') => {
    if (!selectedId || sending) return;
    setSending(true);
    setEchoStreamingText(null);
    setEchoLastError(null);
    // Optimistic: show user message immediately
    const optimisticMsg: StudioMessage = {
      id: `optimistic-${Date.now()}`,
      projectId: selectedId,
      sessionId: '',
      role: 'user',
      content,
      mode,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    try {
      const res = await apiClient.sendStudioMessage(selectedId, content, mode);
      // Replace optimistic with server message immediately (before SSE arrives)
      if (res.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? res.message : m)),
        );
      }
      if (res.run?.id) {
        syncFromRun({
          ...res.run,
          status: res.run.status || 'queued',
          progressText: normalizeStudioProgressText(res.run.progressText || 'Queued the request and preparing project context.', Boolean(res.run.partialText)) || 'Echo is typing',
          partialText: res.run.partialText || null,
          timeline: res.run.timeline || [{
            id: `queued-${Date.now()}`,
            stage: 'queued',
            message: 'Queued the request and preparing project context.',
            tone: 'info',
            ts: new Date().toISOString(),
          }],
        });
        attachRunStream(selectedId, res.run.id);
      }
    } catch (err) {
      console.error('[Studio] Failed to send message', err);
      const message = extractErrorMessage(err, 'Failed to send message.');
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      setEchoLastError(message);
      flashUiNotice('error', message);
      pushTimeline('send-failed', message, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleStopActiveRun = async () => {
    if (!selectedId || !activeRunId || stopRunPending) return;
    setStopRunPending(true);
    try {
      const res = await apiClient.stopStudioRun(selectedId, activeRunId);
      syncFromRun(res.run);
      setEchoThinking(false);
      setEchoStreamingText(null);
      setEchoProgressText(res.run.note || 'Run stopped.');
      setEchoLastError(null);
      closeRunStream();
    } catch (err) {
      console.error('[Studio] Failed to stop run', err);
      setEchoLastError('Failed to stop the current run.');
    } finally {
      setStopRunPending(false);
    }
  };

  const handleCreateCheckpoint = async (label?: string) => {
    if (!selectedId || checkpointPending) return;
    setCheckpointPending(true);
    try {
      const res = await apiClient.createStudioCheckpoint(selectedId, label);
      setVersions((prev) => (prev.some((version) => version.id === res.version.id) ? prev : [res.version, ...prev]));
      flashUiNotice('success', `Created checkpoint${label?.trim() ? `: ${label.trim()}` : '.'}`);
    } catch (err) {
      console.error('[Studio] Failed to create checkpoint', err);
      flashUiNotice('error', extractErrorMessage(err, 'Failed to create checkpoint.'));
    } finally {
      setCheckpointPending(false);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!selectedId || restorePendingVersionId) return;
    setRestorePendingVersionId(versionId);
    try {
      await apiClient.restoreStudioVersion(selectedId, versionId);
      refreshCanvas();
      flashUiNotice('success', 'Version restored.');
    } catch (err) {
      console.error('[Studio] Failed to restore version', err);
      flashUiNotice('error', extractErrorMessage(err, 'Failed to restore version.'));
    } finally {
      setRestorePendingVersionId(null);
    }
  };

  const toggleRightPane = (pane: RightPane) => {
    setRightPane((prev) => (prev === pane ? null : pane));
  };

  // --- Delete project ---

  const handleDeleteProject = async (projectId: string) => {
    if (projectActionPending) return;
    setProjectActionPending(`delete:${projectId}`);
    try {
      const res = await apiClient.deleteStudioProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (selectedId === projectId) {
        setSelectedId(res.selectedProjectId || null);
        setMessages([]);
        setVersions([]);
      }
      flashUiNotice('success', 'Project deleted.');
    } catch (err) {
      console.error('[Studio] Failed to delete project', err);
      flashUiNotice('error', extractErrorMessage(err, 'Failed to delete project.'));
    } finally {
      setProjectActionPending(null);
    }
  };

  // --- Canvas URL (canonical from project ID, never trust stale renderUrl) ---

  const canvasUrl = selectedId
    ? `/studio-canvas/${encodeURIComponent(selectedId)}/renders/current/index.html`
    : null;

  if (loading) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          background: '#0a0a0a',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 32,
              height: 32,
              border: '2px solid rgba(255,255,255,0.08)',
              borderTopColor: '#666',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <div
            style={{
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: 11,
              color: '#555',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            Loading Studio
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        background: '#0a0a0a',
        overflow: 'hidden',
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      {showOverlayScrim && (
        <button
          type="button"
          aria-label="Close side panels"
          onClick={() => {
            if (drawerOverlay) setDrawerOpen(false);
            if (rightPaneOverlay) setRightPane(null);
          }}
          style={{
            position: 'absolute',
            inset: 0,
            border: 'none',
            background: 'rgba(0,0,0,0.42)',
            zIndex: 20,
            cursor: 'pointer',
          }}
        />
      )}

      {/* Project Drawer (Fix 1: flexbox layout, canvas adjusts to available space) */}
      {drawerOpen && !fullscreen && (
        <div
          style={drawerOverlay ? { position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 40, boxShadow: '18px 0 48px rgba(0,0,0,0.42)' } : { position: 'relative', zIndex: 1 }}
        >
          <ProjectDrawer
            projects={projects}
            selectedId={selectedId}
            onSelect={handleSelectProject}
            onCreate={handleCreateProject}
            onRename={handleRenameProject}
            onDuplicate={handleDuplicateProject}
            onDelete={handleDeleteProject}
            actionPending={projectActionPending}
            width={drawerWidth}
            onClose={() => setDrawerOpen(false)}
            onNavigateHome={() => navigate('/')}
            onLogout={logout}
          />
        </div>
      )}

      {/* Center: Canvas + Toolbar - flex:1 means it takes remaining space */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Toolbar */}
        {!fullscreen && (
          <div
            style={{
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px 0 8px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(10,10,10,0.95)',
              backdropFilter: 'blur(12px)',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!drawerOpen && (
                <button onClick={() => setDrawerOpen(true)} style={toolbarBtnStyle} title="Show projects">
                  <Layers size={15} />
                </button>
              )}
              <span
                style={{
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  color: '#ccc',
                  textTransform: 'uppercase',
                  maxWidth: projectTitleMaxWidth,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedProject?.name || 'Echo Studio'}
              </span>
              {echoThinking && (
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "'SF Mono', monospace",
                    color: '#e8a838',
                    marginLeft: 4,
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                >
                  ● PROCESSING
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={refreshCanvas} style={toolbarBtnStyle} title="Refresh canvas">
                <RotateCw size={14} />
                {showToolbarLabels && <span>Refresh</span>}
              </button>
              <button
                onClick={() => setAutoRefresh((v) => !v)}
                style={{
                  ...toolbarBtnStyle,
                  height: 28,
                  minWidth: showToolbarLabels ? 104 : 32,
                  color: autoRefresh ? '#9fd68d' : '#8f8f8f',
                  background: autoRefresh ? 'rgba(74,124,68,0.18)' : 'rgba(255,255,255,0.05)',
                  border: autoRefresh ? '1px solid rgba(74,124,68,0.35)' : '1px solid rgba(255,255,255,0.08)',
                  gap: 6,
                  padding: '0 10px',
                  justifyContent: 'center',
                }}
                title={autoRefresh ? 'Auto-refresh ON (3s) - click to pause' : 'Auto-refresh OFF - click to enable'}
              >
                <RefreshCw size={12} />
                {showToolbarLabels && (
                  <span style={{ fontSize: 9, letterSpacing: '0.08em', fontFamily: "'SF Mono', monospace" }}>
                    {autoRefresh ? 'AUTO-REFRESH ON' : 'AUTO-REFRESH OFF'}
                  </span>
                )}
              </button>
              {canvasUrl && (
                <a
                  href={canvasUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...toolbarBtnStyle, textDecoration: 'none' }}
                  title="Open in new tab"
                >
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                onClick={() => setFullscreen(!fullscreen)}
                style={toolbarBtnStyle}
                title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>

              <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 4px' }} />

              <button
                onClick={() => toggleRightPane('chat')}
                style={{
                  ...toolbarBtnStyle,
                  color: rightPane === 'chat' ? '#e0e0e0' : '#666',
                  background: rightPane === 'chat' ? 'rgba(255,255,255,0.08)' : undefined,
                }}
                title="Chat"
              >
                <MessageSquare size={15} />
              </button>
              <button
                onClick={() => toggleRightPane('versions')}
                style={{
                  ...toolbarBtnStyle,
                  color: rightPane === 'versions' ? '#e0e0e0' : '#666',
                  background: rightPane === 'versions' ? 'rgba(255,255,255,0.08)' : undefined,
                }}
                title="Versions"
              >
                <History size={15} />
              </button>
              <button
                onClick={() => toggleRightPane('code')}
                style={{
                  ...toolbarBtnStyle,
                  color: reactLiveEnabled ? '#7fdc72' : rightPane === 'code' ? '#e0e0e0' : '#666',
                  background: rightPane === 'code'
                    ? (reactLiveEnabled ? 'rgba(74,124,68,0.2)' : 'rgba(255,255,255,0.08)')
                    : undefined,
                  borderColor: reactLiveEnabled ? 'rgba(74,124,68,0.34)' : 'transparent',
                }}
                title={reactLiveEnabled ? 'React source - live enabled' : 'React source'}
              >
                <Code2 size={15} />
              </button>
            </div>
          </div>
        )}

        {uiNotice && (
          <div
            style={{
              margin: '12px 12px 0',
              padding: '10px 12px',
              borderRadius: 10,
              border: uiNotice.tone === 'error' ? '1px solid rgba(214,96,96,0.28)' : '1px solid rgba(74,124,68,0.30)',
              background: uiNotice.tone === 'error' ? 'rgba(106,32,32,0.18)' : 'rgba(42,79,38,0.16)',
              color: uiNotice.tone === 'error' ? '#e7b0b0' : '#a8d19d',
              fontSize: 11,
              fontFamily: "'SF Mono', monospace",
              letterSpacing: '0.02em',
              flexShrink: 0,
            }}
          >
            {uiNotice.text}
          </div>
        )}

        {/* Canvas viewport (Fix 1: takes all remaining flex space, no overlap) */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'stretch',
            background: '#111',
          }}
        >
          {canvasUrl ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                overflow: 'hidden',
                position: 'relative',
                background: '#0a0a0a',
              }}
            >
              <iframe
                ref={iframeARef}
                src={frameUrls.a || canvasUrl}
                onLoad={() => handleFrameLoad('a')}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: '#0a0a0a',
                  opacity: visibleFrame === 'a' && frameReady.a ? 1 : 0,
                  pointerEvents: visibleFrame === 'a' && frameReady.a ? 'auto' : 'none',
                  transition: 'opacity 140ms ease',
                }}
                title="Echo Studio Canvas"
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
              />
              <iframe
                ref={iframeBRef}
                src={frameUrls.b || 'about:blank'}
                onLoad={() => handleFrameLoad('b')}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: '#0a0a0a',
                  opacity: visibleFrame === 'b' && frameReady.b ? 1 : 0,
                  pointerEvents: visibleFrame === 'b' && frameReady.b ? 'auto' : 'none',
                  transition: 'opacity 140ms ease',
                }}
                title="Echo Studio Canvas staging"
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
              />
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: '#444', fontFamily: "'SF Mono', monospace", letterSpacing: '0.05em' }}>
                  Select or create a project to begin
                </div>
              </div>
            </div>
          )}

          {/* Fullscreen exit hint */}
          {fullscreen && (
            <button
              onClick={() => setFullscreen(false)}
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                zIndex: 50,
                ...toolbarBtnStyle,
                background: 'rgba(0,0,0,0.7)',
                backdropFilter: 'blur(8px)',
              }}
              title="Exit fullscreen"
            >
              <Minimize2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Right Panel */}
      {rightPane && !fullscreen && (
        <div
          style={{
            width: rightPaneWidth,
            marginLeft: rightPaneOverlay ? 0 : 12,
            flexShrink: 0,
            minHeight: 0,
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            background: '#0c0c0c',
            display: 'flex',
            flexDirection: 'column',
            overflow: rightPane === 'chat' ? 'visible' : 'hidden',
            position: rightPaneOverlay ? 'absolute' : 'relative',
            top: rightPaneOverlay ? 48 : undefined,
            right: rightPaneOverlay ? 0 : undefined,
            bottom: rightPaneOverlay ? 0 : undefined,
            boxShadow: rightPaneOverlay ? '-18px 0 48px rgba(0,0,0,0.42)' : undefined,
            zIndex: rightPaneOverlay ? 40 : 30,
          }}
        >
          {rightPane === 'chat' && (
            <ChatRail
              messages={messages}
              projectId={selectedId || ''}
              projectName={selectedProject?.name || 'Untitled'}
              sending={sending}
              echoThinking={echoThinking}
              progressText={echoProgressText}
              streamingText={echoStreamingText}
              lastError={echoLastError}
              timeline={echoTimeline}
              viewportWidth={viewportWidth}
              railWidth={rightPaneWidth}
              onSend={handleSendMessage}
              onStopRun={handleStopActiveRun}
              canStopRun={Boolean(selectedId && activeRunId && echoThinking)}
              stopPending={stopRunPending}
              disabled={!selectedId}
            />
          )}
          {rightPane === 'versions' && (
            <VersionPanel
              versions={versions}
              currentVersionId={selectedProject?.currentVersionId || null}
              onCheckpoint={handleCreateCheckpoint}
              onRestore={handleRestoreVersion}
              checkpointPending={checkpointPending}
              restorePendingVersionId={restorePendingVersionId}
              disabled={!selectedId}
            />
          )}
          {rightPane === 'code' && (
            <CodeRail
              projectId={selectedId || ''}
              projectName={selectedProject?.name || 'Untitled'}
              disabled={!selectedId}
              runLocked={echoThinking}
              onHotUpdate={(jsx: string) => {
                const frame = visibleFrameRef.current === 'a' ? iframeARef.current : iframeBRef.current;
                try { frame?.contentWindow?.postMessage({ type: 'hot-jsx', source: jsx }, '*'); } catch {}
              }}
            />
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
};

const toolbarBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 32,
  minWidth: 32,
  padding: '0 8px',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  color: '#888',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  transition: 'all 100ms',
};

export default Studio;
