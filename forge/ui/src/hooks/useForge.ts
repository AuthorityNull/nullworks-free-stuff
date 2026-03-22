import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../api/client';
import type {
  Model,
  Agent,
  Role,
  ResearchItem,
  Run,
  PipelinePhase,
  Mapping,
  Rollback,
  PromptCard,
  Webhook,
  HealthResponse,
} from '../api/types';

export type { Model, Agent, Role, ResearchItem, Run, PipelinePhase, Mapping, Rollback, PromptCard, Webhook };

interface LoadingState {
  health: boolean;
  models: boolean;
  agents: boolean;
  roles: boolean;
  research: boolean;
  runs: boolean;
  phases: boolean;
  mappings: boolean;
  approvals: boolean;
  rollbacks: boolean;
  prompts: boolean;
  webhooks: boolean;
  pipeline: boolean;
}

interface ErrorState {
  health: string | null;
  models: string | null;
  agents: string | null;
  roles: string | null;
  research: string | null;
  runs: string | null;
  phases: string | null;
  mappings: string | null;
  approvals: string | null;
  rollbacks: string | null;
  prompts: string | null;
  webhooks: string | null;
  pipeline: string | null;
}

interface ForgeState {
  health: HealthResponse | null;
  models: Model[];
  agents: Agent[];
  roles: Role[];
  research: ResearchItem[];
  runs: Run[];
  phases: PipelinePhase[];
  mappings: Mapping[];
  approvals: Run[];
  rollbacks: Rollback[];
  promptCards: PromptCard[];
  webhooks: Webhook[];
  loading: LoadingState;
  errors: ErrorState;
}

const defaultLoading: LoadingState = {
  health: true,
  models: true,
  agents: true,
  roles: true,
  research: true,
  runs: true,
  phases: true,
  mappings: true,
  approvals: true,
  rollbacks: true,
  prompts: true,
  webhooks: true,
  pipeline: false,
};

const defaultErrors: ErrorState = {
  health: null,
  models: null,
  agents: null,
  roles: null,
  research: null,
  runs: null,
  phases: null,
  mappings: null,
  approvals: null,
  rollbacks: null,
  prompts: null,
  webhooks: null,
  pipeline: null,
};

export const useForge = () => {
  const [state, setState] = useState<ForgeState>({
    health: null,
    models: [],
    agents: [],
    roles: [],
    research: [],
    runs: [],
    phases: [],
    mappings: [],
    approvals: [],
    rollbacks: [],
    promptCards: [],
    webhooks: [],
    loading: { ...defaultLoading },
    errors: { ...defaultErrors },
  });

  const mountedRef = useRef(true);
  // Track if initial load is complete
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const setLoading = (key: keyof LoadingState, val: boolean) => {
    if (!mountedRef.current) return;
    setState(prev => ({ ...prev, loading: { ...prev.loading, [key]: val } }));
  };

  const setError = (key: keyof ErrorState, err: unknown) => {
    if (!mountedRef.current) return;
    const raw = err instanceof Error ? err.message : String(err);
    // Don't treat 401 as error - it's an auth redirect signal
    if (raw.includes('401') || raw.includes('Unauthorized')) {
      return;
    }
    const msg = raw === 'Unauthorized' ? 'Authentication required' : raw;
    setState(prev => ({ ...prev, errors: { ...prev.errors, [key]: msg } }));
  };

  const clearError = (key: keyof ErrorState) => {
    if (!mountedRef.current) return;
    setState(prev => ({ ...prev, errors: { ...prev.errors, [key]: null } }));
  };

  // Load each resource independently so failures don't block others
  useEffect(() => {
    const load = async <T,>(
      key: keyof LoadingState & keyof ErrorState,
      fetcher: () => Promise<T>,
      setter: (data: T) => void,
    ) => {
      try {
        const data = await fetcher();
        if (mountedRef.current) setter(data);
      } catch (err) {
        setError(key, err);
      } finally {
        setLoading(key, false);
      }
    };

    load('health', () => apiClient.health(), (h) =>
      setState(prev => ({ ...prev, health: h })),
    );
    load('models', () => apiClient.getModels(), (d) =>
      setState(prev => ({ ...prev, models: d })),
    );
    load('agents', () => apiClient.getAgents(), (d) =>
      setState(prev => ({ ...prev, agents: d })),
    );
    load('roles', () => apiClient.getRoles(), (d) =>
      setState(prev => ({ ...prev, roles: d })),
    );
    load('research', () => apiClient.getResearch(), (d) =>
      setState(prev => ({ ...prev, research: d })),
    );
    load('runs', () => apiClient.getRuns(), (d) =>
      setState(prev => ({ ...prev, runs: d })),
    );
    load('phases', () => apiClient.getPipelinePhases(), (d) =>
      setState(prev => ({ ...prev, phases: d })),
    );
    load('mappings', () => apiClient.getMappings(), (d) =>
      setState(prev => ({ ...prev, mappings: d })),
    );
    load('approvals', () => apiClient.getApprovals(), (d) =>
      setState(prev => ({ ...prev, approvals: d })),
    );
    load('rollbacks', () => apiClient.getRollbacks(), (d) =>
      setState(prev => ({ ...prev, rollbacks: d })),
    );
    load('prompts', () => apiClient.getPromptCards(), (d) =>
      setState(prev => ({ ...prev, promptCards: d })),
    );
    load('webhooks', () => apiClient.getWebhooks(), (d) =>
      setState(prev => ({ ...prev, webhooks: d })),
    );
    
    initialLoadDoneRef.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Actions ---

  const runPipeline = useCallback(async (payload: { modelId: string; agentId: string; roleId?: string; promptPath?: string }) => {
    setLoading('pipeline', true);
    clearError('pipeline');
    try {
      const resp = await apiClient.runPipeline(payload);
      // Refresh runs after starting pipeline
      const runs = await apiClient.getRuns();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, runs, loading: { ...prev.loading, pipeline: false } }));
      }
      return resp;
    } catch (err) {
      setError('pipeline', err);
      setLoading('pipeline', false);
      throw err;
    }
  }, []);

  const scanResearch = useCallback(async () => {
    setLoading('research', true);
    clearError('research');
    try {
      await apiClient.scanResearch();
      const research = await apiClient.getResearch();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, research, loading: { ...prev.loading, research: false } }));
      }
    } catch (err) {
      setError('research', err);
      setLoading('research', false);
      throw err;
    }
  }, []);

  const acceptResearch = useCallback(async (id: string) => {
    clearError('research');
    try {
      await apiClient.acceptResearch(id);
      const research = await apiClient.getResearch();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, research }));
      }
    } catch (err) {
      setError('research', err);
      throw err;
    }
  }, []);

  const rejectResearch = useCallback(async (id: string) => {
    clearError('research');
    try {
      await apiClient.rejectResearch(id);
      const research = await apiClient.getResearch();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, research }));
      }
    } catch (err) {
      setError('research', err);
      throw err;
    }
  }, []);

  const updateResearch = useCallback(
    async (id: string, updates: { title?: string; summary?: string; details?: string }) => {
      clearError('research');
      try {
        await apiClient.updateResearch(id, updates);
        const research = await apiClient.getResearch();
        if (mountedRef.current) {
          setState(prev => ({ ...prev, research }));
        }
      } catch (err) {
        setError('research', err);
        throw err;
      }
    },
    [],
  );

  const updatePipelinePhase = useCallback(
    async (phaseName: string, updates: { enabled?: boolean; settings?: Record<string, unknown> }) => {
      clearError('phases');
      try {
        await apiClient.updatePipelinePhase(phaseName, updates);
        const phases = await apiClient.getPipelinePhases();
        if (mountedRef.current) {
          setState(prev => ({ ...prev, phases }));
        }
      } catch (err) {
        setError('phases', err);
        throw err;
      }
    },
    [],
  );

  const createMapping = useCallback(
    async (m: { agentId: string; modelId: string; roleId: string; promptPath: string }) => {
      clearError('mappings');
      try {
        const resp = await apiClient.createMapping(m);
        const mappings = await apiClient.getMappings();
        if (mountedRef.current) {
          setState(prev => ({ ...prev, mappings }));
        }
        return resp;
      } catch (err) {
        setError('mappings', err);
        throw err;
      }
    },
    [],
  );

  const retryRun = useCallback(async (id: string) => {
    clearError('runs');
    try {
      const resp = await apiClient.retryRun(id);
      const runs = await apiClient.getRuns();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, runs }));
      }
      return resp;
    } catch (err) {
      setError('runs', err);
      throw err;
    }
  }, []);

  const autofixRun = useCallback(async (id: string) => {
    clearError('runs');
    try {
      const resp = await apiClient.autofixRun(id);
      const runs = await apiClient.getRuns();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, runs }));
      }
      return resp;
    } catch (err) {
      setError('runs', err);
      throw err;
    }
  }, []);

  const approveRun = useCallback(async (id: string, reason?: string) => {
    clearError('approvals');
    try {
      const resp = await apiClient.approveRun(id, reason);
      // Refresh both approvals and runs
      const [approvals, runs] = await Promise.all([
        apiClient.getApprovals(),
        apiClient.getRuns(),
      ]);
      if (mountedRef.current) {
        setState(prev => ({ ...prev, approvals, runs }));
      }
      return resp;
    } catch (err) {
      setError('approvals', err);
      throw err;
    }
  }, []);

  const denyRun = useCallback(async (id: string, reason?: string) => {
    clearError('approvals');
    try {
      const resp = await apiClient.denyRun(id, reason);
      const [approvals, runs] = await Promise.all([
        apiClient.getApprovals(),
        apiClient.getRuns(),
      ]);
      if (mountedRef.current) {
        setState(prev => ({ ...prev, approvals, runs }));
      }
      return resp;
    } catch (err) {
      setError('approvals', err);
      throw err;
    }
  }, []);

  const applyRollback = useCallback(async (id: string) => {
    clearError('rollbacks');
    try {
      const resp = await apiClient.applyRollback(id);
      const rollbacks = await apiClient.getRollbacks();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, rollbacks }));
      }
      return resp;
    } catch (err) {
      setError('rollbacks', err);
      throw err;
    }
  }, []);

  const createWebhook = useCallback(
    async (webhook: { callbackUrl: string; events: string[]; name?: string; active?: boolean }) => {
      clearError('webhooks');
      try {
        const created = await apiClient.createWebhook(webhook);
        const webhooks = await apiClient.getWebhooks();
        if (mountedRef.current) {
          setState(prev => ({ ...prev, webhooks }));
        }
        return created;
      } catch (err) {
        setError('webhooks', err);
        throw err;
      }
    },
    [],
  );

  const deleteWebhook = useCallback(async (id: string) => {
    clearError('webhooks');
    try {
      await apiClient.deleteWebhook(id);
      const webhooks = await apiClient.getWebhooks();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, webhooks }));
      }
    } catch (err) {
      setError('webhooks', err);
      throw err;
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    setLoading('runs', true);
    clearError('runs');
    try {
      const runs = await apiClient.getRuns();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, runs, loading: { ...prev.loading, runs: false } }));
      }
    } catch (err) {
      setError('runs', err);
      setLoading('runs', false);
    }
  }, []);

  const refreshResearch = useCallback(async () => {
    setLoading('research', true);
    clearError('research');
    try {
      const research = await apiClient.getResearch();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, research, loading: { ...prev.loading, research: false } }));
      }
    } catch (err) {
      setError('research', err);
      setLoading('research', false);
    }
  }, []);

  const refreshApprovals = useCallback(async () => {
    setLoading('approvals', true);
    clearError('approvals');
    try {
      const approvals = await apiClient.getApprovals();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, approvals, loading: { ...prev.loading, approvals: false } }));
      }
    } catch (err) {
      setError('approvals', err);
      setLoading('approvals', false);
    }
  }, []);

  const refreshWebhooks = useCallback(async () => {
    setLoading('webhooks', true);
    clearError('webhooks');
    try {
      const webhooks = await apiClient.getWebhooks();
      if (mountedRef.current) {
        setState(prev => ({ ...prev, webhooks, loading: { ...prev.loading, webhooks: false } }));
      }
    } catch (err) {
      setError('webhooks', err);
      setLoading('webhooks', false);
    }
  }, []);

  return {
    ...state,
    // Actions
    runPipeline,
    scanResearch,
    acceptResearch,
    rejectResearch,
    updateResearch,
    updatePipelinePhase,
    createMapping,
    retryRun,
    autofixRun,
    approveRun,
    denyRun,
    applyRollback,
    createWebhook,
    deleteWebhook,
    // Refreshers
    refreshRuns,
    refreshResearch,
    refreshApprovals,
    refreshWebhooks,
  };
};

export default useForge;
