/**
 * Semantic Router for Agent Coordination
 * Routes messages to agents based on expertise embeddings
 */

const fs = require('fs');
const path = require('path');
const { embed, embedBatch, cosineSimilarity, computeCentroid, isHealthy } = require('./embedding-service');

// Thresholds
const CLAIM_THRESHOLD = 0.6;      // Min confidence to claim unclaimed channel
const CHIME_THRESHOLD = 0.9;      // Min confidence to chime in when another handles
const HANDOFF_DELTA = 0.25;       // Must be this much better to take over
const ANTI_CROSSTALK_MS = 30000;  // Cooldown after response

// Cache for expertise embeddings
let expertiseCache = null;
let cacheInitialized = false;

/**
 * Load expertise profiles from JSON
 */
function loadProfiles() {
  const profilePath = path.join(__dirname, 'expertise-profiles.json');
  if (!fs.existsSync(profilePath)) {
    console.error('[semantic-router] expertise-profiles.json not found');
    return {};
  }
  return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
}

/**
 * Initialize expertise embeddings cache
 * Call once on startup
 */
async function initExpertiseCache() {
  if (cacheInitialized) return expertiseCache;
  
  console.log('[semantic-router] Initializing expertise embeddings...');
  const profiles = loadProfiles();
  expertiseCache = {};
  
  for (const [agentId, profile] of Object.entries(profiles)) {
    try {
      console.log(`[semantic-router] Embedding ${profile.utterances.length} utterances for ${agentId}...`);
      const embeddings = await embedBatch(profile.utterances);
      const centroid = computeCentroid(embeddings);
      
      expertiseCache[agentId] = {
        profile,
        embeddings,
        centroid,
      };
      
      console.log(`[semantic-router] ${agentId} ready (${embeddings.length} embeddings)`);
    } catch (error) {
      console.error(`[semantic-router] Failed to embed ${agentId}:`, error.message);
    }
  }
  
  cacheInitialized = Object.keys(expertiseCache).length > 0;
  return expertiseCache;
}

/**
 * Calculate confidence scores for all agents
 */
async function calculateConfidence(message, context = {}) {
  if (!cacheInitialized || !expertiseCache) {
    await initExpertiseCache();
  }
  
  if (!cacheInitialized) {
    return null; // Fallback to binary claiming
  }
  
  const messageEmbedding = await embed(message);
  const scores = {};
  
  for (const [agentId, data] of Object.entries(expertiseCache)) {
    const profile = data.profile;
    
    // Base score: similarity to expertise centroid
    let centroidScore = cosineSimilarity(messageEmbedding, data.centroid);
    
    // Max similarity to any individual utterance (more precise)
    let maxUtteranceScore = 0;
    for (const emb of data.embeddings) {
      const sim = cosineSimilarity(messageEmbedding, emb);
      if (sim > maxUtteranceScore) maxUtteranceScore = sim;
    }
    
    // Blend centroid and max utterance scores
    let score = centroidScore * 0.5 + maxUtteranceScore * 0.5;
    
    // Channel boost
    if (context.channelId && profile.channelBoosts) {
      const boost = profile.channelBoosts[context.channelId] || 0;
      score += boost;
    }

    // Channel exclusions - set score to 0 if agent is excluded from this channel
    if (context.channelId && profile.channelExclusions) {
      if (profile.channelExclusions.includes(context.channelId)) {
        score = 0;
      }
    }
    
    // Continuity boost (if this agent is currently handling)
    if (context.currentHandler === agentId) {
      score += 0.1;
    }
    
    // Security isolation for Echo on internal topics
    if (profile.securityIsolation && context.isInternal) {
      const maxConf = profile.maxConfidenceInternal || 0.5;
      score = Math.min(score, maxConf);
    }
    
    // Cap at 1.0
    scores[agentId] = Math.min(Math.max(score, 0), 1.0);
  }
  
  return scores;
}

/**
 * Route a message to the appropriate agent
 */
async function routeMessage(message, context = {}) {
  // Check embedding service health
  if (!isHealthy()) {
    return { action: 'fallback', reason: 'embedding service unavailable' };
  }
  
  let scores;
  try {
    scores = await calculateConfidence(message, context);
  } catch (error) {
    console.error('[semantic-router] Confidence calculation failed:', error.message);
    return { action: 'fallback', reason: error.message };
  }
  
  if (!scores) {
    return { action: 'fallback', reason: 'no expertise cache' };
  }
  
  // Sort agents by score
  const sortedAgents = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topAgent, topScore] = sortedAgents[0];
  const currentHandler = context.currentHandler;
  
  // Case 1: Direct @mention - override everything
  if (context.mentionedAgent) {
    return {
      action: 'mention',
      agent: context.mentionedAgent,
      confidence: scores[context.mentionedAgent] || 0.5,
      scores,
    };
  }
  
  // Case 2: No current handler - highest score claims
  if (!currentHandler) {
    if (topScore >= CLAIM_THRESHOLD) {
      return {
        action: 'claim',
        agent: topAgent,
        confidence: topScore,
        scores,
      };
    }
    // Below confidence threshold with no current handler - fall through to
    // binary claiming (Redis NX race in index.js doClaimCheck).
    // Previously this was 'claim-fallback' which force-assigned the top agent
    // even at low confidence, causing unnecessary LLM calls.
    return {
      action: 'fallback',
      reason: 'no agent confident enough (top: ' + topAgent + ' at ' + topScore.toFixed(2) + ')',
      scores,
    };
  }
  
  // Case 3: Same agent still best - continue
  if (topAgent === currentHandler) {
    return {
      action: 'continue',
      agent: currentHandler,
      confidence: topScore,
      scores,
    };
  }
  
  // Case 4: Another agent is significantly better - handoff
  const currentScore = scores[currentHandler] || 0;
  if (topScore - currentScore >= HANDOFF_DELTA && topScore >= CHIME_THRESHOLD) {
    return {
      action: 'handoff',
      from: currentHandler,
      to: topAgent,
      confidence: topScore,
      delta: topScore - currentScore,
      scores,
    };
  }
  
  // Case 5: Another agent wants to chime in
  const timeSinceResponse = context.lastResponseTime
    ? Date.now() - context.lastResponseTime
    : Infinity;
  
  if (topScore >= CHIME_THRESHOLD && timeSinceResponse > ANTI_CROSSTALK_MS) {
    return {
      action: 'chime',
      agent: topAgent,
      alongside: currentHandler,
      confidence: topScore,
      scores,
    };
  }
  
  // Default: current handler continues
  return {
    action: 'continue',
    agent: currentHandler,
    confidence: currentScore,
    scores,
  };
}

/**
 * Get current cache status
 */
function getCacheStatus() {
  return {
    initialized: cacheInitialized,
    agents: expertiseCache ? Object.keys(expertiseCache) : [],
    healthy: isHealthy(),
  };
}

module.exports = {
  initExpertiseCache,
  calculateConfidence,
  routeMessage,
  getCacheStatus,
  CLAIM_THRESHOLD,
  CHIME_THRESHOLD,
  HANDOFF_DELTA,
  ANTI_CROSSTALK_MS,
};
