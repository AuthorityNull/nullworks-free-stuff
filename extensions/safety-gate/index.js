/**
 * Safety Gate Extension
 *
 * 1. Intercepts high-risk tool calls (gateway restart, config changes) and
 *    enforces deterministic safety checks before allowing them through.
 * 2. On restart, reads the restart sentinel and injects a "do the work"
 *    directive into the first agent run via before_agent_start hook.
 *
 * Uses api.on() for proper hook registration.
 */

const fs = require('fs');
const path = require('path');

let pluginApi = null;
let config = {};

// One-time reminder state for restart/config actions
let warnedValidateConfig = false;

// Restart sentinel state
let restartReason = null;
let restartReasonConsumed = false;

const stats = {
  blocked: 0,
  allowed: 0,
};

/**
 * Try to read the restart sentinel file before OpenClaw consumes it.
 */
function readSentinelEarly() {
  try {
    const stateDir = process.env.OPENCLAW_STATE_DIR
      || path.join(process.env.HOME || '/home/clawdbot', '.openclaw');
    const sentinelPath = path.join(stateDir, 'restart-sentinel.json');
    const raw = fs.readFileSync(sentinelPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed?.payload) {
      const payload = parsed.payload;
      const reason = payload.message || payload.reason || '';
      if (reason) {
        restartReason = reason;
        restartReasonConsumed = false;
        pluginApi?.logger?.info?.(`safety-gate: captured restart reason (${reason.slice(0, 80)}...)`);
      }
    }
  } catch {
    // No sentinel file or parse error
  }
}

module.exports = {
  register(api, cfg) {
    pluginApi = api;
    config = cfg || {};

    api.logger?.info?.('safety-gate: registered');

    // --- Gateway start: capture restart sentinel ---
    api.on('gateway_start', () => {
      readSentinelEarly();
    });

    // --- Before agent start: inject restart directive ---
    api.on('before_agent_start', (event, ctx) => {
      if (!restartReason || restartReasonConsumed) return;

      // Only inject once, on the first agent run after restart
      restartReasonConsumed = true;

      const directive = [
        '[RESTART RECOVERY \u2014 ACTION REQUIRED]',
        'You just restarted. Your restart note said:',
        '"' + restartReason + '"',
        '',
        'Execute the plan described above immediately. Do the work first, then report results.',
        'Do not just announce what you plan to do \u2014 actually do it before responding to the user.',
      ].join('\n');

      api.logger?.info?.('safety-gate: injecting restart recovery directive');

      return { prependContext: directive };
    });

    // --- Before tool call: safety checks ---
    api.on('before_tool_call', (event, ctx) => {
      const toolName = event?.toolName;
      const params = event?.params || {};

      // --- Gateway tool checks ---
      if (toolName === 'gateway') {
        const action = params.action;
        // One-time advisory reminder before restart/config actions
        if (!warnedValidateConfig && (action === 'restart' || action === 'config.apply' || action === 'config.patch')) {
          warnedValidateConfig = true;
          api.logger?.warn?.(`safety-gate: advisory before ${action} - validate config before restart if you changed config, plugins, compose, or prompts`);
        }

        // config.apply needs a reason
        if (action === 'config.apply') {
          const reason = params.reason || '';
          if (!reason || reason.length < 5) {
            stats.blocked++;
            api.logger?.warn?.('safety-gate: BLOCKED config.apply \u2014 no reason provided');
            return {
              block: true,
              blockReason: '[safety-gate] config.apply requires a meaningful reason parameter explaining what changed. ' +
                'This is logged and helps with debugging if the restart fails.',
            };
          }
        }

        // All checks passed for restart/config actions \u2014 record timestamp
        if (action === 'restart' || action === 'config.apply' || action === 'config.patch') {
          lastRestartTime = Date.now();
        }
      }

      // --- Nodes run checks ---
      if (toolName === 'nodes' && params.action === 'run') {
        const command = params.command;
        if (Array.isArray(command)) {
          const cmdStr = command.join(' ');
          const protectedAgents = config.protectedAgents || ['clawdbot'];
          for (const agent of protectedAgents) {
            if (cmdStr.includes(`docker restart ${agent}`) || cmdStr.includes(`docker stop ${agent}`)) {
              stats.blocked++;
              api.logger?.warn?.(`safety-gate: BLOCKED docker restart/stop of ${agent}`);
              return {
                block: true,
                blockReason: `[safety-gate] Direct docker restart/stop of ${agent} is blocked. ` +
                  `Use gateway({ action: "restart" }) instead \u2014 it ensures auto-ping back to the active session.`,
              };
            }
          }
        }
      }

      stats.allowed++;
      return undefined;
    });
  },
};
