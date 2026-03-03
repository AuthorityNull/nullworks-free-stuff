/**
 * Tool Loop Breaker v3.3
 *
 * Uses before_tool_call (has sessionKey + can block) for enforcement.
 * Uses after_tool_call for error tracking.
 * No external abort API needed - blocks inline via hook return value.
 *
 * v3.3:
 * - Checkpoint gate at 30 calls: blocks once with an instruction to write a
 *   progress checkpoint to a memory file path, then allows continued work.
 * - Hard stop at 69 calls: forces a user-facing progress summary and handoff.
 */

let pluginApi = null;
let maxConsecutiveErrors = 5;
let maxToolCalls = 69;
let warnAtCalls = 55;
let checkpointAtCalls = 30;
let checkpointMemoryPath = '/workspace/memory/YYYY-MM-DD.md';

// Per-session counters keyed by sessionKey
// { errors: number, totalCalls: number, blocked: boolean, warned: boolean, checkpointIssued: boolean }
const sessionCounters = new Map();

function resolveCheckpointPath(pathTemplate) {
  if (typeof pathTemplate !== 'string') return '/workspace/memory/YYYY-MM-DD.md';
  const today = new Date().toISOString().slice(0, 10);
  return pathTemplate.replace(/YYYY-MM-DD/g, today);
}

function getCounter(key) {
  if (!sessionCounters.has(key)) {
    sessionCounters.set(key, {
      errors: 0,
      totalCalls: 0,
      blocked: false,
      warned: false,
      checkpointIssued: false,
    });
  }
  return sessionCounters.get(key);
}

module.exports = {
  register(api, cfg) {
    pluginApi = api;
    maxConsecutiveErrors = cfg?.maxConsecutiveErrors ?? 5;
    maxToolCalls = cfg?.maxToolCalls ?? 69;
    warnAtCalls = cfg?.warnAtCalls ?? 55;
    checkpointAtCalls = cfg?.checkpointAtCalls ?? 30;
    checkpointMemoryPath = cfg?.checkpointMemoryPath ?? '/workspace/memory/YYYY-MM-DD.md';

    api.logger?.info?.(
      `tool-loop-breaker: registered (maxErrors=${maxConsecutiveErrors}, checkpointAt=${checkpointAtCalls}, maxCalls=${maxToolCalls}, warnAt=${warnAtCalls}, checkpointPath=${checkpointMemoryPath})`
    );

    // --- before_tool_call: increment counter, warn/block if thresholds hit ---
    api.on('before_tool_call', (event, ctx) => {
      const sessionKey = ctx?.sessionKey || 'unknown';
      const counter = getCounter(sessionKey);

      // If already in blocked state for this turn, block all further calls
      if (counter.blocked) {
        api.logger?.warn?.(`tool-loop-breaker: [${sessionKey}] BLOCKED (circuit breaker tripped)`);
        return {
          block: true,
          blockReason:
            'STOP. Tool loop breaker hard-stop is active. You MUST deliver a response to the user RIGHT NOW. Summarize what you have so far and send it. Do not make any more tool calls.',
        };
      }

      counter.totalCalls++;

      // Total call threshold - HARD BLOCK
      if (counter.totalCalls >= maxToolCalls) {
        counter.blocked = true;
        api.logger?.error?.(
          `tool-loop-breaker: [${sessionKey}] HARD BLOCK - ${counter.totalCalls} total tool calls in one turn`
        );
        return {
          block: true,
          blockReason: `PAUSE. You have made ${counter.totalCalls} tool calls this turn (limit: ${maxToolCalls}). Deliver your progress so far to the user NOW, then continue the remaining work on your next turn. Do not abandon the task - summarize progress and state what you will do next.`,
        };
      }

      // Checkpoint gate - one-time block to force internal progress checkpoint
      if (counter.totalCalls >= checkpointAtCalls && !counter.checkpointIssued) {
        counter.checkpointIssued = true;
        const resolvedCheckpointPath = resolveCheckpointPath(checkpointMemoryPath);
        api.logger?.warn?.(
          `tool-loop-breaker: [${sessionKey}] CHECKPOINT REQUIRED at ${counter.totalCalls}/${maxToolCalls} calls`
        );
        return {
          block: true,
          blockReason: `CHECKPOINT REQUIRED. You have made ${counter.totalCalls} tool calls in this turn. Write a progress checkpoint to memory file path: ${resolvedCheckpointPath}. Include completed steps, current state, and next actions. After writing the checkpoint, continue working on the task (do NOT send a user summary yet unless asked).`,
        };
      }

      // Soft warning before hard block
      if (counter.totalCalls >= warnAtCalls && !counter.warned) {
        counter.warned = true;
        api.logger?.warn?.(
          `tool-loop-breaker: [${sessionKey}] WARNING - ${counter.totalCalls}/${maxToolCalls} tool calls used. Approaching hard stop.`
        );
      }

      // Consecutive error threshold
      if (counter.errors >= maxConsecutiveErrors) {
        counter.blocked = true;
        api.logger?.error?.(
          `tool-loop-breaker: [${sessionKey}] BLOCKING - ${counter.errors} consecutive tool errors`
        );
        return {
          block: true,
          blockReason: `STOP. ${counter.errors} consecutive tool errors detected. Something is broken. You MUST stop making tool calls and tell the user what went wrong. Respond now.`,
        };
      }

      return null; // allow
    });

    // --- after_tool_call: track errors ---
    api.on('after_tool_call', (event, ctx) => {
      const sessionKey = ctx?.sessionKey || event?.sessionKey || 'unknown';
      const counter = getCounter(sessionKey);

      if (event?.error) {
        counter.errors++;
        if (counter.errors >= 3) {
          api.logger?.warn?.(
            `tool-loop-breaker: [${sessionKey}] consecutive error #${counter.errors}: ${event.toolName} - ${String(event.error).slice(0, 100)}`
          );
        }
      } else {
        counter.errors = 0;
      }
    });

    // --- agent_end: clean up session counter ---
    api.on('agent_end', (event, ctx) => {
      const sessionKey = ctx?.sessionKey || 'unknown';
      sessionCounters.delete(sessionKey);
    });
  },
};
