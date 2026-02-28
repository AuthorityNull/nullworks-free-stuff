/**
 * Agent Coordination v2 - Pure Routing Core
 *
 * Zero side effects. Zero I/O. Takes plain objects, returns a decision.
 * All hook plumbing, REST calls, and Redis ops happen in the adapter layer.
 */

'use strict';

const AGENT_IDS = {
  clud:   process.env.DISCORD_BOT_CLUD   || '',
  snoopy: process.env.DISCORD_BOT_SNOOPY || '',
  echo:   process.env.DISCORD_BOT_ECHO   || '',
};

const ID_TO_NAME = Object.fromEntries(
  Object.entries(AGENT_IDS).map(([name, id]) => [id, name])
);

const AGENT_ID_SET = new Set(
  Object.values(AGENT_IDS).filter((id) => typeof id === 'string' && id.length > 0)
);

/**
 * @param {object} input - RoutingInput (see SPEC.md)
 * @returns {{ allow: boolean, reason: string, priority: number }}
 */
function decideRouting(input) {
  const {
    channelId,
    senderId,
    isSharedChannel,
    isDm,
    replyTo,
    mentions,
    currentOwner,
    senderIsAgent,
    thisAgent,
    parentMentionedAgents,
  } = input;

  // Rule 1: DMs and non-shared channels skip coordination
  if (isDm || !isSharedChannel) {
    return { allow: true, reason: 'uncoordinated', priority: 0 };
  }

  // Compute this agent's hard targeting signals
  // - reply-to target
  // - explicit Discord @mention
  // - weighted task-directed name request (e.g. "snoopy implement this")
  const isReplyTarget = replyTo?.authorAgentId === thisAgent;
  const isExplicitMention = mentions?.agentIds?.includes(thisAgent) || false;
  const isWeightedNameTarget = mentions?.nameHits?.includes(thisAgent) || false;

  // Any agent in the message is hard-targeted?
  const anyHardTarget = !!(replyTo?.authorAgentId) ||
    (mentions?.agentIds?.length > 0) ||
    (mentions?.nameHits?.length > 0);

  // This agent's priority
  let priority = 0;
  let reason = 'no-signal';

  if (isReplyTarget) {
    // Reply target is always preserved as a primary responder.
    // Additional mentions/name-targets can add collaborators, not replace reply target.
    priority = 100;
    if (isExplicitMention) reason = 'mention+reply-target';
    else if (isWeightedNameTarget) reason = 'name+reply-target';
    else reason = 'reply-target';
  } else if (isExplicitMention || isWeightedNameTarget) {
    // Explicit @mention or weighted name-target in non-reply messages
    priority = 100;
    reason = isExplicitMention ? 'explicit-mention' : 'weighted-name-target';
  } else if (!anyHardTarget && currentOwner === thisAgent) {
    priority = 50;
    reason = 'owner-bias';
  }

  // Thread continuation: human replies to a message that @mentioned exactly one agent.
  // The reply chain carries intent even without a new @mention in the current message.
  // Priority 80: higher than owner-bias (50) but lower than direct @mention/reply (100).
  // Only triggers for single-agent mentions - multi-agent parent mentions are ambiguous
  // and fall through to classification/race instead.
  if (priority < 90 && !anyHardTarget && parentMentionedAgents?.length === 1) {
    const inheritedAgent = parentMentionedAgents[0];
    if (inheritedAgent === thisAgent) {
      priority = 80;
      reason = 'parent-mention-carry';
    } else {
      return { allow: false, reason: 'parent-mention-other:' + inheritedAgent, priority: 0 };
    }
  }

  // Rule 2/3: Sibling filter
  if (senderIsAgent) {
    if (priority >= 90) {
      // Sibling bypass - this agent is hard-targeted (reply or @mention)
      return { allow: true, reason: reason + ':sibling-bypass', priority };
    }
    // Sibling sent message, this agent not hard-targeted - deny
    return { allow: false, reason: 'sibling-filter', priority: 0 };
  }

  // Thread-continuation resolves before hard-target check (it already returned
  // DENY for non-matching agents above, so only the matching agent reaches here)
  if (priority >= 80 && reason === 'parent-mention-carry') {
    return { allow: true, reason, priority };
  }

  // Rule 4: Hard target exists somewhere
  if (anyHardTarget) {
    if (priority >= 90) {
      return { allow: true, reason, priority };
    }
    // Another agent is targeted, not this one
    return { allow: false, reason: 'not-targeted', priority };
  }

  // Rule 5: No hard target, check owner
  if (currentOwner) {
    if (currentOwner === thisAgent) {
      return { allow: true, reason: 'owner-bias', priority: 50 };
    }
    return { allow: false, reason: 'owned-by:' + currentOwner, priority: 0 };
  }

  // Rule 6: No hard target, no owner - allow (race)
  return { allow: true, reason: 'open-race', priority: 0 };
}


// ---------------------------------------------------------------------------
// Intent Classification - keyword fast-path (Phase 1, Layer 2)
// ---------------------------------------------------------------------------

const KEYWORD_PATTERNS = {
  snoopy: [
    // Code & engineering
    /\b(code|coding|implement|refactor|debug|fix bug|PR|pull request|merge|commit|git|branch)\b/i,
    /\b(function|class|module|import|export|async|await|promise|callback)\b/i,
    /\b(npm|node_modules|package\.json|dockerfile|docker-compose|yaml|json|typescript|javascript)\b/i,
    /\b(test|spec|jest|mocha|lint|eslint|prettier|build|compile|transpile)\b/i,
    /\b(API|endpoint|REST|GraphQL|webhook|socket|HTTP|curl|fetch|request)\b/i,
    /\b(database|schema|migration|query|SQL|redis|mongo)\b/i,
    /\b(write.*script|create.*file|edit.*code|update.*function|add.*feature)\b/i,
    /\b(research|investigate|look into|find out|brainstorm)\b/i,
  ],
  clud: [
    // Architecture & coordination
    /\b(architect|architecture|design|plan|roadmap|strategy|coordinate|orchestrat)\b/i,
    /\b(deploy|restart|rollback|infrastructure|infra|server|VPS|container|docker)\b/i,
    /\b(config|configuration|settings|env|environment|secret|vault|credential)\b/i,
    /\b(review|audit|security|permission|access|firewall|SSH|TLS|cert)\b/i,
    /\b(agent|multi-agent|orchestrat|snoopy|echo|cron|task|delegate)\b/i,
    /\b(memory|continuity|engram|workspace|backup|restore)\b/i,
    /\b(openclaw|extension|plugin|hook|patch)\b/i,
  ],
  echo: [
    // Public-facing & creative
    /\b(community|user support|FAQ|help desk|onboard|welcome)\b/i,
    /\b(tweet|post|social|content|blog|article|newsletter)\b/i,
    /\b(explain|tutorial|guide|walkthrough|documentation for users)\b/i,
    /\b(creative|write|story|copy|marketing|branding)\b/i,
    /\b(flippy|flipsuite|user feedback|feature request)\b/i,
  ],
};

/**
 * Keyword-based intent classification. Returns null if ambiguous.
 * @param {string} text - Message content
 * @returns {{ agent: string, confidence: number, category: string } | null}
 */
function classifyIntent(text) {
  if (!text || text.length < 3) return null;

  const scores = { clud: 0, snoopy: 0, echo: 0 };

  for (const [agent, patterns] of Object.entries(KEYWORD_PATTERNS)) {
    for (const pat of patterns) {
      if (pat.test(text)) scores[agent]++;
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topAgent, topScore] = sorted[0];
  const [, secondScore] = sorted[1];

  // Need clear winner: top >= 2 hits AND at least 2x the runner-up
  if (topScore >= 2 && topScore >= secondScore * 2) {
    return {
      agent: topAgent,
      confidence: Math.min(topScore / 4, 1),
      category: 'keyword',
    };
  }

  // Single hit with no competition
  if (topScore === 1 && secondScore === 0) {
    return {
      agent: topAgent,
      confidence: 0.4,
      category: 'keyword-weak',
    };
  }

  return null; // ambiguous - needs LLM
}

module.exports = { decideRouting, classifyIntent, AGENT_IDS, ID_TO_NAME, AGENT_ID_SET };
