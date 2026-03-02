'use strict';

const fs = require('node:fs');
const path = require('node:path');

function toArray(v, fallback) {
  return Array.isArray(v) ? v : fallback;
}

function normalizeConfig(pluginConfig) {
  const cfg = pluginConfig || {};
  return {
    enabled: cfg.enabled !== false,
    instanceId: typeof cfg.instanceId === 'string' ? cfg.instanceId : '',
    strictInstanceMatch: cfg.strictInstanceMatch === true,
    allowedAgentIds: toArray(cfg.allowedAgentIds, ['main']),
    maxPrependChars: Number.isFinite(cfg.maxPrependChars) ? cfg.maxPrependChars : 4000,
    maxSystemPromptChars: Number.isFinite(cfg.maxSystemPromptChars) ? cfg.maxSystemPromptChars : 12000,
    allowSystemPromptOverride: cfg.allowSystemPromptOverride === true,
    promptTreeBaseDirs: toArray(cfg.promptTreeBaseDirs, []),
    defaultPromptFilesMain: toArray(cfg.defaultPromptFilesMain, ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md']),
    defaultPromptFilesSubagent: toArray(cfg.defaultPromptFilesSubagent, ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md']),
    defaultPromptJoinerMain: typeof cfg.defaultPromptJoinerMain === 'string' ? cfg.defaultPromptJoinerMain : '\n\n',
    defaultPromptJoinerSubagent: typeof cfg.defaultPromptJoinerSubagent === 'string' ? cfg.defaultPromptJoinerSubagent : '\n\n',
    profiles: (cfg.profiles && typeof cfg.profiles === 'object') ? cfg.profiles : {},
    rules: toArray(cfg.rules, []),
  };
}

function safeRegex(input, logger) {
  if (!input || typeof input !== 'string') return null;
  try {
    return new RegExp(input, 'i');
  } catch (err) {
    logger?.warn?.(`model-prompt-profiles: invalid regex '${input}': ${err.message}`);
    return null;
  }
}

function detectInstanceMatch(cfg) {
  if (!cfg.instanceId) return true;
  const explicitInstance =
    process.env.OPENCLAW_INSTANCE_ID ||
    process.env.INSTANCE_ID ||
    '';
  const envAgentId = process.env.OPENCLAW_AGENT_ID || process.env.AGENT_ID || '';
  const envName = process.env.OPENCLAW_AGENT_NAME || process.env.AGENT_NAME || '';
  const hostname = process.env.HOSTNAME || '';
  const hay = `${explicitInstance} ${envAgentId} ${envName} ${hostname}`.toLowerCase();
  return hay.includes(String(cfg.instanceId).toLowerCase());
}

function agentAllowed(ctx, cfg) {
  const agentId = String(ctx?.agentId || '');
  return cfg.enabled && cfg.allowedAgentIds.includes(agentId);
}

function extractModelText(event, ctx) {
  const candidates = [
    event?.model,
    event?.modelId,
    event?.resolvedModel,
    event?.selectedModel,
    event?.requestModel,
    event?.providerModel,
    ctx?.model,
    ctx?.modelId,
    ctx?.resolvedModel,
    ctx?.requestModel,
  ].filter((v) => typeof v === 'string' && v.trim());

  return candidates.join(' | ');
}

function pickRule(prompt, sessionKey, modelText, cfg, logger) {
  const p = String(prompt || '');
  const sk = String(sessionKey || '');
  const mt = String(modelText || '');

  for (const rule of cfg.rules) {
    if (!rule || typeof rule !== 'object') continue;

    const promptRe = safeRegex(rule.promptRegex, logger);
    const sessionRe = safeRegex(rule.sessionKeyRegex, logger);
    const modelRe = safeRegex(rule.modelRegex, logger);

    const promptOk = !promptRe || promptRe.test(p);
    const sessionOk = !sessionRe || sessionRe.test(sk);
    const modelOk = !modelRe || modelRe.test(mt);

    if (promptOk && sessionOk && modelOk) return rule;
  }
  return null;
}

function clampString(value, maxLen) {
  if (typeof value !== 'string' || !value) return undefined;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function isSubagentSession(ctx) {
  const sk = String(ctx?.sessionKey || '');
  return sk.includes(':subagent:');
}

function getScopeLabel(ctx) {
  return isSubagentSession(ctx) ? 'subagent' : 'main';
}

function getDefaultPromptFilesForScope(cfg, scope) {
  if (scope === 'subagent') {
    return toArray(cfg.defaultPromptFilesSubagent, ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md']);
  }
  return toArray(cfg.defaultPromptFilesMain, ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md']);
}

function getDefaultPromptJoinerForScope(cfg, scope) {
  if (scope === 'subagent') {
    return typeof cfg.defaultPromptJoinerSubagent === 'string' ? cfg.defaultPromptJoinerSubagent : '\n\n';
  }
  return typeof cfg.defaultPromptJoinerMain === 'string' ? cfg.defaultPromptJoinerMain : '\n\n';
}

function isPathAllowed(absDir, cfg) {
  const bases = toArray(cfg.promptTreeBaseDirs, []).filter((v) => typeof v === 'string' && v.trim());
  if (!bases.length) return true;

  for (const b of bases) {
    const base = path.resolve(String(b));
    if (absDir === base || absDir.startsWith(`${base}${path.sep}`)) return true;
  }
  return false;
}

function loadPromptTreeSystemPrompt(profile, cfg, logger, ctx) {
  const dirRaw = typeof profile?.promptTreeDir === 'string' ? profile.promptTreeDir.trim() : '';
  if (!dirRaw) return undefined;

  const scope = getScopeLabel(ctx);
  const absDir = path.resolve(dirRaw);
  if (!isPathAllowed(absDir, cfg)) {
    logger?.warn?.(`model-prompt-profiles: promptTreeDir blocked by promptTreeBaseDirs: ${absDir}`);
    return undefined;
  }

  const files = toArray(profile.promptFiles, getDefaultPromptFilesForScope(cfg, scope))
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim());

  const joiner = typeof profile.promptJoiner === 'string' ? profile.promptJoiner : getDefaultPromptJoinerForScope(cfg, scope);
  const blocks = [];

  for (const rel of files) {
    const full = path.resolve(absDir, rel);
    if (!(full === absDir || full.startsWith(`${absDir}${path.sep}`))) {
      logger?.warn?.(`model-prompt-profiles: blocked path escape in promptFiles entry '${rel}'`);
      continue;
    }

    if (!fs.existsSync(full)) continue;
    try {
      const text = fs.readFileSync(full, 'utf8');
      if (text && text.trim()) blocks.push(text.trim());
    } catch (err) {
      logger?.warn?.(`model-prompt-profiles: failed reading '${full}': ${err.message}`);
    }
  }

  if (!blocks.length) {
    logger?.warn?.(`model-prompt-profiles: promptTreeDir had no readable prompt files: ${absDir}`);
    return undefined;
  }

  logger?.info?.(
    `model-prompt-profiles: loaded prompt tree dir=${absDir} files=${blocks.length} scope=${scope}`
  );

  return blocks.join(joiner);
}

module.exports = {
  register(api) {
    const logger = api.logger;
    const cfg = normalizeConfig(api.pluginConfig);

    const instanceMatch = detectInstanceMatch(cfg);
    const activeInThisInstance = !cfg.strictInstanceMatch || instanceMatch;

    logger?.info?.(
      `model-prompt-profiles: loaded enabled=${cfg.enabled} instanceId=${cfg.instanceId || '-'} strictInstanceMatch=${cfg.strictInstanceMatch} instanceMatch=${instanceMatch} active=${activeInThisInstance} allowedAgentIds=${cfg.allowedAgentIds.join(',') || 'none'}`
    );

    if (cfg.instanceId && !instanceMatch) {
      logger?.warn?.(
        'model-prompt-profiles: instanceId did not match current env/hostname; running in fail-open mode unless strictInstanceMatch=true'
      );
    }

    if (!activeInThisInstance) {
      logger?.info?.('model-prompt-profiles: disabled in this instance (strict instance gate)');
      return;
    }

    api.registerHook('before_model_resolve', (event, ctx) => {
      if (!agentAllowed(ctx, cfg)) return;

      const modelText = extractModelText(event, ctx);
      const rule = pickRule(event?.prompt, ctx?.sessionKey, modelText, cfg, logger);
      if (!rule) return;

      const profile = rule.profile ? cfg.profiles[rule.profile] : null;

      const providerOverride =
        rule.providerOverride || profile?.providerOverride;
      const modelOverride =
        rule.modelOverride || profile?.modelOverride;

      if (!providerOverride && !modelOverride) return;

      logger?.info?.(
        `model-prompt-profiles: before_model_resolve agent=${ctx?.agentId || 'unknown'} profile=${rule.profile || 'inline'} provider=${providerOverride || '-'} model=${modelOverride || '-'} modelText=${modelText || '-'}`
      );

      return {
        providerOverride,
        modelOverride,
      };
    });

    api.registerHook('before_prompt_build', (event, ctx) => {
      if (!agentAllowed(ctx, cfg)) return;

      const modelText = extractModelText(event, ctx);
      const rule = pickRule(event?.prompt, ctx?.sessionKey, modelText, cfg, logger);
      if (!rule) return;

      const profile = rule.profile ? cfg.profiles[rule.profile] : null;
      if (!profile || typeof profile !== 'object') return;

      const prependContext = clampString(profile.prependContext, cfg.maxPrependChars);
      let systemPrompt = undefined;

      if (cfg.allowSystemPromptOverride) {
        systemPrompt = clampString(profile.systemPrompt, cfg.maxSystemPromptChars);

        if (!systemPrompt) {
          const loaded = loadPromptTreeSystemPrompt(profile, cfg, logger, ctx);
          systemPrompt = clampString(loaded, cfg.maxSystemPromptChars);
        }
      }

      if (!prependContext && !systemPrompt) return;

      logger?.info?.(
        `model-prompt-profiles: before_prompt_build agent=${ctx?.agentId || 'unknown'} profile=${rule.profile || 'inline'} prepend=${prependContext ? prependContext.length : 0} system=${systemPrompt ? systemPrompt.length : 0} modelText=${modelText || '-'}`
      );

      return {
        prependContext,
        systemPrompt,
      };
    });
  },
};
