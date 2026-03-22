// API Types - aligned with server.js backend contracts

export interface Model {
  id: string;
  name: string;
  provider: string;
  status: 'active' | 'canary' | 'deprecated';
}

export interface Agent {
  id: string;
  name: string;
  description: string;
}

export interface Role {
  id: string;
  name: string;
  constraints: string[];
}

export interface Mapping {
  id: string;
  agentId: string;
  modelId: string;
  roleId: string;
  promptPath: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ResearchItem {
  id: string;
  title: string;
  summary?: string;
  details?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface PipelinePhase {
  phase: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface RunHistoryEntry {
  ts: string;
  event: string;
  message: string;
}

export interface RunApprovals {
  required: boolean;
  status: 'pending' | 'approved' | 'denied';
  reason?: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface RunPhaseEntry {
  name: string;
  state: string;
  settings: Record<string, unknown>;
}

export interface Run {
  id: string;
  status: string;
  phase: string;
  requestedBy: string | null;
  requestedAt: string;
  updatedAt: string;
  targetAgent?: string | null;
  model?: string | null;
  role?: string | null;
  promptPath?: string | null;
  tuning?: Record<string, unknown> | null;
  generatedPrompt?: string;
  approvals: RunApprovals;
  phases: RunPhaseEntry[];
  history: RunHistoryEntry[];
}

export interface Rollback {
  id: string;
  runId: string;
  reason: string;
  createdAt: string;
  createdBy: string;
  status: string;
}

export interface PromptCard {
  id: string;
  modelId: string;
  agentId: string;
  title: string;
  label?: string;
  preview?: string;
  enabled: boolean;
  updatedAt?: string;
}

export interface PromptMain {
  agentId: string;
  modelId: string;
  content: string;
  updatedAt: string;
}

export interface Webhook {
  id: string;
  name: string;
  callbackUrl: string;
  callbackUrlRedacted?: boolean;
  events: string[];
  active: boolean;
  createdAt?: string;
  createdBy?: string;
}

export interface ForgeUser {
  email: string;
  name: string;
  picture?: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  status: string;
}

export interface RunPipelineRequest {
  modelId: string;
  agentId: string;
  roleId?: string;
  promptPath?: string;
  tuning?: Record<string, unknown>;
}

export interface RunPipelineResponse {
  ok: boolean;
  runId: string;
  eventId: string;
}

export interface RunActionResponse {
  ok: boolean;
  runId: string;
  status: string;
}

export interface ApprovalDecisionResponse {
  ok: boolean;
  runId: string;
  decision: string;
  decisionEventId: string;
}

export interface MappingResponse {
  ok: boolean;
  mapping: Mapping;
  eventId: string;
}

export interface AuthSessionResponse {
  ok: boolean;
  token?: string | null;
  csrfToken?: string | null;
  user?: ForgeUser | null;
  session?: {
    expiresAt: string;
    ttlMs?: number;
    refreshWindowMs?: number;
  };
}

export interface GoogleAuthUrlResponse {
  ok: boolean;
  url: string;
  state: string;
}

export interface InviteValidationResponse {
  ok: boolean;
  invite: {
    valid: boolean;
    codeFingerprint: string;
  };
}

// --- Prompt File Browser types ---

export interface PromptFileEntry {
  name: string;
  path: string;
  size?: number;
  modifiedAt?: string;
}

export interface PromptTreeAgent {
  agent: string;
  label: string;
  files: PromptFileEntry[];
}

export interface PromptTreeResponse {
  ok: boolean;
  tree: PromptTreeAgent[];
}

export interface PromptFileResponse {
  ok: boolean;
  path: string;
  content: string;
  size?: number;
  modifiedAt?: string;
}

// --- File Tree Node (nested directory structure) ---

export interface FileTreeNode {
  name: string;
  type: 'file' | 'dir';
  path: string;
  size?: number;
  modifiedAt?: string;
  children?: FileTreeNode[];
}

export interface FileTreeResponse {
  ok: boolean;
  tree: FileTreeNode[];
}

// --- Pipeline Progress SSE types ---

export interface PipelineStreamPhase {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

export interface PipelineStreamEvent {
  type: 'phase_update' | 'log' | 'complete' | 'error';
  phase?: string;
  status?: string;
  message?: string;
  phases?: PipelineStreamPhase[];
  summary?: string;
}

// --- Echo Studio types ---

export interface StudioProject {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'archived';
  activeSessionId?: string | null;
  currentVersionId?: string | null;
  renderMode?: 'html' | 'react';
  sourceEntryPath?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  messageCount?: number;
  versionCount?: number;
  renderUrl?: string;
  renderEntryPath?: string;
  latestVersionId?: string | null;
}

export type StudioMessageMode = 'chat' | 'instruction';

export interface StudioMessage {
  id: string;
  projectId: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string;
  createdBy?: string;
  mode?: StudioMessageMode;
}

export interface StudioRunTimelineEntry {
  id: string;
  stage: string;
  message: string;
  ts: string;
  tone?: 'info' | 'success' | 'error';
}

export interface StudioRun {
  status: string;
  note?: string;
  id?: string;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  error?: string | null;
  progressText?: string | null;
  partialText?: string | null;
  timeline?: StudioRunTimelineEntry[];
}

export interface StudioVersion {
  id: string;
  projectId: string;
  label: string;
  source: 'ai' | 'manual' | 'checkpoint' | 'autosave';
  renderEntryPath: string;
  snapshotPath?: string;
  createdAt: string;
}

export interface StudioProjectsResponse {
  ok: boolean;
  selectedProjectId: string | null;
  projects: StudioProject[];
}

export interface StudioProjectResponse {
  ok: boolean;
  selectedProjectId?: string | null;
  project: StudioProject;
}

export interface StudioMessagesResponse {
  ok: boolean;
  project: StudioProject;
  messages: StudioMessage[];
}

export interface StudioMessageCreateResponse {
  ok: boolean;
  project: StudioProject;
  message: StudioMessage;
  run?: StudioRun;
}

export interface StudioRunsResponse {
  ok: boolean;
  runs: StudioRun[];
}

export interface StudioVersionsResponse {
  ok: boolean;
  project: StudioProject;
  versions: StudioVersion[];
}

export interface StudioCheckpointResponse {
  ok: boolean;
  project: StudioProject;
  version: StudioVersion;
}

export interface StudioRenderResponse {
  ok: boolean;
  project: StudioProject;
  render: {
    url: string;
    entryPath: string;
    currentVersionId: string | null;
  };
}

export interface StudioSourceResponse {
  ok: boolean;
  project: StudioProject;
  source: {
    enabled: boolean;
    exists: boolean;
    entryPath: string;
    content: string;
  };
  render?: {
    url: string;
    entryPath: string;
    currentVersionId: string | null;
  };
}

export interface StudioAttachment {
  id: string;
  projectId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  path: string;
  workspacePath?: string;
  createdAt: string;
  createdBy: string;
}

export interface StudioAttachmentUploadResponse {
  ok: boolean;
  attachments: StudioAttachment[];
}

export interface StudioAttachmentListResponse {
  ok: boolean;
  attachments: StudioAttachment[];
}