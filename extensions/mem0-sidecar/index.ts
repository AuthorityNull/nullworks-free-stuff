/**
 * mem0-sidecar v2 - Production-grade memory for OpenClaw agents.
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
}

// ============================================================================
// Capture quality: custom prompt for memory extraction
// ============================================================================
const CAPTURE_INSTRUCTIONS = `You are a memory extraction system for an AI agent. Your job is to identify DURABLE facts worth remembering across sessions.

EXTRACT these types of memories:
- User preferences and communication style
- Decisions made and their rationale
- Infrastructure state changes (server IPs, ports, credentials, service configs)
- Lessons learned from debugging or failures
- Project milestones and status changes
- Information about people (names, roles, relationships)
- Technical configurations that were set up or changed

SKIP these - they are noise, NOT memories:
- Status updates ("system is stable", "heartbeat complete", "working on X")
- Transient tool operations ("module loads cleanly", "command succeeded")
- Routine acknowledgments ("got it", "done", "ok")
- Error messages that were already resolved in the same conversation
- Internal system/cron/automated flow details unless they reveal a permanent change
- Anything that will be false or irrelevant within hours

FORMAT each memory as a single clear factual sentence. Be specific - include names, IPs, paths, versions when available.
BAD: "User configured a server"
GOOD: "Production database uses PostgreSQL 16.2 on port 5432 at db.internal.example.com"

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
    msg.includes("unable to open database file")
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
  // Strip injected recall blocks
  text = text
    .replace(/<mem0-recall>[\s\S]*?<\/mem0-recall>\s*/g, "")
    .replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, "")
    .trim();
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
    const userId = process.env.MEM0_USER_ID || cfg.userId || "default";
    const topK = cfg.topK ?? 3;
    const threshold = cfg.searchThreshold ?? 0.3;
    const dedupThreshold = cfg.dedupThreshold ?? 0.92;
    const minCaptureChars = cfg.minCaptureChars ?? 100;
    const captureLogPath =
      cfg.captureLogPath || "/tmp/mem0-capture.log";

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
        async execute(args: { content: string }) {
          if (disabledDueToError) {
            return {
              content:
                "Mem0 is currently disabled due to an initialization error. Check logs.",
              isError: true,
            };
          }
          try {
            const mem = await ensureMemory(cfg, api.logger);
            const result = await mem.add(
              [{ role: "user", content: args.content }],
              { userId }
            );
            const count = result?.results?.length ?? 0;
            logCapture(captureLogPath, {
              action: "manual_store",
              userId,
              count,
              details: args.content.substring(0, 200),
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
        async execute(args: { memoryId: string }) {
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
              userId,
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
        async execute(args: { limit?: number }) {
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
            const results = await mem.getAll({ userId });
            const items = (
              results?.results ??
              results?.memories ??
              []
            ).slice(0, limit);
            if (items.length === 0) {
              return { content: "No memories stored yet." };
            }
            const formatted = items
              .map(
                (m: any, i: number) =>
                  `${i + 1}. [${m.id}] ${m.memory ?? m.content ?? "(empty)"}`
              )
              .join("\n");
            return {
              content: `Found ${items.length} memories:\n${formatted}`,
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
    // Hook: Auto-Recall (before_agent_start)
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

        try {
          const mem = await ensureMemory(cfg, api.logger);

          const searchOpts: Record<string, unknown> = {
            userId,
            limit: topK,
          };

          const results = await withEmbedRetry(
            () => mem.search(searchQuery, searchOpts),
            api.logger
          );

          const memories = (
            results?.results ??
            results?.memories ??
            []
          ).filter((r: any) => (r.score ?? 1) >= threshold);

          let sessionMemories: any[] = [];
          if (currentSessionId) {
            try {
              const sessionResults = await withEmbedRetry(
                () =>
                  mem.search(searchQuery, {
                    userId,
                    runId: currentSessionId,
                    limit: topK,
                  }),
                api.logger
              );
              const existingIds = new Set(
                memories.map((m: any) => m.id)
              );
              sessionMemories = (
                sessionResults?.results ??
                sessionResults?.memories ??
                []
              ).filter(
                (r: any) =>
                  !existingIds.has(r.id) &&
                  (r.score ?? 1) >= threshold
              );
            } catch {
              // Session search may not be supported
            }
          }

          if (memories.length === 0 && sessionMemories.length === 0)
            return;

          let memoryContext = "";
          if (memories.length > 0) {
            memoryContext += memories
              .map(
                (r: any) => `- ${r.memory ?? r.content ?? ""}`
              )
              .join("\n");
          }
          if (sessionMemories.length > 0) {
            if (memoryContext) memoryContext += "\n";
            memoryContext += "\nSession context:\n";
            memoryContext += sessionMemories
              .map(
                (r: any) => `- ${r.memory ?? r.content ?? ""}`
              )
              .join("\n");
          }

          const total = memories.length + sessionMemories.length;
          api.logger.info(
            `mem0-sidecar: injecting ${total} recalled memories (${memories.length} long-term, ${sessionMemories.length} session)`
          );

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
    // Hook: Auto-Capture (agent_end) - v2 with quality filter + dedup
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

        try {
          // Step 1: Extract and format messages
          const formatted = selectMessagesForCapture(event.messages);

          // Step 2: Pre-filter - skip noise conversations
          const filterResult = shouldSkipCapture(formatted, minCaptureChars);
          if (filterResult.skip) {
            api.logger.info(
              `mem0-sidecar: skipping capture - ${filterResult.reason}`
            );
            logCapture(captureLogPath, {
              action: "skip",
              userId,
              sessionId,
              reason: filterResult.reason,
            });
            return;
          }

          const mem = await ensureMemory(cfg, api.logger);

          // Step 3: Add with quality-focused extraction
          // The custom prompt (CAPTURE_INSTRUCTIONS) is already set in the Memory config.
          // Mem0's internal LLM call will use it to decide what to extract.
          const addOpts: Record<string, unknown> = { userId };
          if (currentSessionId)
            addOpts.runId = currentSessionId;

          const result = await mem.add(formatted, addOpts);
          const newMemories = result?.results ?? [];
          const count = newMemories.length;

          if (count > 0) {
            // Step 4: Post-capture dedup check
            // For each newly added memory, check if a very similar one already existed
            let dedupSkipped = 0;
            for (const newMem of newMemories) {
              const memText =
                newMem.memory ?? newMem.content ?? "";
              if (!memText) continue;

              try {
                const similar = await withEmbedRetry(
                  () =>
                    mem.search(memText, {
                      userId,
                      limit: 3,
                    }),
                  api.logger
                );
                const matches = (
                  similar?.results ??
                  similar?.memories ??
                  []
                ).filter(
                  (r: any) =>
                    r.id !== newMem.id &&
                    (r.score ?? 0) >= dedupThreshold
                );
                if (matches.length > 0) {
                  // Near-duplicate found - remove the new one, keep the old
                  await mem.delete(newMem.id);
                  dedupSkipped++;
                  api.logger.info(
                    `mem0-sidecar: dedup - removed new memory "${memText.substring(0, 80)}" (similar to existing "${(matches[0].memory ?? "").substring(0, 80)}", score=${matches[0].score?.toFixed(3)})`
                  );
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
              userId,
              sessionId,
              count: stored,
              skipped: dedupSkipped,
              details: newMemories
                .slice(0, 3)
                .map(
                  (m: any) =>
                    (
                      m.memory ??
                      m.content ??
                      ""
                    ).substring(0, 100)
                )
                .join(" | "),
            });
          } else {
            api.logger.info(
              `mem0-sidecar: capture extracted 0 memories (LLM found nothing worth storing)`
            );
            logCapture(captureLogPath, {
              action: "capture_empty",
              userId,
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
            userId,
            sessionId,
            reason: String(err).substring(0, 200),
          });
        }
      });
    }

    api.logger.info(
      `mem0-sidecar v2: registered (userId=${userId}, recall=${cfg.autoRecall !== false}, capture=${cfg.autoCapture !== false}, topK=${topK}, dedupThreshold=${dedupThreshold})`
    );
  },
};

export default plugin;
