/**
 * mem0-sidecar v9 - Production-grade memory for OpenClaw agents.
 *
 * Hardened for container environments:
 *   - Safe SQLite defaults (/tmp) with env overrides
 *   - Defensive init: never crashes the gateway
 *   - Kill switch via MEM0_DISABLE env var
 *
 * v2 improvements:
 *   - Quality-filtered capture: custom prompt extracts only durable facts
 *   - Pre-filter: skips heartbeat/cron/automated noise conversations
 *   - Dedup on capture: stores then searches, removes near-duplicates
 *   - Capture logging: every decision logged to append-only file for audit
 *
 * v3 improvements:
 *   - Source tagging: captured_at + source_session metadata on every stored memory
 *   - TTL soft decay: downweight older memories by age in recall scoring
 *   - Hard exclude filter: age > ttlHardExcludeDays AND score < ttlHardExcludeMinScore -> filtered out
 *   - Infer gate: skip mem.add() when total message content below minInferChars threshold
 *   - JSON parse safety: per-item try/catch on all results iteration - one bad entry never kills the batch
 *
 * v4 improvements:
 *   - Category classification: heuristic assigns preference/decision/infrastructure/lesson/project/person
 *   - Confidence scoring: specificity heuristic (IPs, paths, versions, names = higher confidence)
 *   - Recall metadata: lastRecalled + recallCount updated in Qdrant on every recall hit
 *   - Direct Qdrant payload updates for metadata enrichment (no extra LLM calls)
 *
 * v5 improvements:
 *   - Cross-agent shared namespace: dual-recall queries both agent userId AND "shared"
 *   - Auto write-routing: infrastructure-classified memories also stored under userId="shared"
 *   - mem0_store_shared tool: manual writes directly to the shared namespace
 *
 * v6 improvements:
 *   - Confidence gate: memories with confidence < 0.55 are withheld from injection
 *   - Pre-v4 memories (no confidence tag) always pass through unchanged
 *   - Gate is logged per-session for observability
 *
 * v7 improvements:
 *   - Recall quality metric: useful_count incremented at recall-time for injected memories
 *   - Category-aware recall boosting: re-scores raw Qdrant results using query signal
 *     detection (infrastructure/person/project/decision) before sorting/slicing
 *
 * v8 improvements:
 *   - Inbound contradiction sweep: after capture, searches for similar existing memories
 *     and uses qwen2.5:7b via Ollama to detect contradictions; invalidates old conflicting
 *     memories (fail-safe: sweep failure never blocks storage)
 *
 * v9 improvements:
 *   - valid_at/invalid_at invalidation: superseded facts are marked invalid_at in Qdrant
 *     metadata instead of being deleted; filtered out at retrieval. Preserves audit trail.
 *   - Category-aware decay half-lives: per-category lambda replaces uniform 0.01.
 *     infrastructure=7d, preference=30d, person=1825d, state=1d, credential=14d,
 *     relationship=90d, lesson=180d, decision=365d, project=60d, default=30d.
 *   - Composite scoring at retrieval: score = 0.35*relevance + 0.25*recency +
 *     0.25*importance + 0.15*confirmations. Replaces simple decay*rawScore.
 *   - Write-time metadata: importance (heuristic per category), confirmations=1,
 *     valid_at=now stored on every new memory via qdrantSetPayload.
 *   - Expanded category taxonomy: added state, credential, relationship categories
 *     with dedicated classifier rules.
 *
 * Does NOT set kind:"memory" so the built-in memory_search stays active.
 * Provides:
 *   - Auto-recall via before_agent_start hook (injects relevant memories)
 *   - Auto-capture via agent_end hook (extracts facts from conversations)
 *   - mem0_store tool (manually store a memory)
 *   - mem0_forget tool (delete a memory by ID)
 *   - mem0_list tool (browse stored memories)
 */

import type { OpenClawPlugin } from "openclaw";
import { mkdirSync, appendFileSync } from "fs";
import { dirname } from "path";

interface SidecarConfig {
  userId?: string;
  autoRecall?: boolean;
  autoCapture?: boolean;
  topK?: number;
  searchThreshold?: number;
  dedupThreshold?: number;
  captureLogPath?: string;
  customInstructions?: string;
  embedder?: { provider: string; config: Record<string, unknown> };
  vectorStore?: { provider: string; config: Record<string, unknown> };
  llm?: { provider: string; config: Record<string, unknown> };
  historyDbPath?: string;
  minCaptureChars?: number;
  // v3 config (ttlDecayLambda now only used as fallback for unknown categories)
  ttlDecayLambda?: number;          // default 0.01
  ttlHardExcludeDays?: number;      // default 90
  ttlHardExcludeMinScore?: number;  // default 0.7
  minInferChars?: number;           // default 150
}

// ============================================================================
// Capture quality: custom prompt for memory extraction
// ============================================================================
const CAPTURE_INSTRUCTIONS = `You are a memory extraction system for an AI agent. Your job is to identify DURABLE facts worth remembering across sessions.

EXTRACT these types of memories:
- User preferences and communication style
- Decisions made and their rationale
- Infrastructure state changes (server IPs, ports, service configs, stable topology facts)
- Lessons learned from debugging or failures
- Project milestones and status changes
- Information about people (names, roles, relationships)
- Technical configurations that were set up or changed
- Task completions: if a task closed this session, capture "[RESOLVED] <task name>: <one-line outcome> as of <date>" and nothing more — do NOT capture the in-progress steps

SECURITY RULES:
- NEVER store raw secrets, passwords, API keys, bearer tokens, cookies, private keys, or credential values.
- If a conversation contains secret material, extract only the handling fact, not the value.
- Good: "GitHub token is retrieved via the approved secret wrapper [verify: check SECURITY.md]"
- Bad: "GitHub token is ghp_abc123..."

SKIP these - they are noise, NOT memories:
- Status updates ("system is stable", "heartbeat complete", "working on X")
- Transient tool operations ("module loads cleanly", "command succeeded")
- Routine acknowledgments ("got it", "done", "ok")
- Error messages that were already resolved in the same conversation
- Internal system/cron/automated flow details unless they reveal a permanent change
- Anything that will be false or irrelevant within hours
- Mid-task progress notes ("checkpoint", "next step is", "still working on") — these decay fast and create noise; only capture if they represent a permanent decision or lesson

FORMAT: Write each memory as one short sentence - tweet-length. Fact only, no preamble. If it feels too long, distill to the single most important point.
BAD: "User configured a server"
GOOD: "Production database uses PostgreSQL 16.2 on port 5432 at db.internal.example.com"

VERIFY TAGS: Append a verify hint when the memory is a claim that could become stale or wrong:
- Claims about code, files, or config: append [verify: check file]
- Claims about rules, process, or agent behavior: append [verify: check AGENTS.md]
- Claims about file paths or directory structure: append [verify: confirm path]
- Claims about schema, config structure, or JSON/YAML format: append [verify: validate schema]
- Claims about personality, core truths, identity, or how the agent should behave: append [verify: check SOUL.md]
- Claims about where procedures live, what workflow to follow, or what procedure docs exist: append [verify: check INDEX.md]
- Claims about tool availability, CLI commands, host paths, or how to use specific tools: append [verify: check TOOLS.md]
- Claims about user preferences, authorized users, or who has access: append [verify: check USER.md]
- Claims about credentials, vault access, env vars, or security policy: append [verify: check SECURITY.md]
- Claims about how to begin, plan, or resume a task, or task file structure: append [verify: check TASK-PROCEDURE.md]
- Claims about sub-agent delegation, model selection, or agent tool rules: append [verify: check DELEGATE-WORK.md]
- Claims about editing files, config changes, or system prompt modifications: append [verify: check TOUCHING-FILES.md]
- Claims about restart procedures, SIGUSR1, container or service restarts: append [verify: check RESTART-PROCEDURE.md]
- Claims about token-heavy work, context efficiency, delegation thresholds, or read strategies: append [verify: check TOKEN-EFFICIENCY.md]
- Claims summarising what was discussed, decided, or agreed in a Discord conversation: append [verify: discrawl search]
- Stable facts (IPs, ports, names, established decisions): no tag needed

GOOD with tag: "mem0-sidecar has no char truncation limit [verify: check file]"
GOOD with tag: "Commits use safe-git-commit.sh [verify: check AGENTS.md]"
GOOD with tag: "openclaw.json requires a 'model' field under agents [verify: validate schema]"
GOOD with tag: "Agent should be direct and avoid sycophancy [verify: check SOUL.md]"
GOOD with tag: "The git push procedure is documented in GITHUB-PROCEDURE.md [verify: check INDEX.md]"
GOOD with tag: "Bird CLI is at /usr/bin/bird on the host [verify: check TOOLS.md]"
GOOD with tag: "thority prefers direct action over explanation [verify: check USER.md]"
GOOD with tag: "Secrets are accessed via the approved internal vault wrapper [verify: check SECURITY.md]"
GOOD with tag: "New tasks require a plan file before execution [verify: check TASK-PROCEDURE.md]"
GOOD with tag: "Heavy autonomous work delegates to an isolated Opus or GPT sub-agent [verify: check DELEGATE-WORK.md]"
GOOD with tag: "System prompt edits require reading TOUCHING-FILES.md System Prompt Tweaking section first [verify: check TOUCHING-FILES.md]"
GOOD with tag: "Gateway restarts use SIGUSR1 via restart-clud.sh, not a hard kill [verify: check RESTART-PROCEDURE.md]"

If the conversation contains NO durable facts worth remembering, extract NOTHING. An empty extraction is better than noise.`;

// ============================================================================
// Pre-filter: detect noise conversations not worth capturing
// ============================================================================
const NOISE_PATTERNS = [
  /^heartbeat/i,
  /^HEARTBEAT_OK$/,
  /^\[System Message\]/,
  /^Gateway restart/,
  /^NO_REPLY$/,
  /continuity[-.]reflect/i,
  /continuity[-.]health/i,
  /continuity[-.]maintain/i,
  /continuity[-.]metrics/i,
  /^Read \/workspace\/tasks\/current\.md/,
  /^Read HEARTBEAT\.md if it exists/i,
  /If nothing needs attention, reply HEARTBEAT_OK/i,
  /^\[cron:/i,
  /^System:.*Exec finished/i,
  /^System:.*diff --git/i,
  /^Conversation info \(untrusted/i,
  /^Sender \(untrusted/i,
  /^Replied message \(untrusted/i,
  /^\[Audio\]\s*$/i,
  /^Transcript:\s*$/i,
];

function isNoiseMessage(text: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(text.trim()));
}

function shouldSkipCapture(
  messages: Array<{ role: string; content: string }>,
  minChars: number = 100
): { skip: boolean; reason: string } {
  if (messages.length === 0)
    return { skip: true, reason: "no messages" };

  const userMessages = messages.filter(m => m.role === "user");

  // No user messages = pure automated flow
  if (userMessages.length === 0)
    return { skip: true, reason: "no user messages (automated flow)" };

  // All user messages are noise patterns
  const substantiveUserMsgs = userMessages.filter(
    m => !isNoiseMessage(m.content)
  );
  if (substantiveUserMsgs.length === 0)
    return { skip: true, reason: "all user messages are noise/heartbeat" };

  // Very short exchange with no substance
  if (messages.length <= 2) {
    const totalChars = messages.reduce(
      (sum, m) => sum + m.content.length,
      0
    );
    if (totalChars < minChars)
      return {
        skip: true,
        reason: `exchange too short (${totalChars} < ${minChars} chars)`,
      };
  }

  return { skip: false, reason: "" };
}

// ============================================================================
// Capture logging
// ============================================================================
function logCapture(
  logPath: string | undefined,
  entry: {
    action: string;
    userId: string;
    sessionId?: string;
    reason?: string;
    count?: number;
    skipped?: number;
    details?: string;
  }
): void {
  if (!logPath) return;
  try {
    ensureDir(logPath);
    const line =
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    appendFileSync(logPath, line);
  } catch {
    // best-effort logging
  }
}

// ============================================================================
// v3: TTL decay helpers
// ============================================================================

/**
 * Compute age in days from a captured_at ISO timestamp.
 * Returns 0 if timestamp is missing or unparseable (no penalty for untagged memories).
 */
function computeAgeDays(capturedAt: string | undefined | null): number {
  if (!capturedAt) return 0;
  try {
    const ts = new Date(capturedAt).getTime();
    if (isNaN(ts)) return 0;
    const now = Date.now();
    const diffMs = now - ts;
    return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * Apply exponential decay to a raw score based on age.
 * decayedScore = rawScore * exp(-lambda * ageDays)
 */
function decayScore(rawScore: number, ageDays: number, lambda: number): number {
  return rawScore * Math.exp(-lambda * ageDays);
}

/**
 * Returns a staleness annotation tag for injection based on memory age.
 * Memories prefixed with [PERMANENT] are never tagged as stale.
 * < 7d  : no tag (fresh)
 * 7-29d : "[Xd old]"
 * 30-89d: "[Xd old - verify]"
 * 90d+  : "[Xd old - treat as stale]"
 */
function staleTag(ageDays: number, memoryText?: string): string {
  if (memoryText && memoryText.trimStart().startsWith("[PERMANENT]")) return "";
  const d = Math.floor(ageDays);
  if (d < 7) return "";
  if (d < 30) return ` [${d}d old]`;
  if (d < 90) return ` [${d}d old - verify]`;
  return ` [${d}d old - treat as stale]`;
}

// ============================================================================
// v3: Safe memory entry accessor
// ============================================================================

/**
 * Safely extract text from a memory entry. Returns null if entry is malformed.
 */
function safeMemoryText(entry: any): string | null {
  try {
    const text = entry?.memory ?? entry?.content ?? null;
    if (text && typeof text === "string") return text;
    return null;
  } catch {
    return null;
  }
}

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:token|api[_\s-]?key|secret|password|passwd|authorization|bearer)\b\s*[:=]\s*["']?[A-Za-z0-9_\-\/=+:.]{8,}/i,
  /\b(?:cookie|session(?:id)?|jwt)\b\s*[:=]\s*["']?[A-Za-z0-9_\-\.=]{10,}/i,
];

function looksSensitiveValue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// Post-extraction noise patterns: memories that look like LLM extraction artifacts
const MEMORY_NOISE_PATTERNS = [
  /^the (user|agent|system|assistant) (is|was|has been) (working|talking|discussing|chatting)/i,
  /^(currently|right now) (working on|debugging|fixing|investigating)/i,
  /^(no |nothing )?(new |significant )?(memories|facts|information) (to |worth )?(extract|store|remember)/i,
  /^(this |the )?(conversation|session|exchange) (was |is )?(about|regarding|concerning)/i,
  /^HEARTBEAT/i,
  /^NO_REPLY$/,
  /^(ok|okay|done|got it|understood|acknowledged|will do|sure|yes|no)\.?$/i,
];

function shouldRejectMemoryText(
  text: string,
  category?: MemoryCategory
): { reject: boolean; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { reject: true, reason: "empty memory" };
  if (trimmed.length < 10) return { reject: true, reason: "too short to be useful" };
  if (looksSensitiveValue(trimmed)) {
    return { reject: true, reason: "secret-like value detected" };
  }
  if (category === "task_progress" && !/^\[RESOLVED\]/i.test(trimmed)) {
    return { reject: true, reason: "in-progress task memory rejected" };
  }
  if (MEMORY_NOISE_PATTERNS.some(p => p.test(trimmed))) {
    return { reject: true, reason: "extraction noise pattern" };
  }
  return { reject: false, reason: "" };
}

/**
 * Extract a stable user namespace from the session key.
 * OpenClaw session keys follow the pattern:
 *   agent:<agentId>:<provider>:<chatType>:<userId>[:<extra>]
 * For direct chats: agent:main:discord:direct:<userId>
 * For groups: agent:main:discord:group:channelId
 *
 * We want the trailing segment(s) that identify the user or chat.
 */
function extractNamespaceFromSessionKey(sessionKey: string): { chatType: string; target: string } | null {
  if (!sessionKey) return null;
  // Pattern: agent:<id>:<provider>:<type>:<target>[:<sub>]
  const parts = sessionKey.split(":");
  if (parts.length < 5) return null;
  const chatType = parts[3]; // "direct", "group", "channel", etc.
  const target = parts.slice(4).join(":"); // userId or channelId
  if (!target) return null;
  return { chatType, target };
}

function getNamespaceProvider(ctx: any, event?: any): string | null {
  const directProvider = [ctx?.provider, event?.provider, ctx?.surface, event?.surface]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (directProvider) return directProvider.trim().toLowerCase();

  const sessionKey = ctx?.sessionKey ?? event?.sessionKey;
  if (typeof sessionKey === "string") {
    const parts = sessionKey.split(":");
    if (parts.length >= 3 && parts[2]) {
      return parts[2].trim().toLowerCase();
    }
  }

  return null;
}

function isSyntheticNamespaceCandidate(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (["cli", "acp", "system", "assistant", "unknown", "discord", "slack", "telegram", "signal", "imessage", "webchat"].includes(normalized)) {
    return true;
  }
  if (normalized.startsWith("channel:")) return true;
  if (normalized.startsWith("agent:")) return true;
  if (normalized.startsWith("session:")) return true;
  if (normalized.startsWith("tool:")) return true;
  return false;
}

function isValidUserNamespaceCandidate(value: string, provider: string | null): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isSyntheticNamespaceCandidate(trimmed)) return false;

  if (provider === "discord") {
    return /^\d{15,22}$/.test(trimmed);
  }

  return trimmed.length >= 2 && trimmed.length <= 256;
}

function extractSenderIdFromTransportMetadata(
  text: string,
  provider: string | null,
): { userId: string; source: string } | null {
  if (!text) return null;

  const senderBlockMatch = text.match(/(?:^|\n)Sender \(untrusted metadata\):\s*```json\n([\s\S]*?)\n```/);
  if (senderBlockMatch) {
    try {
      const parsed = JSON.parse(senderBlockMatch[1]);
      if (typeof parsed?.id === "string" && isValidUserNamespaceCandidate(parsed.id, provider)) {
        return { userId: parsed.id.trim(), source: "message.transport.sender.id" };
      }
    } catch {}
  }

  const convoBlockMatch = text.match(/(?:^|\n)Conversation info \(untrusted metadata\):\s*```json\n([\s\S]*?)\n```/);
  if (convoBlockMatch) {
    try {
      const parsed = JSON.parse(convoBlockMatch[1]);
      if (typeof parsed?.sender_id === "string" && isValidUserNamespaceCandidate(parsed.sender_id, provider)) {
        return { userId: parsed.sender_id.trim(), source: "message.transport.conversation.sender_id" };
      }
    } catch {}
  }

  return null;
}

function findSenderIdInRawMessages(
  rawMessages: any[],
  provider: string | null,
): { userId: string; source: string } | null {
  for (let i = rawMessages.length - 1; i >= 0; i -= 1) {
    const msg = rawMessages[i];
    if (msg?.role !== "user") continue;
    const text = Array.isArray(msg?.content)
      ? msg.content.map((block: any) => typeof block?.text === "string" ? block.text : "").join("\n")
      : typeof msg?.content === "string"
        ? msg.content
        : "";
    const extracted = extractSenderIdFromTransportMetadata(text, provider);
    if (extracted) return extracted;
  }
  return null;
}

function resolveUserNamespace(
  fallbackUserId: string,
  ctx: any,
  event?: any
): { userId: string; source: string } {
  const provider = getNamespaceProvider(ctx, event);
  const promptSender = typeof event?.prompt === "string"
    ? extractSenderIdFromTransportMetadata(event.prompt, provider)
    : null;
  const messageSender = Array.isArray(event?.messages)
    ? findSenderIdInRawMessages(event.messages, provider)
    : null;

  // Priority 1: Explicit metadata, including transport metadata extracted from the raw user message.
  const explicitPairs: Array<[unknown, string]> = [
    [ctx?.metadata?.sender_id, "ctx.metadata.sender_id"],
    [event?.metadata?.sender_id, "event.metadata.sender_id"],
    [ctx?.senderId, "ctx.senderId"],
    [ctx?.authorId, "ctx.authorId"],
    [promptSender?.userId, promptSender?.source ?? "event.prompt.transport"],
    [messageSender?.userId, messageSender?.source ?? "event.messages.transport"],
  ];

  for (const [candidate, source] of explicitPairs) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (!isValidUserNamespaceCandidate(value, provider)) continue;
    return { userId: value, source };
  }

  // Priority 2: Parse sessionKey conservatively.
  // Only trust parsed targets for direct chats, where the target is the real user id.
  // For channel/group chats, fall back to the configured namespace unless explicit sender metadata exists.
  const sessionKey = ctx?.sessionKey ?? event?.sessionKey;
  if (typeof sessionKey === "string") {
    const parsed = extractNamespaceFromSessionKey(sessionKey);
    if (parsed?.chatType === "direct") {
      return { userId: parsed.target, source: "sessionKey.parsed.direct" };
    }
  }

  // Priority 3: Conservative fallback fields.
  // Do not use chat/channel identifiers as memory namespaces here - they can
  // collapse unrelated conversations into provider/channel scoped buckets like
  // `discord` or `channel:<id>`, which is exactly the regression we are avoiding.
  const fallbackPairs: Array<[unknown, string]> = [
    [ctx?.userId, "ctx.userId"],
  ];

  for (const [candidate, source] of fallbackPairs) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (!value) continue;
    return { userId: value, source };
  }

  return { userId: fallbackUserId, source: "config.userId" };
}

// v4: Direct Qdrant point GET helper (companion to qdrantSetPayload)
async function qdrantGetPoint(pointId: string): Promise<any> {
  const { default: http } = await import("http");
  return new Promise<any>((resolve) => {
    const req = http.request(
      {
        hostname: QDRANT_HOST,
        port: QDRANT_PORT,
        path: `/collections/${QDRANT_COLLECTION}/points/${pointId}`,
        method: "GET",
      },
      (res) => {
        let body = "";
        res.on("data", (d: Buffer) => { body += d.toString(); });
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch { resolve({}); }
        });
      }
    );
    req.on("error", () => resolve({}));
    req.end();
  });
}

// v8: Direct Qdrant point DELETE helper (kept for manual cleanup; contradiction sweep now uses invalidation)
async function qdrantDeletePoint(pointId: string): Promise<void> {
  const body = JSON.stringify({ points: [pointId] });
  const { default: http } = await import("http");
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        hostname: QDRANT_HOST,
        port: QDRANT_PORT,
        path: `/collections/${QDRANT_COLLECTION}/points/delete`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 400) resolve();
        else reject(new Error(`Qdrant point delete failed: ${res.statusCode}`));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ============================================================================
// v7: Token overlap helpers for recall quality metric
// ============================================================================

const QUALITY_STOPWORDS = new Set([
  "the","and","for","that","this","with","from","have","will","been",
  "are","was","not","but","they","their","there","what","when","where",
  "which","who","how","can","all","also","into","more","than","then",
  "its","our","your","just","some","only","over","about",
]);

function tokenizeForOverlap(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !QUALITY_STOPWORDS.has(t))
  );
}

function computeOverlapRatio(memoryText: string, responseText: string): number {
  const memTokens = tokenizeForOverlap(memoryText);
  if (memTokens.size === 0) return 0;
  const respTokens = tokenizeForOverlap(responseText);
  let overlap = 0;
  for (const t of memTokens) {
    if (respTokens.has(t)) overlap++;
  }
  return overlap / memTokens.size;
}

// ============================================================================
// v7: Category-aware recall boosting
// ============================================================================

/**
 * Infer a category affinity multiplier map from the recall query.
 * Returns boost multipliers for matching categories; empty map = no boost.
 * Pure and synchronous - no I/O, no side effects.
 */
function inferQueryCategoryAffinity(query: string): Partial<Record<MemoryCategory, number>> {
  const q = query.toLowerCase();
  const result: Partial<Record<MemoryCategory, number>> = {};
  const apply = (boosts: Partial<Record<MemoryCategory, number>>) => {
    for (const [cat, mult] of Object.entries(boosts) as [MemoryCategory, number][]) {
      result[cat] = Math.max(result[cat] ?? 1.0, mult);
    }
  };
  if (/\b(port|ip|host|url|ssh|docker|server|config|path|key|token|endpoint|cert|network)\b/.test(q)) {
    apply({ infrastructure: 1.35, lesson: 1.1 });
  }
  if (/\b(user|thority|prefers|likes|style|tone|always|never|who)\b/.test(q)) {
    apply({ person: 1.3, preference: 1.3 });
  }
  if (/\b(flipsuite|forge|engram|phase|task|build|roadmap|ship|epic)\b/.test(q)) {
    apply({ project: 1.25, decision: 1.1 });
  }
  if (/\b(decided|chose|switched|plan|approach|strategy|going forward)\b/.test(q)) {
    apply({ decision: 1.3, lesson: 1.1 });
  }
  if (/\b(password|secret|credential|api.?key|vault|rotate|expire)\b/.test(q)) {
    apply({ credential: 1.4, infrastructure: 1.1 });
  }
  if (/\b(status|running|down|offline|active|current|state|deployed)\b/.test(q)) {
    apply({ state: 1.35, infrastructure: 1.15 });
  }
  if (/\b(team|works with|reports to|manages|collaborat|member|relationship)\b/.test(q)) {
    apply({ relationship: 1.3, person: 1.15 });
  }
  if (/\b(discord|conversation|discussed|we talked|channel|chat history|what.{0,20}said)\b/.test(q)) {
    apply({ project: 1.2, decision: 1.2 });
  }
  return result;
}

// ============================================================================
// v4/v9: Memory category classifier (heuristic, no LLM call)
// v9: expanded with state, credential, relationship categories
// ============================================================================

type MemoryCategory =
  | "preference"
  | "decision"
  | "infrastructure"
  | "lesson"
  | "project"
  | "person"
  | "state"
  | "credential"
  | "relationship"
  | "task_progress";

const CATEGORY_RULES: Array<{ category: MemoryCategory; patterns: RegExp[] }> = [
  {
    category: "credential",
    patterns: [
      /\b(password|secret|api[_\s-]?key|token|credential|vault|rotate|expire|auth|oauth|jwt|bearer|ssh[_\s-]?key|cert(ificate)?)\b/i,
      /\b(vault-get|VAULT(?:_|[\s-])CALLER|env[_\s-]?var|\.env)\b/i,
    ],
  },
  {
    category: "state",
    patterns: [
      /\b(currently|right now|at the moment|as of now)\b.*\b(is|are|running|down|active|offline|deployed|broken|working)\b/i,
      /\b(status|uptime|health|alive|dead|crashed|restarting)\b.*\b(is|was|changed|now)\b/i,
      /\b(currently (running|using|on|deployed|active|set to))\b/i,
    ],
  },
  {
    category: "person",
    patterns: [
      /\b(user|thority|authority_null|clud|snoopy|echo|member|owner|role|discord user)\b.*\b(is|has|prefers|uses|named|called)/i,
      /\bname is\b|\busername is\b|\bis (the )?user\b/i,
    ],
  },
  {
    category: "relationship",
    patterns: [
      /\b(team|works with|reports to|manages|collaborat|org(anization)?[_\s-]?structure)\b/i,
      /\b(relationship|partner|colleague|boss|manager|lead|mentor)\b/i,
    ],
  },
  {
    category: "infrastructure",
    patterns: [
      /\b(port|ip|host|url|endpoint|server|docker|container|ssh|nginx|qdrant|postgres|redis|ollama|tailscale|cloudflare|dns|ssl|tls|cert|proxy|api key|token|secret|env var|config file|volume|mount|network|firewall)\b/i,
      /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,  // IP address
      /:\d{4,5}\b/,  // port number
      /\/root\/|\/home\/|\/workspace\/|\/etc\/|\/usr\/local\//i,  // absolute paths
    ],
  },
  {
    category: "decision",
    patterns: [
      /\b(decided|chose|agreed|approved|switched|migrated|moved|replaced|disabled|enabled|deprecated|retired|rolled back|reverted|promoted|pinned|locked)\b/i,
      /\b(the plan is|design direction|approach is|strategy is|going forward|from now on|as of \d)\b/i,
    ],
  },
  {
    category: "lesson",
    patterns: [
      /\b(bug|fix|issue|error|failure|timeout|crash|regression|root cause|workaround|solution|discovered|found that|turns out|the cause|broke|broken)\b/i,
      /\b(lesson|learned|note:|warning:|caveat:|gotcha:|important:|key insight)\b/i,
    ],
  },
  {
    category: "preference",
    patterns: [
      /\b(prefers?|likes?|wants?|dislikes?|avoids?|style|tone|format|always|never|typically|usually|habitually)\b/i,
    ],
  },
  {
    // task_progress must come before "project" — overlapping keywords, but intent differs
    category: "task_progress",
    patterns: [
      /\b(checkpoint|in[_\s-]?progress|wip|next action|next step|remaining work|still open|pending|blocked on|currently working on)\b/i,
      /\b(completed so far|steps left|work left|open items|what.{0,20}left|what.{0,20}remain)\b/i,
    ],
  },
  {
    category: "project",
    patterns: [
      /\b(flipsuite|forge|engram|agent[-_]?coord|heartbeat|compaction|prompt[-_]?profile|autopilot|canary|phase \d|task \d|operation |roadmap|milestone|sprint|epic)\b/i,
    ],
  },
];

// ============================================================================
// v9: Category-aware half-lives (days) and importance heuristics
// ============================================================================

const CATEGORY_HALF_LIVES: Record<MemoryCategory | "default", number> = {
  infrastructure: 7,
  preference: 30,
  person: 1825,       // 5 years - nearly permanent
  state: 1,
  credential: 14,
  relationship: 90,
  lesson: 180,
  decision: 365,
  project: 60,
  task_progress: 4,   // 4-day half-life — in-progress notes decay fast by design
  default: 30,
};

const CATEGORY_IMPORTANCE: Record<MemoryCategory | "default", number> = {
  credential: 0.95,
  infrastructure: 0.9,
  decision: 0.85,
  lesson: 0.8,
  project: 0.75,
  person: 0.7,
  relationship: 0.7,
  state: 0.6,
  preference: 0.6,
  task_progress: 0.5, // low importance — ephemeral, meant to decay
  default: 0.65,
};

/**
 * Compute decay lambda for a given category.
 * lambda = ln(2) / half_life_days
 */
function categoryLambda(category: MemoryCategory | string): number {
  const halfLife = CATEGORY_HALF_LIVES[category as MemoryCategory] ?? CATEGORY_HALF_LIVES.default;
  return Math.LN2 / halfLife;
}

/**
 * v9: Composite scoring for recall ranking.
 * Combines relevance (vector similarity), recency (category-aware decay),
 * importance (heuristic per category), and confirmation count.
 *
 * All inputs should be in [0, 1].
 */
function compositeScore(
  relevance: number,
  recency: number,
  importance: number,
  confirmationScore: number
): number {
  return 0.35 * relevance + 0.25 * recency + 0.25 * importance + 0.15 * confirmationScore;
}

function classifyMemory(text: string): { category: MemoryCategory; confidence: number } {
  if (!text) return { category: "lesson", confidence: 0.3 };

  // Try each category in priority order
  for (const { category, patterns } of CATEGORY_RULES) {
    const matched = patterns.filter(p => p.test(text)).length;
    if (matched >= 2) return { category, confidence: 0.85 };
    if (matched === 1) {
      // Single match - check confidence boosters
      const hasSpecifics = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|:\d{4,5}|v\d+\.\d+|commit [0-9a-f]{7}|\/(root|home|workspace)\//i.test(text);
      return { category, confidence: hasSpecifics ? 0.75 : 0.6 };
    }
  }

  // Default: lesson with low confidence
  return { category: "lesson", confidence: 0.4 };
}

// ============================================================================
// v4: Direct Qdrant payload update helper
// ============================================================================

const QDRANT_HOST = process.env.QDRANT_HOST || "qdrant";
const QDRANT_PORT = parseInt(process.env.QDRANT_PORT || "6333", 10);
const QDRANT_COLLECTION = process.env.MEM0_QDRANT_COLLECTION || "memories";

async function qdrantSetPayload(pointId: string, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ payload, points: [pointId] });
  const { default: http } = await import("http");
  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        hostname: QDRANT_HOST,
        port: QDRANT_PORT,
        path: `/collections/${QDRANT_COLLECTION}/points/payload`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 400) resolve();
        else reject(new Error(`Qdrant payload update failed: ${res.statusCode}`));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function qdrantIncrementRecall(pointId: string, currentCount: number): Promise<void> {
  await qdrantSetPayload(pointId, {
    last_recalled: new Date().toISOString(),
    recall_count: currentCount + 1,
  });
}

// ============================================================================
// v7: Session recalled memory map for quality tracking
// ============================================================================
// Hard cap: prevents unbounded growth when agent_end never fires (crash/timeout/SIGUSR1).
// Map insertion order is preserved in JS, so eviction removes the oldest entry.
const MAX_RECALLED_MAP_SIZE = 500;
const recalledSessionMemories = new Map<string, Array<{ id: string; text: string }>>();

// ============================================================================
// Core helpers (init, SQLite safety, etc.)
// ============================================================================
let memory: any = null;
let initPromise: Promise<void> | null = null;
let currentSessionId: string | undefined;
let disabledDueToError = false;

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // best-effort
  }
}

function resolveDbPath(
  configVal: string | undefined,
  envKey: string,
  fallback: string
): string {
  return process.env[envKey] || configVal || fallback;
}

function isSqliteError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("SQLITE_CANTOPEN") ||
    msg.includes("SQLITE_IOERR") ||
    msg.includes("SQLITE_READONLY") ||
    msg.includes("unable to open database file") ||
    msg.includes("attempt to write a readonly database") ||
    msg.includes("readonly database")
  );
}

async function initMemory(
  cfg: SidecarConfig,
  logger: any,
  historyPath: string
): Promise<any> {
  const { Memory } = await import("mem0ai/oss");
  const config: Record<string, unknown> = {
    version: "v1.1",
    historyDbPath: historyPath,
    historyStore: {
      provider: "sqlite",
      config: { historyDbPath: historyPath },
    },
    // Mem0's internal history table is redundant for this sidecar and has
    // caused readonly SQLite failures in production despite the primary
    // history DB itself being writable. We rely on Qdrant payload metadata,
    // capture logs, and explicit mem0 state instead.
    disableHistory: true,
    // Inject quality-focused extraction prompt
    customPrompt: cfg.customInstructions || CAPTURE_INSTRUCTIONS,
  };
  if (cfg.embedder) config.embedder = cfg.embedder;
  if (cfg.vectorStore) config.vectorStore = cfg.vectorStore;
  if (cfg.llm) config.llm = cfg.llm;

  ensureDir(historyPath);
  return new Memory(config);
}

async function ensureMemory(cfg: SidecarConfig, logger: any): Promise<any> {
  if (disabledDueToError) throw new Error("Mem0 disabled due to init error");
  if (memory) return memory;
  if (initPromise) {
    await initPromise;
    if (!memory) throw new Error("Mem0 init failed");
    return memory;
  }

  const historyPath = resolveDbPath(
    cfg.historyDbPath,
    "MEM0_HISTORY_DB_PATH",
    "/tmp/mem0_history.sqlite"
  );

  initPromise = (async () => {
    // Attempt 1: configured paths
    try {
      memory = await initMemory(cfg, logger, historyPath);
      await memory.getAll({ userId: "__probe__", limit: 1 });
      logger.info(
        `mem0-sidecar: initialized successfully (historyDbPath=${historyPath})`
      );
      return;
    } catch (err) {
      if (!isSqliteError(err)) {
        if (memory) {
          logger.info(
            `mem0-sidecar: initialized (historyDbPath=${historyPath}, probe warning: ${String(err).substring(0, 100)})`
          );
          return;
        }
        logger.error(
          `mem0-sidecar: init failed (non-SQLite): ${String(err)}`
        );
        disabledDueToError = true;
        memory = null;
        return;
      }
      logger.warn(
        `mem0-sidecar: SQLite error on first attempt, retrying with /tmp fallback: ${String(err)}`
      );
      memory = null;
    }

    // Attempt 2: /tmp fallback
    const fallbackHistory = "/tmp/mem0_history.sqlite";
    try {
      memory = await initMemory(cfg, logger, fallbackHistory);
      await memory.getAll({ userId: "__probe__", limit: 1 });
      logger.info(
        `mem0-sidecar: initialized with fallback (historyDbPath=${fallbackHistory})`
      );
    } catch (err2) {
      logger.error(
        `mem0-sidecar: failed to initialize even with fallback paths: ${String(err2)}`
      );
      disabledDueToError = true;
      memory = null;
    }
  })();

  await initPromise;
  if (!memory) throw new Error("Mem0 init failed");
  return memory;
}

// Install a global guard so Mem0's async SQLite errors don't crash the gateway
function installUncaughtGuard(logger: any): void {
  process.prependListener("uncaughtException", (err: Error) => {
    if (isSqliteError(err)) {
      logger.error(
        `mem0-sidecar: caught uncaught SQLite error (suppressed crash): ${err.message}`
      );
      disabledDueToError = true;
      memory = null;
    }
  });
}

// ============================================================================
// Retry helper for transient embedding failures
// ============================================================================
async function withEmbedRetry<T>(
  fn: () => Promise<T>,
  logger: any,
  maxRetries: number = 2
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err);
      const isTransient = msg.includes("context length") || msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET") || msg.includes("socket hang up") || msg.includes("429") || msg.includes("503");
      if (attempt < maxRetries && isTransient) {
        logger.warn(
          `mem0-sidecar: embed transient failure (attempt ${attempt + 1}/${maxRetries + 1}), retrying in 300ms`
        );
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

// ============================================================================
// Message extraction helpers
// ============================================================================
function stripTransportMetadataBlocks(text: string): string {
  return text
    .replace(/(?:^|\n)Conversation info \(untrusted metadata\):\s*```json\n[\s\S]*?\n```\s*/g, "\n")
    .replace(/(?:^|\n)Sender \(untrusted metadata\):\s*```json\n[\s\S]*?\n```\s*/g, "\n")
    .replace(/(?:^|\n)Replied message \(untrusted, for context\):\s*```json\n[\s\S]*?\n```\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTextFromMessage(msg: any): string {
  if (!msg || typeof msg !== "object") return "";
  let text = "";
  if (typeof msg.content === "string") {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block?.text && typeof block.text === "string") {
        text += (text ? "\n" : "") + block.text;
      }
    }
  }
  // Strip injected recall blocks and transport metadata wrappers.
  text = text
    .replace(/<mem0-recall>[\s\S]*?<\/mem0-recall>\s*/g, "")
    .replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, "");
  text = stripTransportMetadataBlocks(text);
  return text;
}

function selectMessagesForCapture(
  rawMessages: any[]
): Array<{ role: string; content: string }> {
  const formatted: Array<{ role: string; content: string }> = [];

  // Take last 20 messages but only keep user + assistant (skip tool calls/results)
  const recent = rawMessages.slice(-20);
  for (const msg of recent) {
    const role = msg?.role;
    if (role !== "user" && role !== "assistant") continue;

    const text = extractTextFromMessage(msg);
    if (!text) continue;
    // Skip very short noise
    if (text.length < 10 && isNoiseMessage(text)) continue;

    formatted.push({ role, content: text });
  }

  return formatted;
}

// ============================================================================
// v9: Recall scoring helper - processes a pool of raw search results into
// scored entries with composite scoring, invalid_at filtering, and hard exclusion.
// Shared across all three recall pools (long-term, session, shared).
// ============================================================================
function scoreRecallPool(
  rawResults: any[],
  threshold: number,
  ttlHardExcludeDays: number,
  ttlHardExcludeMinScore: number,
  logger: any
): { scored: Array<{ entry: any; compositeScore: number }>; hardExcluded: number; invalidated: number } {
  const scored: Array<{ entry: any; compositeScore: number }> = [];
  let hardExcluded = 0;
  let invalidated = 0;

  for (const r of rawResults) {
    try {
      // v9: Filter out invalidated memories (superseded by contradiction sweep)
      const invalidAt = r.payload?.invalid_at ?? r.metadata?.invalid_at ?? null;
      if (invalidAt) {
        invalidated++;
        continue;
      }

      const rawScore = r.score ?? 1;
      if (rawScore < threshold) continue;

      const capturedAt = r.metadata?.captured_at ?? r.payload?.valid_at ?? r.createdAt ?? null;
      const ageDays = computeAgeDays(capturedAt);

      // Hard exclude: old AND low-scoring
      if (ageDays > ttlHardExcludeDays && rawScore < ttlHardExcludeMinScore) {
        hardExcluded++;
        logger.info(
          `mem0-sidecar: hard-excluded memory id=${r.id} (age=${ageDays.toFixed(0)}d, rawScore=${rawScore.toFixed(3)})`
        );
        continue;
      }

      // v9: Composite scoring
      const category = (r.payload?.category ?? "lesson") as MemoryCategory;
      const lambda = categoryLambda(category);
      const recency = Math.exp(-lambda * ageDays);
      const importance = r.payload?.importance ?? CATEGORY_IMPORTANCE[category] ?? CATEGORY_IMPORTANCE.default;
      const confirmations = Math.min(1.0, (r.payload?.confirmations ?? 1) / 3);
      const score = compositeScore(rawScore, recency, importance, confirmations);

      scored.push({ entry: r, compositeScore: score });
    } catch (e) {
      logger.warn(`mem0-sidecar: skipping malformed recall entry: ${String(e)}`);
    }
  }

  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  return { scored, hardExcluded, invalidated };
}

// ============================================================================
// v8/v9: Inbound contradiction sweep (v9: invalidate instead of delete)
// ============================================================================

async function runContradictionSweep(
  newText: string,
  userId: string,
  mem: any,
  threshold: number,
  logger: any
): Promise<number> {
  try {
    const results = await mem.search(newText, { userId, limit: 5 });
    const candidates = results?.results ?? results?.memories ?? [];
    let invalidatedCount = 0;

    for (const result of candidates) {
      try {
        if ((result.score ?? 0) < threshold) continue;
        if (!result.id) continue;
        if (result.memory === newText) continue;

        // Skip already-invalidated memories
        const existingInvalidAt = result.payload?.invalid_at ?? result.metadata?.invalid_at ?? null;
        if (existingInvalidAt) continue;

        const prompt = [
          `TASK: Detect contradictions between two memory entries.`,
          `A contradiction means the same fact is stated with different values.`,
          ``,
          `Memory 1: ${newText}`,
          `Memory 2: ${result.memory}`,
          ``,
          `Examples of contradictions:`,
          `- "port is 8080" vs "port is 9000" -> YES`,
          `- "server is down" vs "server is running" -> YES`,
          `- "uses Python" vs "uses JavaScript" -> YES`,
          ``,
          `Examples of non-contradictions:`,
          `- "uses Python" vs "runs on Linux" -> NO`,
          `- "port is 8080" vs "port 8080 is open" -> NO`,
          ``,
          `Do Memory 1 and Memory 2 contradict each other? Answer YES or NO only.`,
        ].join("\n");
        const ollamaBody = JSON.stringify({ model: "qwen2.5:7b", prompt, stream: false });

        const ollamaCall = new Promise<any>((resolve, reject) => {
          import("http").then(({ default: http }) => {
            const req = http.request(
              {
                hostname: "127.0.0.1",
                port: 11434,
                path: "/api/generate",
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(ollamaBody) },
              },
              (res) => {
                let body = "";
                res.on("data", (d: Buffer) => { body += d.toString(); });
                res.on("end", () => {
                  try { resolve(JSON.parse(body)); } catch { resolve(null); }
                });
              }
            );
            req.on("error", () => resolve(null));
            req.write(ollamaBody);
            req.end();
          }).catch(() => resolve(null));
        });

        const response = await Promise.race([
          ollamaCall,
          new Promise<null>(r => setTimeout(() => r(null), 3000)),
        ]);

        if (!response || !response.response) continue;

        const answer = response.response.trim().toUpperCase();
        if (answer.startsWith("YES")) {
          // v9: Invalidate instead of delete - preserves audit trail
          await qdrantSetPayload(result.id, {
            invalid_at: new Date().toISOString(),
            invalidated_by: newText.substring(0, 200),
          });
          logger.info(
            `mem0-sidecar: contradiction sweep - invalidated id=${result.id} (similarity=${result.score.toFixed(3)}) contradicts new fact`
          );
          invalidatedCount++;
        }
      } catch {
        // Per-candidate failure: skip silently
      }
    }

    return invalidatedCount;
  } catch (err) {
    logger.warn(`mem0-sidecar: contradiction sweep failed (non-fatal): ${String(err)}`);
    return 0;
  }
}

// ============================================================================
// Plugin definition
// ============================================================================
const plugin: OpenClawPlugin = {
  id: "mem0-sidecar",
  name: "Mem0 Sidecar",
  description:
    "Auto-capture and auto-recall via Mem0 OSS alongside built-in memory",

  register(api) {
    // Kill switch
    const envDisable = process.env.MEM0_DISABLE;
    if (envDisable === "true" || envDisable === "1") {
      api.logger.warn(
        "mem0-sidecar: DISABLED via MEM0_DISABLE env var. No tools or hooks registered."
      );
      return;
    }

    const cfg: SidecarConfig = (api.pluginConfig ?? {}) as SidecarConfig;
    const configuredUserId = process.env.MEM0_USER_ID || cfg.userId || "default";
    const sharedUserId = process.env.MEM0_SHARED_USER_ID || "shared";
    const topK = cfg.topK ?? 3;
    const threshold = cfg.searchThreshold ?? 0.3;
    const dedupThreshold = cfg.dedupThreshold ?? 0.92;
    const minCaptureChars = cfg.minCaptureChars ?? 100;
    const captureLogPath =
      cfg.captureLogPath || "/tmp/mem0-capture.log";
    const configuredHistoryPath = resolveDbPath(
      cfg.historyDbPath,
      "MEM0_HISTORY_DB_PATH",
      "/tmp/mem0_history.sqlite"
    );

    // v3 config (ttlDecayLambda kept as legacy fallback, now category-aware)
    const ttlDecayLambda = cfg.ttlDecayLambda ?? 0.01;
    const ttlHardExcludeDays = cfg.ttlHardExcludeDays ?? 90;
    const ttlHardExcludeMinScore = cfg.ttlHardExcludeMinScore ?? 0.7;
    const minInferChars = cfg.minInferChars ?? 150;

    // v8 config
    const contradictionSweep = (cfg as any).contradictionSweep ?? true;
    const contradictionSweepThreshold = (cfg as any).contradictionSweepThreshold ?? 0.80;

    api.logger.info(
      `mem0-sidecar v9: startup config (historyDbPath=${configuredHistoryPath}, captureLogPath=${captureLogPath}, configuredUserId=${configuredUserId}, minInferChars=${minInferChars}, compositeScoring=true, categoryDecay=true)`
    );

    // Install safety net for async SQLite errors
    installUncaughtGuard(api.logger);

    // ====================================================================
    // Tool: mem0_store
    // ====================================================================
    api.registerTool(
      {
        name: "mem0_store",
        description:
          "Manually store a fact or memory in Mem0's long-term vector store. " +
          "Use for important facts, preferences, or decisions worth remembering across sessions.",
        parameters: {
          type: "object" as const,
          properties: {
            content: {
              type: "string",
              description: "The fact or memory to store",
            },
          },
          required: ["content"],
        },
        async execute(toolCallId: string, args: { content: string }, signal?: AbortSignal, onUpdate?: any) {
          if (disabledDueToError) {
            return {
              content:
                "Mem0 is currently disabled due to an initialization error. Check logs.",
              isError: true,
            };
          }
          try {
            let content = (args.content ?? "").trim();
            if (!content) {
              return {
                content: "Cannot store an empty memory.",
                isError: true,
              };
            }

            const manualReject = shouldRejectMemoryText(content);
            if (manualReject.reject) {
              return {
                content: `Refusing to store memory: ${manualReject.reason}.`,
                isError: true,
              };
            }

            const mem = await ensureMemory(cfg, api.logger);
            const result = await mem.add(
              [{ role: "user", content }],
              {
                userId: configuredUserId,
                infer: false,
                metadata: {
                  captured_at: new Date().toISOString(),
                  source_session: "manual",
                },
              }
            );

            let count = 0;
            const rawResults = result?.results ?? [];
            for (const entry of rawResults) {
              try {
                if (safeMemoryText(entry) !== null) count++;
              } catch (e) {
                api.logger.warn(`mem0-sidecar: skipping malformed result entry in manual_store: ${String(e)}`);
              }
            }

            if (count === 0) {
              api.logger.warn(
                "mem0-sidecar: manual_store produced 0 items for non-empty input"
              );
              logCapture(captureLogPath, {
                action: "manual_store_zero",
                userId: configuredUserId,
                count,
                details: content.substring(0, 200),
              });
              return {
                content:
                  "Mem0 accepted the request but returned 0 stored items for non-empty content. Check mem0-sidecar logs.",
                isError: true,
              };
            }

            // v4/v9: Classify manually stored memories + enrich with v9 metadata
            for (const entry of rawResults) {
              try {
                const memText = safeMemoryText(entry);
                if (memText && entry.id) {
                  const { category, confidence } = classifyMemory(memText);
                  const importance = CATEGORY_IMPORTANCE[category] ?? CATEGORY_IMPORTANCE.default;
                  qdrantSetPayload(entry.id, {
                    category,
                    confidence,
                    importance,
                    confirmations: 1,
                    valid_at: new Date().toISOString(),
                  }).catch(() => {/* best-effort */});
                }
              } catch {/* best-effort */}
            }

            logCapture(captureLogPath, {
              action: "manual_store",
              userId: configuredUserId,
              count,
              details: content.substring(0, 200),
            });
            return {
              content: `Stored ${count} memory item(s) successfully.`,
            };
          } catch (err) {
            return {
              content: `Failed to store memory: ${String(err)}`,
              isError: true,
            };
          }
        },
      },
      { name: "mem0_store" }
    );

    // ====================================================================
    // Tool: mem0_store_shared (v5)
    // ====================================================================
    api.registerTool(
      {
        name: "mem0_store_shared",
        description:
          "Store a fact in the shared cross-agent memory namespace. " +
          "Use for infrastructure facts that all agents need (server IPs, ports, credentials, service configs). " +
          "These memories are recalled by all agents automatically.",
        parameters: {
          type: "object" as const,
          properties: {
            content: {
              type: "string",
              description: "The infrastructure fact or shared memory to store",
            },
          },
          required: ["content"],
        },
        async execute(toolCallId: string, args: { content: string }, signal?: AbortSignal, onUpdate?: any) {
          if (disabledDueToError) {
            return { content: "Mem0 is currently disabled due to an initialization error.", isError: true };
          }
          try {
            const content = (args.content ?? "").trim();
            if (!content) return { content: "Cannot store an empty memory.", isError: true };

            const manualReject = shouldRejectMemoryText(content);
            if (manualReject.reject) {
              return { content: `Refusing to store shared memory: ${manualReject.reason}.`, isError: true };
            }

            const mem = await ensureMemory(cfg, api.logger);
            const result = await mem.add(
              [{ role: "user", content }],
              {
                userId: sharedUserId,
                infer: false,
                metadata: {
                  captured_at: new Date().toISOString(),
                  source_agent: configuredUserId,
                  source_session: "manual",
                  category: "infrastructure",
                },
              }
            );

            const rawResults = result?.results ?? [];
            let count = 0;
            for (const entry of rawResults) {
              try {
                if (safeMemoryText(entry) !== null) {
                  count++;
                  // v9: enrich shared memories with metadata
                  if (entry.id) {
                    qdrantSetPayload(entry.id, {
                      category: "infrastructure",
                      importance: CATEGORY_IMPORTANCE.infrastructure,
                      confirmations: 1,
                      valid_at: new Date().toISOString(),
                    }).catch(() => {/* best-effort */});
                  }
                }
              } catch { /* skip */ }
            }

            logCapture(captureLogPath, { action: "manual_store_shared", userId: sharedUserId, count, details: content.substring(0, 200) });
            return { content: `Stored ${count} shared memory item(s) under namespace '${sharedUserId}'.` };
          } catch (err) {
            return { content: `Failed to store shared memory: ${String(err)}`, isError: true };
          }
        },
      },
      { name: "mem0_store_shared" }
    );

    // ====================================================================
    // Tool: mem0_forget
    // ====================================================================
    api.registerTool(
      {
        name: "mem0_forget",
        description:
          "Delete a specific memory from Mem0 by its ID. Use when a stored fact is wrong or outdated.",
        parameters: {
          type: "object" as const,
          properties: {
            memoryId: {
              type: "string",
              description: "The ID of the memory to delete",
            },
          },
          required: ["memoryId"],
        },
        async execute(toolCallId: string, args: { memoryId: string }, signal?: AbortSignal, onUpdate?: any) {
          if (disabledDueToError) {
            return {
              content:
                "Mem0 is currently disabled due to an initialization error.",
              isError: true,
            };
          }
          try {
            const mem = await ensureMemory(cfg, api.logger);
            await mem.delete(args.memoryId);
            logCapture(captureLogPath, {
              action: "manual_delete",
              userId: configuredUserId,
              details: args.memoryId,
            });
            return { content: `Memory ${args.memoryId} deleted.` };
          } catch (err) {
            return {
              content: `Failed to delete memory: ${String(err)}`,
              isError: true,
            };
          }
        },
      },
      { name: "mem0_forget" }
    );

    // ====================================================================
    // Tool: mem0_list
    // ====================================================================
    api.registerTool(
      {
        name: "mem0_list",
        description:
          "List stored memories from Mem0. Returns recent memories for the current user. " +
          "Use to audit what Mem0 has captured or to find memory IDs for deletion.",
        parameters: {
          type: "object" as const,
          properties: {
            limit: {
              type: "number",
              description:
                "Max number of memories to return (default 20)",
            },
          },
        },
        async execute(toolCallId: string, args: { limit?: number }, signal?: AbortSignal, onUpdate?: any) {
          if (disabledDueToError) {
            return {
              content:
                "Mem0 is currently disabled due to an initialization error.",
              isError: true,
            };
          }
          try {
            const mem = await ensureMemory(cfg, api.logger);
            const limit = args.limit ?? 20;
            const results = await mem.getAll({ userId: configuredUserId });
            const rawItems = results?.results ?? results?.memories ?? [];
            const items: any[] = [];
            for (const entry of rawItems) {
              try {
                const text = safeMemoryText(entry);
                if (text !== null) items.push(entry);
              } catch (e) {
                api.logger.warn(`mem0-sidecar: skipping malformed entry in mem0_list: ${String(e)}`);
              }
            }
            const limited = items.slice(0, limit);
            if (limited.length === 0) {
              return { content: "No memories stored yet." };
            }
            const formatted = limited
              .map(
                (m: any, i: number) =>
                  `${i + 1}. [${m.id}] ${m.memory ?? m.content ?? "(empty)"}`
              )
              .join("\n");
            return {
              content: `Found ${limited.length} memories:\n${formatted}`,
            };
          } catch (err) {
            return {
              content: `Failed to list memories: ${String(err)}`,
              isError: true,
            };
          }
        },
      },
      { name: "mem0_list" }
    );

    // ====================================================================
    // ====================================================================
    // v9: Discord session log fallback search
    // Searches JSONL session files for relevant snippets when Qdrant is sparse.
    // Covers DM history (session files are in-container, no DB mount needed).
    // ====================================================================
    async function searchSessionLogs(query: string, limit: number): Promise<string[]> {
      const { readdir, readFile } = await import("fs/promises");
      const { createReadStream } = await import("fs");
      const { createInterface } = await import("readline");
      const path = await import("path");

      const sessionsDir = "/home/clawdbot/.openclaw/agents/main/sessions";
      const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3).slice(0, 8);
      if (queryTerms.length === 0) return [];

      let files: string[];
      try {
        files = (await readdir(sessionsDir)).filter(f => f.endsWith(".jsonl"));
      } catch {
        return [];
      }

      const snippets: Array<{ score: number; text: string }> = [];
      const MAX_FILES = 30; // Scan most-recent files only
      const recentFiles = files.slice(-MAX_FILES);

      for (const file of recentFiles) {
        const filePath = path.join(sessionsDir, file);
        try {
          const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
          for await (const line of rl) {
            if (!line.trim()) continue;
            let obj: any;
            try { obj = JSON.parse(line); } catch { continue; }
            if (obj.type !== "message") continue;
            const role = obj.message?.role;
            if (role !== "user" && role !== "assistant") continue;
            const parts = obj.message?.content ?? [];
            const text = parts
              .filter((p: any) => p?.type === "text")
              .map((p: any) => p.text ?? "")
              .join(" ")
              .trim();
            if (!text || text.length < 20) continue;
            const lower = text.toLowerCase();
            const hits = queryTerms.filter(t => lower.includes(t)).length;
            if (hits >= 2) {
              const excerpt = text.slice(0, 200).replace(/\n+/g, " ");
              snippets.push({ score: hits, text: `[${role}] ${excerpt}` });
            }
          }
        } catch { continue; }
      }

      snippets.sort((a, b) => b.score - a.score);
      return snippets.slice(0, limit).map(s => s.text);
    }

    // Search discrawl SQLite FTS5 for server channel history
    function searchDiscrawlFTS(query: string, limit: number): string[] {
      const DISCRAWL_DB = "/discrawl/discrawl.db";
      try {
        const { existsSync } = require("fs") as typeof import("fs");
        if (!existsSync(DISCRAWL_DB)) return [];
        const { execSync } = require("child_process") as typeof import("child_process");
        // Sanitize query: keep alphanumeric + spaces only, split to terms
        const terms = query.replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(t => t.length > 3).slice(0, 6);
        if (terms.length === 0) return [];
        const ftsQuery = terms.join(" OR ");
        const sql = `SELECT channel_name, author_name, substr(content,1,180) FROM message_fts WHERE message_fts MATCH ${JSON.stringify(ftsQuery)} ORDER BY rank LIMIT ${limit};`;
        // Use immutable URI mode so SQLite never attempts WAL/journal/lock writes on the mounted discrawl DB.
        const dbUri = `file:${DISCRAWL_DB}?immutable=1`;
        const raw = execSync(`sqlite3 -readonly ${JSON.stringify(dbUri)} ${JSON.stringify(sql)}`, { timeout: 3000, encoding: "utf8" });
        return raw.trim().split("\n").filter(Boolean).map(row => {
          const [ch, author, content] = row.split("|");
          return `[#${ch}] ${author}: ${content}`;
        });
      } catch {
        return [];
      }
    }

    // Hook: Auto-Recall (before_agent_start) - v9 with composite scoring
    // ====================================================================
    if (cfg.autoRecall !== false) {
      api.on("before_agent_start", async (event: any, ctx: any) => {
        if (disabledDueToError) return;
        if (!event.prompt || event.prompt.length < 5) return;

        api.logger.info(
          `mem0-sidecar: search query length=${event.prompt.length} chars`
        );
        // Truncate prompt to avoid exceeding embedding model context length
        const MAX_SEARCH_CHARS = 2000;
        const searchQuery =
          event.prompt.length > MAX_SEARCH_CHARS
            ? event.prompt.slice(0, MAX_SEARCH_CHARS)
            : event.prompt;

        const sessionId = ctx?.sessionKey ?? undefined;
        if (sessionId) currentSessionId = sessionId;

        // Skip heartbeat lane entirely
        if (sessionId && /:heartbeat(?:$|:)/i.test(sessionId)) {
          api.logger.info("mem0-sidecar: skipping capture - heartbeat session");
          return;
        }

        try {
          const mem = await ensureMemory(cfg, api.logger);
          const namespace = resolveUserNamespace(configuredUserId, ctx, event);
          const effectiveUserId = namespace.userId;

          if (namespace.source !== "config.userId") {
            api.logger.info(
              `mem0-sidecar: recall namespace resolved from ${namespace.source} -> ${effectiveUserId}`
            );
          }

          const searchOpts: Record<string, unknown> = {
            userId: effectiveUserId,
            limit: topK,
          };

          const results = await withEmbedRetry(
            () => mem.search(searchQuery, searchOpts),
            api.logger
          );

          // v7: Compute category affinity once for this query
          const affinity = inferQueryCategoryAffinity(searchQuery);
          if (Object.keys(affinity).length > 0) {
            api.logger.info(`mem0-sidecar: category affinity boost applied: ${JSON.stringify(affinity)}`);
          }

          // v9: Score the long-term recall pool with composite scoring + invalid_at filter
          const rawMemories = results?.results ?? results?.memories ?? [];
          const longTermResult = scoreRecallPool(rawMemories, threshold, ttlHardExcludeDays, ttlHardExcludeMinScore, api.logger);
          let memories = longTermResult.scored;
          let totalHardExcluded = longTermResult.hardExcluded;
          let totalInvalidated = longTermResult.invalidated;

          // v7: Apply category affinity boost
          if (Object.keys(affinity).length > 0) {
            for (const m of memories) {
              const cat = m.entry?.payload?.category as MemoryCategory | undefined;
              const boost = cat ? (affinity[cat] ?? 1.0) : 1.0;
              m.compositeScore = Math.min(1.0, m.compositeScore * boost);
            }
            memories.sort((a, b) => b.compositeScore - a.compositeScore);
          }

          if (totalHardExcluded > 0) {
            api.logger.info(`mem0-sidecar: hard-excluded ${totalHardExcluded} stale memories from recall`);
          }
          if (totalInvalidated > 0) {
            api.logger.info(`mem0-sidecar: filtered ${totalInvalidated} invalidated memories from recall`);
          }

          // Session-scoped search
          let sessionMemories: Array<{ entry: any; compositeScore: number }> = [];
          if (currentSessionId) {
            try {
              const sessionResults = await withEmbedRetry(
                () =>
                  mem.search(searchQuery, {
                    userId: effectiveUserId,
                    runId: currentSessionId,
                    limit: topK,
                  }),
                api.logger
              );
              const existingIds = new Set(memories.map((m) => m.entry.id));
              const rawSessionMemories = sessionResults?.results ?? sessionResults?.memories ?? [];
              // Filter out already-seen IDs before scoring
              const filteredSession = rawSessionMemories.filter((r: any) => !existingIds.has(r.id));
              const sessionResult = scoreRecallPool(filteredSession, threshold, ttlHardExcludeDays, ttlHardExcludeMinScore, api.logger);
              sessionMemories = sessionResult.scored;

              // Apply category affinity boost
              if (Object.keys(affinity).length > 0) {
                for (const m of sessionMemories) {
                  const cat = m.entry?.payload?.category as MemoryCategory | undefined;
                  const boost = cat ? (affinity[cat] ?? 1.0) : 1.0;
                  m.compositeScore = Math.min(1.0, m.compositeScore * boost);
                }
                sessionMemories.sort((a, b) => b.compositeScore - a.compositeScore);
              }
            } catch {
              // Session search may not be supported
            }
          }

          // v5: Dual-recall - also search shared namespace
          let sharedMemories: Array<{ entry: any; compositeScore: number }> = [];
          try {
            const sharedResults = await withEmbedRetry(
              () => mem.search(searchQuery, { userId: sharedUserId, limit: topK }),
              api.logger
            );
            const existingIds = new Set([...memories, ...sessionMemories].map(m => m.entry.id));
            const rawShared = sharedResults?.results ?? sharedResults?.memories ?? [];
            const filteredShared = rawShared.filter((r: any) => !existingIds.has(r.id));
            const sharedResult = scoreRecallPool(filteredShared, threshold, ttlHardExcludeDays, ttlHardExcludeMinScore, api.logger);
            sharedMemories = sharedResult.scored;

            // Apply category affinity boost
            if (Object.keys(affinity).length > 0) {
              for (const m of sharedMemories) {
                const cat = m.entry?.payload?.category as MemoryCategory | undefined;
                const boost = cat ? (affinity[cat] ?? 1.0) : 1.0;
                m.compositeScore = Math.min(1.0, m.compositeScore * boost);
              }
              sharedMemories.sort((a, b) => b.compositeScore - a.compositeScore);
            }

            if (sharedMemories.length > 0) {
              api.logger.info(`mem0-sidecar: shared recall found ${sharedMemories.length} entries`);
            }
          } catch (sharedErr) {
            api.logger.warn(`mem0-sidecar: shared recall failed (non-fatal): ${String(sharedErr)}`);
          }

          if (memories.length === 0 && sessionMemories.length === 0 && sharedMemories.length === 0)
            return;

          // v10: Hard cap on total injected memories to prevent context bloat
          const MAX_INJECT_TOTAL = 10;
          const totalAvailable = memories.length + sessionMemories.length + sharedMemories.length;
          if (totalAvailable > MAX_INJECT_TOTAL) {
            // Merge, sort by composite score, take top N, then re-split
            const merged = [
              ...memories.map(m => ({ ...m, pool: "long" as const })),
              ...sessionMemories.map(m => ({ ...m, pool: "session" as const })),
              ...sharedMemories.map(m => ({ ...m, pool: "shared" as const })),
            ].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, MAX_INJECT_TOTAL);

            memories = merged.filter(m => m.pool === "long");
            sessionMemories = merged.filter(m => m.pool === "session");
            sharedMemories = merged.filter(m => m.pool === "shared");

            api.logger.info(
              `mem0-sidecar: capped injection from ${totalAvailable} to ${MAX_INJECT_TOTAL} (${memories.length} long, ${sessionMemories.length} session, ${sharedMemories.length} shared)`
            );
          }

          // v4: Update recall metadata (fire-and-forget, non-blocking)
          const allRecalled = [...memories, ...sessionMemories];
          for (const m of allRecalled) {
            try {
              const currentCount = m.entry?.payload?.recall_count ?? m.entry?.recall_count ?? 0;
              qdrantIncrementRecall(m.entry.id, currentCount).catch(() => {/* best-effort */});
            } catch {/* best-effort */}
          }

          // v6: Confidence gate
          const MIN_INJECT_CONFIDENCE = 0.55;
          const passesConfidence = (m: any): boolean => {
            const conf: number | null | undefined =
              m.entry?.payload?.confidence ?? m.entry?.confidence ?? null;
            return conf === null || conf === undefined || conf >= MIN_INJECT_CONFIDENCE;
          };

          const injectLongTerm  = memories.filter(passesConfidence);
          const injectSession   = sessionMemories.filter(passesConfidence);
          const injectShared    = sharedMemories.filter(passesConfidence);
          const gatedOut = allRecalled.length + sharedMemories.length
                         - injectLongTerm.length - injectSession.length - injectShared.length;
          if (gatedOut > 0) {
            api.logger.info(
              `mem0-sidecar: confidence gate withheld ${gatedOut} low-confidence memories (threshold=${MIN_INJECT_CONFIDENCE})`
            );
          }

          // v7: Increment useful_count for every injected memory (fire-and-forget)
          for (const m of [...injectLongTerm, ...injectSession, ...injectShared]) {
            if (m.entry?.id) {
              (async () => {
                try {
                  const pointData = await qdrantGetPoint(m.entry.id);
                  const currentUsefulCount = pointData?.result?.payload?.useful_count ?? 0;
                  await qdrantSetPayload(m.entry.id, { useful_count: currentUsefulCount + 1 });
                } catch { /* best-effort */ }
              })();
            }
          }

          // v7: Store recalled (injected) memories in map
          if (sessionId) {
            const recallEntries: Array<{ id: string; text: string }> = [];
            for (const m of [...injectLongTerm, ...injectSession, ...injectShared]) {
              const text = safeMemoryText(m.entry);
              if (m.entry?.id && text) recallEntries.push({ id: m.entry.id, text });
            }
            if (recallEntries.length > 0) {
              if (recalledSessionMemories.size >= MAX_RECALLED_MAP_SIZE) {
                const oldestKey = recalledSessionMemories.keys().next().value;
                if (oldestKey !== undefined) recalledSessionMemories.delete(oldestKey);
              }
              recalledSessionMemories.set(sessionId, recallEntries);
            }
          }

          // Build injection lines
          const VERIFY_WARN_CONFIDENCE = 0.70;
          const MAX_MEMORY_INJECT_CHARS = 300;
          const buildInjectionLine = (m: any): string => {
            let text = safeMemoryText(m.entry) ?? "";
            if (text.length > MAX_MEMORY_INJECT_CHARS) {
              text = text.substring(0, MAX_MEMORY_INJECT_CHARS) + "...";
            }
            const age  = computeAgeDays(m.entry?.metadata?.captured_at ?? m.entry?.payload?.valid_at ?? m.entry?.createdAt ?? null);
            const conf: number | null | undefined =
              m.entry?.payload?.confidence ?? m.entry?.confidence ?? null;

            const staleSuffix = staleTag(age, text);
            const hasVerifyTag = /\[verify:/i.test(text);
            const lowConf = conf !== null && conf !== undefined && conf < VERIFY_WARN_CONFIDENCE;
            const needsWarn = hasVerifyTag || lowConf;
            const warnSuffix = needsWarn ? " (please verify before taking as fact)" : "";

            return `- ${text}${staleSuffix}${warnSuffix}`;
          };

          let memoryContext = "";
          if (injectLongTerm.length > 0) {
            memoryContext += injectLongTerm.map(buildInjectionLine).join("\n");
          }
          if (injectSession.length > 0) {
            if (memoryContext) memoryContext += "\n";
            memoryContext += "\nSession context:\n";
            memoryContext += injectSession.map(buildInjectionLine).join("\n");
          }
          if (injectShared.length > 0) {
            if (memoryContext) memoryContext += "\n";
            memoryContext += "\nShared infrastructure context:\n";
            memoryContext += injectShared.map(buildInjectionLine).join("\n");
          }

          const total = injectLongTerm.length + injectSession.length + injectShared.length;
          api.logger.info(
            `mem0-sidecar: injecting ${total} recalled memories (${injectLongTerm.length} long-term, ${injectSession.length} session, ${injectShared.length} shared, ${gatedOut} gated)`
          );

          // v9: Discord history fallback - search session JSONL files when Qdrant recall is sparse
          // Triggers when: total recalled < 3 OR query has conversation-history signal
          const DISCORD_FALLBACK_THRESHOLD = 3;
          const DISCORD_QUERY_SIGNAL = /\b(discord|conversation|discussed|we talked|said|mentioned|channel|what did|remember when)\b/i;
          const shouldSearchDiscord = total < DISCORD_FALLBACK_THRESHOLD || DISCORD_QUERY_SIGNAL.test(searchQuery);

          if (shouldSearchDiscord) {
            try {
              const discordSnippets = await searchSessionLogs(searchQuery, 3);
              if (discordSnippets.length > 0) {
                if (memoryContext) memoryContext += "\n";
                memoryContext += "\nSession context:\n";
                memoryContext += discordSnippets.map(s => `- ${s}`).join("\n");
                api.logger.info(`mem0-sidecar: discord session fallback injected ${discordSnippets.length} snippets`);
              }
            } catch (discordErr) {
              api.logger.warn(`mem0-sidecar: discord session fallback failed (non-fatal): ${String(discordErr)}`);
            }
            // Temporarily disable discrawl FTS fallback here.
            // The mounted discrawl SQLite has been the only remaining candidate
            // correlated with readonly churn during recall, and session-log
            // fallback already covers the active conversation lane.
          }

          return {
            prependContext: `<mem0-recall>\nRelevant memories from previous conversations:\n${memoryContext}\n</mem0-recall>`,
          };
        } catch (err) {
          api.logger.warn(
            `mem0-sidecar: recall failed: ${String(err)}`
          );
        }
      });
    }

    // ====================================================================
    // Hook: Auto-Capture (agent_end) - v9 with enriched write-time metadata
    // ====================================================================
    if (cfg.autoCapture !== false) {
      api.on("agent_end", async (event: any, ctx: any) => {
        if (disabledDueToError) return;
        if (
          !event.success ||
          !event.messages ||
          event.messages.length === 0
        ) {
          return;
        }

        const sessionId = ctx?.sessionKey ?? undefined;
        if (sessionId) currentSessionId = sessionId;

        // Skip heartbeat lane entirely
        if (sessionId && /:heartbeat(?:$|:)/i.test(sessionId)) {
          api.logger.info("mem0-sidecar: skipping capture - heartbeat session");
          return;
        }

        const captureNamespace = resolveUserNamespace(configuredUserId, ctx, event);
        const effectiveUserId = captureNamespace.userId;

        if (captureNamespace.source !== "config.userId") {
          api.logger.info(
            `mem0-sidecar: capture namespace resolved from ${captureNamespace.source} -> ${effectiveUserId}`
          );
        }

        try {
          // Step 1: Extract and format messages
          const formatted = selectMessagesForCapture(event.messages);

          // Step 2: Pre-filter
          const filterResult = shouldSkipCapture(formatted, minCaptureChars);
          if (filterResult.skip) {
            api.logger.info(
              `mem0-sidecar: skipping capture - ${filterResult.reason}`
            );
            logCapture(captureLogPath, {
              action: "skip",
              userId: effectiveUserId,
              sessionId,
              reason: filterResult.reason,
            });
            return;
          }

          // v3: Infer gate
          const totalChars = formatted.reduce((sum, m) => sum + m.content.length, 0);
          if (totalChars < minInferChars) {
            api.logger.info(
              `mem0-sidecar: skipping capture - infer gate (${totalChars} chars < ${minInferChars} minInferChars)`
            );
            logCapture(captureLogPath, {
              action: "skip_infer_gate",
              userId: effectiveUserId,
              sessionId,
              reason: `total content ${totalChars} chars < ${minInferChars} minInferChars`,
            });
            return;
          }

          const mem = await ensureMemory(cfg, api.logger);

          // Step 3: Add with quality-focused extraction + source tagging
          const addOpts: Record<string, unknown> = {
            userId: effectiveUserId,
            metadata: {
              captured_at: new Date().toISOString(),
              source_session: sessionId ?? "unknown",
            },
          };
          if (currentSessionId)
            addOpts.runId = currentSessionId;

          const result = await mem.add(formatted, addOpts);

          // v8/v9: Contradiction sweep (invalidation instead of deletion)
          if (contradictionSweep !== false) {
            const extractedTexts: string[] = (result?.results ?? [])
              .map((r: any) => safeMemoryText(r))
              .filter((t: string | null): t is string => t !== null && t.length > 5);

            const messageTexts: string[] = formatted
              .map((m: any) => (m.content ?? "").trim())
              .filter((t: string) => t.length > 10 && t.length < 500);

            const seen = new Set<string>();
            const sweepTargets: string[] = [];
            for (const t of [...extractedTexts, ...messageTexts]) {
              if (!seen.has(t)) { seen.add(t); sweepTargets.push(t); }
            }

            if (sweepTargets.length > 0) {
              let totalInvalidated = 0;
              for (const memText of sweepTargets) {
                totalInvalidated += await runContradictionSweep(
                  memText,
                  effectiveUserId,
                  mem,
                  contradictionSweepThreshold,
                  api.logger
                );
              }
              if (totalInvalidated > 0) {
                api.logger.info(`mem0-sidecar: contradiction sweep invalidated ${totalInvalidated} conflicting memories`);
              }
            }
          }

          const newMemories: any[] = [];
          const rawResults = result?.results ?? [];
          for (const entry of rawResults) {
            try {
              if (safeMemoryText(entry) !== null) {
                newMemories.push(entry);
              }
            } catch (e) {
              api.logger.warn(`mem0-sidecar: skipping malformed result entry in capture: ${String(e)}`);
            }
          }
          const count = newMemories.length;

          if (count > 0) {
            // Step 4: Post-capture dedup check
            let dedupSkipped = 0;
            for (const newMem of newMemories) {
              const memText = safeMemoryText(newMem);
              if (!memText) continue;

              const { category } = classifyMemory(memText);
              const rejectResult = shouldRejectMemoryText(memText, category);
              if (rejectResult.reject) {
                try {
                  await mem.delete(newMem.id);
                  dedupSkipped++;
                  api.logger.info(
                    `mem0-sidecar: removed extracted memory id=${newMem.id} (${rejectResult.reason})`
                  );
                } catch (deleteErr) {
                  api.logger.warn(
                    `mem0-sidecar: failed to remove rejected memory id=${newMem.id}: ${String(deleteErr)}`
                  );
                }
                continue;
              }

              try {
                const similar = await withEmbedRetry(
                  () =>
                    mem.search(memText, {
                      userId: effectiveUserId,
                      limit: 3,
                    }),
                  api.logger
                );
                const rawMatches = similar?.results ?? similar?.memories ?? [];
                const matches: any[] = [];
                for (const r of rawMatches) {
                  try {
                    if (r.id !== newMem.id && (r.score ?? 0) >= dedupThreshold) {
                      matches.push(r);
                    }
                  } catch (e) {
                    api.logger.warn(`mem0-sidecar: skipping malformed dedup entry: ${String(e)}`);
                  }
                }
                if (matches.length > 0) {
                  // Near-duplicate found - remove the new one, keep the old
                  await mem.delete(newMem.id);
                  dedupSkipped++;
                  api.logger.info(
                    `mem0-sidecar: dedup - removed new memory "${memText.substring(0, 80)}" (similar to existing "${(safeMemoryText(matches[0]) ?? "").substring(0, 80)}", score=${matches[0].score?.toFixed(3)})`
                  );
                } else {
                  // v4/v9: Classify and enrich with full metadata
                  try {
                    const { confidence } = classifyMemory(memText);
                    const importance = CATEGORY_IMPORTANCE[category] ?? CATEGORY_IMPORTANCE.default;
                    await qdrantSetPayload(newMem.id, {
                      category,
                      confidence,
                      importance,
                      confirmations: 1,
                      valid_at: new Date().toISOString(),
                    });
                    api.logger.info(
                      `mem0-sidecar: classified memory id=${newMem.id} category=${category} confidence=${confidence.toFixed(2)} importance=${importance}`
                    );
                    // v5: Auto write-routing - infrastructure memories also go to shared namespace
                    if (category === "infrastructure" && confidence >= 0.7) {
                      try {
                        const sharedResult = await mem.add([{ role: "user", content: memText }], {
                          userId: sharedUserId,
                          infer: false,
                          metadata: {
                            captured_at: new Date().toISOString(),
                            source_agent: configuredUserId,
                            source_session: sessionId ?? "unknown",
                          },
                        });
                        // v9: enrich shared copy with metadata too
                        const sharedResults = sharedResult?.results ?? [];
                        for (const sharedEntry of sharedResults) {
                          if (sharedEntry?.id) {
                            qdrantSetPayload(sharedEntry.id, {
                              category: "infrastructure",
                              importance: CATEGORY_IMPORTANCE.infrastructure,
                              confirmations: 1,
                              valid_at: new Date().toISOString(),
                            }).catch(() => {/* best-effort */});
                          }
                        }
                        api.logger.info(
                          `mem0-sidecar: auto-routed infrastructure memory to shared namespace: "${memText.substring(0, 60)}"`
                        );
                      } catch (routeErr) {
                        api.logger.warn(`mem0-sidecar: shared write-routing failed (non-fatal): ${String(routeErr)}`);
                      }
                    }
                  } catch (classErr) {
                    api.logger.warn(`mem0-sidecar: classification failed for id=${newMem.id}: ${String(classErr)}`);
                  }
                }
              } catch {
                // Dedup check failed, keep the memory
              }
            }

            const stored = count - dedupSkipped;
            api.logger.info(
              `mem0-sidecar: auto-captured ${stored} memories (${dedupSkipped} deduped) from conversation`
            );
            logCapture(captureLogPath, {
              action: "capture",
              userId: effectiveUserId,
              sessionId,
              count: stored,
              skipped: dedupSkipped,
              details: newMemories
                .slice(0, 3)
                .map(
                  (m: any) => (safeMemoryText(m) ?? "").substring(0, 100)
                )
                .join(" | "),
            });
          } else {
            api.logger.info(
              `mem0-sidecar: capture extracted 0 memories (LLM found nothing worth storing)`
            );
            logCapture(captureLogPath, {
              action: "capture_empty",
              userId: effectiveUserId,
              sessionId,
              reason:
                "LLM extracted nothing from conversation",
            });
          }
        } catch (err) {
          api.logger.warn(
            `mem0-sidecar: capture failed: ${String(err)}`
          );
          logCapture(captureLogPath, {
            action: "capture_error",
            userId: effectiveUserId,
            sessionId,
            reason: String(err).substring(0, 200),
          });
        }

        // v7: Clean up recalledSessionMemories map entry
        try {
          const sessionKeyForQuality = ctx?.sessionKey ?? undefined;
          if (sessionKeyForQuality) recalledSessionMemories.delete(sessionKeyForQuality);
        } catch { /* best-effort */ }
      });
    }

    api.logger.info(
      `mem0-sidecar v9: registered (configuredUserId=${configuredUserId}, recall=${cfg.autoRecall !== false}, capture=${cfg.autoCapture !== false}, topK=${topK}, dedupThreshold=${dedupThreshold}, ttlHardExcludeDays=${ttlHardExcludeDays}, minInferChars=${minInferChars}, contradictionSweep=${contradictionSweep}, contradictionSweepThreshold=${contradictionSweepThreshold}, compositeScoring=true, categoryDecay=true, invalidationPattern=true, historyDbPath=${configuredHistoryPath}, captureLogPath=${captureLogPath})`
    );
  },
};

export default plugin;
