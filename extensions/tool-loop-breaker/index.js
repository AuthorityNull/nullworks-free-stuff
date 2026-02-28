/**
 * Tool Loop Breaker v3.1
 * 
 * Uses before_tool_call (has sessionKey + can block) for enforcement.
 * Uses after_tool_call for error tracking.
 * No external abort API needed - blocks inline via hook return value.
 *
 * v3.1: Lowered maxToolCalls from 35 to 30. Added soft warning at 25.
 *        Improved block messages to force user-visible delivery.
 */

let pluginApi = null;
let maxConsecutiveErrors = 5;
let maxToolCalls = 30;
let warnAtCalls = 25;

// Per-session counters keyed by sessionKey
// { errors: number, totalCalls: number, blocked: boolean, warned: boolean }
const sessionCounters = new Map();

function getCounter(key) {
  if (!sessionCounters.has(key)) {
    sessionCounters.set(key, { errors: 0, totalCalls: 0, blocked: false, warned: false });
  }
  return sessionCounters.get(key);
}

module.exports = {
  register(api, cfg) {
    pluginApi = api;
    maxConsecutiveErrors = cfg?.maxConsecutiveErrors ?? 5;
    maxToolCalls = cfg?.maxToolCalls ?? 30;
    warnAtCalls = cfg?.warnAtCalls ?? 25;

    api.logger?.info?.(`tool-loop-breaker: registered (maxErrors=${maxConsecutiveErrors}, maxCalls=${maxToolCalls}, warnAt=${warnAtCalls})`);

    // --- before_tool_call: increment counter, warn/block if thresholds hit ---
    api.on('before_tool_call', (event, ctx) => {
      const sessionKey = ctx?.sessionKey || 'unknown';
      const counter = getCounter(sessionKey);

      // If already in blocked state for this turn, block all further calls
      if (counter.blocked) {
        api.logger?.warn?.(`tool-loop-breaker: [${sessionKey}] BLOCKED (circuit breaker tripped)`);
        return { block: true, blockReason: 'STOP. Tool loop breaker has tripped. You MUST deliver a response to the user RIGHT NOW. Summarize what you have so far and send it. Do not make any more tool calls.' };
      }

      counter.totalCalls++;

      // Total call threshold - HARD BLOCK
      if (counter.totalCalls >= maxToolCalls) {
        counter.blocked = true;
        api.logger?.error?.(`tool-loop-breaker: [${sessionKey}] BLOCKING - ${counter.totalCalls} total tool calls in one turn`);
        return { block: true, blockReason: `STOP. You have made ${counter.totalCalls} tool calls in one turn (limit: ${maxToolCalls}). You MUST stop all tool calls immediately and deliver your current findings to the user. This is not optional. Respond now.` };
      }

      // Soft warning before hard block
      if (counter.totalCalls >= warnAtCalls && !counter.warned) {
        counter.warned = true;
        api.logger?.warn?.(`tool-loop-breaker: [${sessionKey}] WARNING - ${counter.totalCalls}/${maxToolCalls} tool calls used. Approaching limit.`);
        // Don't block, just log. The model sees this in tool results via the built-in system.
      }

      // Consecutive error threshold
      if (counter.errors >= maxConsecutiveErrors) {
        counter.blocked = true;
        api.logger?.error?.(`tool-loop-breaker: [${sessionKey}] BLOCKING - ${counter.errors} consecutive tool errors`);
        return { block: true, blockReason: `STOP. ${counter.errors} consecutive tool errors detected. Something is broken. You MUST stop making tool calls and tell the user what went wrong. Respond now.` };
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
          api.logger?.warn?.(`tool-loop-breaker: [${sessionKey}] consecutive error #${counter.errors}: ${event.toolName} - ${String(event.error).slice(0, 100)}`);
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
  }
};
