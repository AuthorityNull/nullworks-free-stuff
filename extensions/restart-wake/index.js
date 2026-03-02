/**
 * restart-wake plugin v6
 * 
 * Per-session sentinels via fs.watch:
 * - RUNTIME: watches restart-sentinel.json - when gateway tool writes it,
 *   immediately copies to restart-sentinels/<session>.json (captures all sessions)
 * - STARTUP: reads all per-session sentinels, consumes built-in sentinel,
 *   then for each session: sends notification + runs silent agent turn
 */

const fs = require('fs');
const path = require('path');

let pluginApi = null;
let config = { enabled: true, delayMs: 3000 };
let watcher = null;

function getStateDir() {
  return process.env.OPENCLAW_STATE_DIR
    || path.join(process.env.HOME || '/home/clawdbot', '.openclaw');
}

function getSentinelDir() {
  return path.join(getStateDir(), 'restart-sentinels');
}

// Workspace-mounted sentinel dir (survives container recreates)
function getWorkspaceSentinelDir() {
  return '/workspace/.restart-sentinels';
}

function resolveDistDir() {
  const candidates = [
    '/usr/local/lib/node_modules/openclaw/dist',
    path.join(process.cwd(), 'node_modules', 'openclaw', 'dist'),
  ];
  for (const dir of candidates) {
    try { if (fs.statSync(dir).isDirectory()) return dir; } catch {}
  }
  return null;
}

async function findFunctions(modulePrefix, functionNames) {
  const distDir = resolveDistDir();
  if (!distDir) return {};

  const files = fs.readdirSync(distDir)
    .filter(f => f.startsWith(modulePrefix) && f.endsWith('.js')
      && !f.includes('helpers') && !f.includes('.pre-'));

  const wanted = new Set(functionNames);
  const found = {};

  for (const file of files) {
    try {
      const mod = await import(path.join(distDir, file));
      const sources = [mod, mod.n].filter(Boolean);
      for (const source of sources) {
        for (const [, value] of Object.entries(source)) {
          if (typeof value === 'function' && wanted.has(value.name)) {
            found[value.name] = value;
            if (Object.keys(found).length === wanted.size) return found;
          }
        }
      }
    } catch {}
  }
  return found;
}

/**
 * Consume the built-in single sentinel (suppress default message).
 */
function consumeBuiltinSentinel() {
  const sentinelPath = path.join(getStateDir(), 'restart-sentinel.json');
  try {
    fs.readFileSync(sentinelPath, 'utf-8');
    fs.unlinkSync(sentinelPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and delete all per-session sentinel files from a directory.
 */
function consumeSentinelsFromDir(dir) {
  const sentinels = [];
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        sentinels.push(data);
        fs.unlinkSync(filePath);
      } catch {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  } catch {
    // Directory doesn't exist - no sentinels
  }
  return sentinels;
}

/**
 * Read and delete all per-session sentinels (container state + workspace volume).
 */
function consumeSessionSentinels() {
  const containerSentinels = consumeSentinelsFromDir(getSentinelDir());
  const workspaceSentinels = consumeSentinelsFromDir(getWorkspaceSentinelDir());
  return [...containerSentinels, ...workspaceSentinels];
}

/**
 * Watch the state directory for sentinel writes.
 * When restart-sentinel.json is written, copy to per-session file.
 */
function startWatcher(logger) {
  const stateDir = getStateDir();
  const sentinelPath = path.join(stateDir, 'restart-sentinel.json');
  const sentinelDir = getSentinelDir();

  // Ensure per-session directory exists
  fs.mkdirSync(sentinelDir, { recursive: true });

  try {
    watcher = fs.watch(stateDir, (eventType, filename) => {
      if (filename !== 'restart-sentinel.json') return;

      try {
        const raw = fs.readFileSync(sentinelPath, 'utf-8');
        const data = JSON.parse(raw);
        const payload = data?.payload;
        if (!payload?.sessionKey) return;

        const safeKey = payload.sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
        const perSessionPath = path.join(sentinelDir, `${safeKey}.json`);

        fs.writeFileSync(perSessionPath, JSON.stringify({
          sessionKey: payload.sessionKey,
          reason: payload.stats?.reason?.trim() || '',
          note: payload.message?.trim() || '',
          deliveryContext: payload.deliveryContext || null,
          timestamp: Date.now()
        }));

        logger.info(`restart-wake: captured sentinel for ${payload.sessionKey}`);
      } catch {
        // Sentinel might be mid-write or already deleted - ignore
      }
    });

    logger.info('restart-wake: watching for sentinel writes');
  } catch (err) {
    logger.warn(`restart-wake: fs.watch failed: ${err.message}`);
  }
}

/**
 * Fallback session key: owner DM session (most likely to have a valid delivery target).
 */
const FALLBACK_SESSION_KEY = process.env.FALLBACK_SESSION_KEY || null;

/**
 * Process a single session sentinel: notify + silent agent turn.
 * If the primary sessionKey fails to route, retries with fallback DM session.
 */
async function processSentinel(sentinel, agentFns, logger) {
  const { sessionKey, reason, note } = sentinel;
  const label = sessionKey || 'recreate';

  // Build agent context message
  const parts = ['[System Message] Gateway restarted.'];
  if (note) parts.push(note);
  if (reason && reason !== note) parts.push('Reason: ' + reason);
  parts.push('Resume any in-progress work per HEARTBEAT.md.');
  const message = parts.join('\n');

  const tryAgentTurn = async (key, attempt) => {
    const runtime = {
      log: () => {},
      error: (msg) => logger.error(`restart-wake [${key}] agent: ${msg}`),
      exit: () => {}
    };
    const deps = agentFns.createDefaultDeps();
    await agentFns.agentCommand({
      message,
      sessionKey: key || undefined,
      deliver: true
    }, runtime, deps);
    logger.info(`restart-wake [${key}]: agent turn completed (${attempt})`);
  };

  // Try primary session key first
  try {
    await tryAgentTurn(sessionKey, 'primary');
    return; // success
  } catch (err) {
    logger.warn(`restart-wake [${label}]: primary failed: ${err.message || err}`);
  }

  // Fallback to owner DM session
  if (sessionKey !== FALLBACK_SESSION_KEY) {
    try {
      logger.info(`restart-wake [${label}]: falling back to owner DM session`);
      await tryAgentTurn(FALLBACK_SESSION_KEY, 'fallback');
    } catch (err) {
      logger.error(`restart-wake [${label}]: fallback also failed: ${err.message || err}`);
    }
  }
}

const plugin = {
  register(api) {
    pluginApi = api;
    config = { ...config, ...api.pluginConfig };

    if (!config.enabled) {
      api.logger.info('restart-wake: disabled');
      return;
    }

    api.registerService({
      id: 'restart-wake',
      start: async () => {
        // Always consume built-in sentinel to suppress default message
        const hadBuiltin = consumeBuiltinSentinel();

        // Read all per-session sentinels
        const sentinels = consumeSessionSentinels();

        if (sentinels.length === 0) {
          if (hadBuiltin) {
            api.logger.info('restart-wake: consumed built-in sentinel but no per-session sentinels found');
          } else {
            api.logger.info('restart-wake: no sentinels (fresh start) - skipping wake');
          }
        } else {
          api.logger.info(`restart-wake: found ${sentinels.length} session sentinel(s)`);

          // Process sentinels after delay (let gateway fully initialize)
          setTimeout(async () => {
            try {
              const agentFns = await findFunctions('pi-embedded-', ['agentCommand', 'createDefaultDeps']);

              if (!agentFns.agentCommand || !agentFns.createDefaultDeps) {
                api.logger.warn('restart-wake: missing agentCommand/createDefaultDeps');
                return;
              }

              // Process each sentinel sequentially
              for (const sentinel of sentinels) {
                await processSentinel(sentinel, agentFns, api.logger);
              }

              api.logger.info('restart-wake: all sessions processed');
            } catch (err) {
              api.logger.error(`restart-wake: failed: ${err.message || err}`);
            }
          }, config.delayMs);
        }

        // Start watching for future sentinel writes (runtime capture)
        startWatcher(api.logger);
      },
      stop: () => {
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        if (pluginApi) pluginApi.logger.info('restart-wake: stopped');
      }
    });
  }
};

module.exports = plugin;
