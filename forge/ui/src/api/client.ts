import type {
  Model,
  Agent,
  Role,
  Mapping,
  ResearchItem,
  PipelinePhase,
  Run,
  Rollback,
  PromptCard,
  PromptMain,
  Webhook,
  HealthResponse,
  RunPipelineRequest,
  RunPipelineResponse,
  RunActionResponse,
  ApprovalDecisionResponse,
  MappingResponse,
  ForgeUser,
  AuthSessionResponse,
  GoogleAuthUrlResponse,
  InviteValidationResponse,
  PromptTreeResponse,
  PromptFileResponse,
  StudioProject,
  StudioProjectsResponse,
  StudioProjectResponse,
  StudioMessage,
  StudioMessagesResponse,
  StudioMessageCreateResponse,
  StudioRun,
  StudioRunsResponse,
  StudioVersion,
  StudioVersionsResponse,
  StudioCheckpointResponse,
  StudioRenderResponse,
  StudioSourceResponse,
  StudioAttachment,
  StudioAttachmentUploadResponse,
  StudioAttachmentListResponse,
} from './types';

export type {
  Model,
  PromptMain,
  Agent,
  Role,
  Mapping,
  ResearchItem,
  PipelinePhase,
  Run,
  Rollback,
  PromptCard,
  Webhook,
  HealthResponse,
  RunPipelineResponse,
  RunActionResponse,
  ApprovalDecisionResponse,
  MappingResponse,
  ForgeUser,
  AuthSessionResponse,
  GoogleAuthUrlResponse,
  InviteValidationResponse,
  PromptTreeResponse,
  PromptFileResponse,
  StudioProject,
  StudioProjectsResponse,
  StudioProjectResponse,
  StudioMessage,
  StudioMessagesResponse,
  StudioMessageCreateResponse,
  StudioRun,
  StudioRunsResponse,
  StudioVersion,
  StudioVersionsResponse,
  StudioCheckpointResponse,
  StudioRenderResponse,
  StudioSourceResponse,
  StudioAttachment,
  StudioAttachmentUploadResponse,
  StudioAttachmentListResponse,
};

class ForgeAPIClient {
  private baseUrl: string;
  private csrfToken: string | null = null;

  constructor() {
    this.baseUrl = '/api/v1';
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { 'Content-Type': 'application/json', ...extra };
  }

  private clearToken(): void {
    this.csrfToken = null;
  }

  private rememberSession(session?: AuthSessionResponse | null): void {
    this.csrfToken = session?.csrfToken || null;
  }

  async getAuthSession(): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: this.buildHeaders(),
    });

    if (response.status === 401) {
      this.clearToken();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `Session check failed: ${response.status}`);
    }

    const data = (await response.json()) as AuthSessionResponse;
    this.rememberSession(data);
    return data;
  }

  async getCSRFToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const data = await this.getAuthSession();
    if (!data.csrfToken) {
      throw new Error('Missing CSRF token');
    }
    return data.csrfToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const method = String(options.method || 'GET').toUpperCase();
    const headers = this.buildHeaders((options.headers as Record<string, string>) || {});

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      const csrfToken = await this.getCSRFToken();
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch(url, { ...options, credentials: 'include', headers });

    if (response.status === 401) {
      this.clearToken();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Request failed: ${response.status}`);
    }

    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) return (await response.json()) as T;
    return {} as T;
  }

  async login(token: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || 'Login failed');
    }
    this.rememberSession(data as AuthSessionResponse);
    return data as AuthSessionResponse;
  }

  async getGoogleAuthUrl(inviteCode?: string): Promise<GoogleAuthUrlResponse> {
    if (inviteCode && inviteCode.trim()) {
      const response = await fetch(`${this.baseUrl}/auth/google/url`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: inviteCode.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Could not start Google sign-in');
      return data as GoogleAuthUrlResponse;
    }

    const response = await fetch(`${this.baseUrl}/auth/google/url`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || 'Could not start Google sign-in');
    return data as GoogleAuthUrlResponse;
  }

  async loginWithGoogleIdToken(idToken: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/auth/google`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || 'Google login failed');
    }
    this.rememberSession(data as AuthSessionResponse);
    return data as AuthSessionResponse;
  }

  async loginWithGoogle(code: string, state: string, inviteCode?: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/auth/google/callback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state, inviteCode: inviteCode?.trim() || undefined }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || 'Google login failed');
    }
    this.rememberSession(data as AuthSessionResponse);
    return data as AuthSessionResponse;
  }

  async validateInviteCode(inviteCode: string): Promise<InviteValidationResponse> {
    const response = await fetch(`${this.baseUrl}/auth/invite/validate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: inviteCode.trim() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || 'Invite code validation failed');
    }
    return data as InviteValidationResponse;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.clearToken();
    }
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  async getModels(): Promise<Model[]> {
    const r: { ok: boolean; models: Model[] } = await this.request('/models');
    return r.models ?? [];
  }

  async getAgents(): Promise<Agent[]> {
    const r: { ok: boolean; agents: Agent[] } = await this.request('/agents');
    return r.agents ?? [];
  }

  async getRoles(): Promise<Role[]> {
    const r: { ok: boolean; roles: Role[] } = await this.request('/roles');
    return r.roles ?? [];
  }

  async getMappings(): Promise<Mapping[]> {
    const r: { ok: boolean; mappings: Mapping[] } = await this.request('/agents/mappings');
    return r.mappings ?? [];
  }

  async createMapping(m: {
    agentId: string;
    modelId: string;
    roleId: string;
    promptPath: string;
  }): Promise<MappingResponse> {
    return this.request<MappingResponse>('/agents/mappings', {
      method: 'POST',
      body: JSON.stringify(m),
    });
  }

  async getResearch(): Promise<ResearchItem[]> {
    const r: { ok: boolean; research: ResearchItem[] } = await this.request('/research');
    return r.research ?? [];
  }

  async scanResearch(): Promise<ResearchItem> {
    const r: { ok: boolean; item: ResearchItem } = await this.request('/research/scan', {
      method: 'POST',
    });
    return r.item;
  }

  async acceptResearch(id: string): Promise<ResearchItem> {
    const r: { ok: boolean; item: ResearchItem } = await this.request(`/research/${id}/accept`, {
      method: 'POST',
    });
    return r.item;
  }

  async rejectResearch(id: string): Promise<ResearchItem> {
    const r: { ok: boolean; item: ResearchItem } = await this.request(`/research/${id}/reject`, {
      method: 'POST',
    });
    return r.item;
  }

  async updateResearch(
    id: string,
    updates: { title?: string; summary?: string; details?: string },
  ): Promise<ResearchItem> {
    const r: { ok: boolean; item: ResearchItem } = await this.request(`/research/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return r.item;
  }

  async getPipelinePhases(): Promise<PipelinePhase[]> {
    const r: { ok: boolean; phases: PipelinePhase[] } = await this.request('/pipeline/phases');
    return r.phases ?? [];
  }

  async updatePipelinePhase(
    phaseName: string,
    updates: { enabled?: boolean; settings?: Record<string, unknown> },
  ): Promise<PipelinePhase> {
    const r: { ok: boolean; phase: PipelinePhase } = await this.request(
      `/pipeline/phases/${phaseName}`,
      { method: 'PATCH', body: JSON.stringify(updates) },
    );
    return r.phase;
  }

  async runPipeline(payload: RunPipelineRequest): Promise<RunPipelineResponse> {
    return this.request<RunPipelineResponse>('/pipeline/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getRuns(): Promise<Run[]> {
    const r: { ok: boolean; runs: Run[] } = await this.request('/runs');
    return r.runs ?? [];
  }

  async getRun(id: string): Promise<Run> {
    const r: { ok: boolean; run: Run } = await this.request(`/runs/${id}`);
    return r.run;
  }

  async stopRun(id: string): Promise<RunActionResponse> {
    return this.request<RunActionResponse>(`/runs/${id}/stop`, { method: 'POST' });
  }

  async pauseRun(id: string): Promise<RunActionResponse> {
    return this.request<RunActionResponse>(`/runs/${id}/pause`, { method: 'POST' });
  }

  async resumeRun(id: string): Promise<RunActionResponse> {
    return this.request<RunActionResponse>(`/runs/${id}/resume`, { method: 'POST' });
  }

  async retryRun(id: string): Promise<RunActionResponse> {
    return this.request<RunActionResponse>(`/runs/${id}/retry`, { method: 'POST' });
  }

  async autofixRun(id: string): Promise<RunActionResponse> {
    return this.request<RunActionResponse>(`/runs/${id}/autofix`, { method: 'POST' });
  }

  createRunStream(runId: string): EventSource {
    return new EventSource(`${this.baseUrl}/runs/${runId}/stream`);
  }

  async getApprovals(): Promise<Run[]> {
    const r: { ok: boolean; approvals: Run[] } = await this.request('/approvals');
    return r.approvals ?? [];
  }

  async approveRun(id: string, reason?: string): Promise<ApprovalDecisionResponse> {
    return this.request<ApprovalDecisionResponse>(`/approvals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Approved via UI' }),
    });
  }

  async denyRun(id: string, reason?: string): Promise<ApprovalDecisionResponse> {
    return this.request<ApprovalDecisionResponse>(`/approvals/${id}/deny`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Denied via UI' }),
    });
  }

  async getRollbacks(): Promise<Rollback[]> {
    const r: { ok: boolean; rollbacks: Rollback[] } = await this.request('/rollbacks');
    return r.rollbacks ?? [];
  }

  async applyRollback(id: string): Promise<{ ok: boolean; id: string }> {
    return this.request(`/rollbacks/${id}/apply`, { method: 'POST' });
  }

  async getPromptsMain(agentId: string, modelId: string): Promise<PromptMain> {
    const r: { ok: boolean; key?: string; model?: string; agent?: string; content?: string } = await this.request(
      `/prompts/main?agent=${encodeURIComponent(agentId)}&model=${encodeURIComponent(modelId)}`
    );
    return {
      agentId: r.agent || agentId,
      modelId: r.model || modelId,
      content: r.content || '',
      updatedAt: new Date().toISOString(),
    };
  }

  async updatePromptsMain(agentId: string, modelId: string, content: string): Promise<{ ok: boolean }> {
    return this.request('/prompts/main', {
      method: 'PATCH',
      body: JSON.stringify({ agentId, modelId, content }),
    });
  }

  async getPromptCards(): Promise<PromptCard[]> {
    const r: { ok: boolean; cards: PromptCard[] } = await this.request('/prompts/cards');
    return r.cards ?? [];
  }

  async applyPrompts(payload: {
    runId: string;
    agentId: string;
    modelId: string;
    roleId?: string;
    promptPath: string;
    apply: string;
  }): Promise<{ ok: boolean; runId: string; eventId: string }> {
    return this.request('/prompts/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async applyPrompt(payload: {
    runId: string;
    apply: string;
    agentId?: string;
    modelId?: string;
    roleId?: string;
    promptPath?: string;
  }): Promise<{ ok: boolean; runId: string; eventId: string }> {
    return this.request('/prompts/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getWebhooks(): Promise<Webhook[]> {
    const r: { ok: boolean; webhooks: Webhook[] } = await this.request('/webhooks');
    return r.webhooks ?? [];
  }

  async createWebhook(webhook: {
    callbackUrl: string;
    events: string[];
    name?: string;
    active?: boolean;
  }): Promise<Webhook> {
    const r: { ok: boolean; webhook: Webhook } = await this.request('/webhooks', {
      method: 'POST',
      body: JSON.stringify(webhook),
    });
    return r.webhook;
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request(`/webhooks/${id}`, { method: 'DELETE' });
  }

  // --- Prompt File Browser ---

  async getPromptTree(): Promise<PromptTreeResponse> {
    return this.request<PromptTreeResponse>('/prompts/tree');
  }

  async getPromptFile(filePath: string): Promise<PromptFileResponse> {
    return this.request<PromptFileResponse>(
      `/prompts/file?path=${encodeURIComponent(filePath)}`,
    );
  }

  async updatePromptFile(filePath: string, content: string): Promise<{ ok: boolean }> {
    return this.request('/prompts/file', {
      method: 'PUT',
      body: JSON.stringify({ path: filePath, content }),
    });
  }

  // --- Echo Studio ---

  async getStudioProjects(): Promise<StudioProjectsResponse> {
    return this.request<StudioProjectsResponse>('/studio/projects');
  }

  async createStudioProject(name: string): Promise<StudioProjectResponse> {
    return this.request<StudioProjectResponse>('/studio/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async getStudioProject(projectId: string): Promise<StudioProjectResponse> {
    return this.request<StudioProjectResponse>(`/studio/projects/${encodeURIComponent(projectId)}`);
  }

  async renameStudioProject(projectId: string, name: string): Promise<StudioProjectResponse> {
    return this.request<StudioProjectResponse>(`/studio/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  async selectStudioProject(projectId: string): Promise<StudioProjectResponse> {
    return this.request<StudioProjectResponse>(`/studio/projects/${encodeURIComponent(projectId)}/select`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async duplicateStudioProject(projectId: string, name?: string): Promise<StudioProjectResponse> {
    return this.request<StudioProjectResponse>(`/studio/projects/${encodeURIComponent(projectId)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name: name || '' }),
    });
  }

  async deleteStudioProject(projectId: string): Promise<{ ok: boolean; deletedProjectId: string; selectedProjectId: string | null }> {
    return this.request<{ ok: boolean; deletedProjectId: string; selectedProjectId: string | null }>(`/studio/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
  }

  async getStudioMessages(projectId: string): Promise<StudioMessagesResponse> {
    return this.request<StudioMessagesResponse>(`/studio/projects/${encodeURIComponent(projectId)}/messages`);
  }

  async sendStudioMessage(projectId: string, content: string, mode: 'chat' | 'instruction' = 'chat'): Promise<StudioMessageCreateResponse> {
    return this.request<StudioMessageCreateResponse>(`/studio/projects/${encodeURIComponent(projectId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, mode }),
    });
  }

  async getStudioRuns(projectId: string): Promise<StudioRunsResponse> {
    return this.request<StudioRunsResponse>(`/studio/projects/${encodeURIComponent(projectId)}/runs`);
  }

  async stopStudioRun(projectId: string, runId: string): Promise<{ ok: boolean; run: StudioRun }> {
    return this.request<{ ok: boolean; run: StudioRun }>(`/studio/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getStudioVersions(projectId: string): Promise<StudioVersionsResponse> {
    return this.request<StudioVersionsResponse>(`/studio/projects/${encodeURIComponent(projectId)}/versions`);
  }

  async createStudioCheckpoint(projectId: string, label?: string): Promise<StudioCheckpointResponse> {
    return this.request<StudioCheckpointResponse>(`/studio/projects/${encodeURIComponent(projectId)}/checkpoints`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
  }

  async restoreStudioVersion(projectId: string, versionId: string): Promise<StudioRenderResponse> {
    return this.request<StudioRenderResponse>(`/studio/projects/${encodeURIComponent(projectId)}/restore/${encodeURIComponent(versionId)}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getStudioRender(projectId: string): Promise<StudioRenderResponse> {
    return this.request<StudioRenderResponse>(`/studio/projects/${encodeURIComponent(projectId)}/render`);
  }

  async getStudioSource(projectId: string): Promise<StudioSourceResponse> {
    return this.request<StudioSourceResponse>(`/studio/projects/${encodeURIComponent(projectId)}/source`);
  }

  async updateStudioSource(
    projectId: string,
    content: string,
    options: { activate?: boolean; enabled?: boolean } = {},
  ): Promise<StudioSourceResponse> {
    return this.request<StudioSourceResponse>(`/studio/projects/${encodeURIComponent(projectId)}/source`, {
      method: 'PUT',
      body: JSON.stringify({ content, ...options }),
    });
  }

  async uploadStudioAttachments(projectId: string, files: File[]): Promise<StudioAttachmentUploadResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file, file.name);
    }
    const csrfToken = await this.getCSRFToken();
    const headers: Record<string, string> = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    // Do NOT set Content-Type - browser sets multipart boundary automatically
    const response = await fetch(`${this.baseUrl}/studio/projects/${encodeURIComponent(projectId)}/attachments`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Upload failed: ${response.status}`);
    }
    return (await response.json()) as StudioAttachmentUploadResponse;
  }

  async getStudioAttachments(projectId: string): Promise<StudioAttachmentListResponse> {
    return this.request<StudioAttachmentListResponse>(`/studio/projects/${encodeURIComponent(projectId)}/attachments`);
  }

  createStudioEventStream(projectId: string): EventSource {
    return new EventSource(`${this.baseUrl}/studio/projects/${encodeURIComponent(projectId)}/events`);
  }
}

const apiClient = new ForgeAPIClient();
export default apiClient;

// Google Client ID for GIS (Google Identity Services) flow
export const GOOGLE_CLIENT_ID = (window as any).__FORGE_CONFIG__?.GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID || '';