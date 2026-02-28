/**
 * Embedding Service for Agent Coordination
 * Uses Ollama on 1080 GPU server for fast local embeddings
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const TIMEOUT_MS = 30000;  // Increased from 10s to 30s
const MAX_RETRIES = 2;

let serviceHealthy = true;
let lastHealthCheck = 0;

/**
 * Embed text using Ollama with retry
 */
async function embed(text, retries = MAX_RETRIES) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }
    
    const data = await response.json();
    serviceHealthy = true;
    return data.embedding;
  } catch (error) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
      return embed(text, retries - 1);
    }
    serviceHealthy = false;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Batch embed multiple texts (with chunking to avoid overwhelming)
 */
async function embedBatch(texts, chunkSize = 10) {
  const results = [];
  
  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(t => embed(t)));
    results.push(...chunkResults);
  }
  
  return results;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compute centroid of multiple embeddings
 */
function computeCentroid(embeddings) {
  if (!embeddings || embeddings.length === 0) return null;
  
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb[i];
    }
  }
  
  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }
  
  return centroid;
}

/**
 * Check if embedding service is available
 */
async function healthCheck() {
  const now = Date.now();
  if (now - lastHealthCheck < 60000) {
    return serviceHealthy;
  }
  
  lastHealthCheck = now;
  
  try {
    await embed('health check');
    serviceHealthy = true;
  } catch {
    serviceHealthy = false;
  }
  
  return serviceHealthy;
}

function isHealthy() {
  return serviceHealthy;
}

module.exports = {
  embed,
  embedBatch,
  cosineSimilarity,
  computeCentroid,
  healthCheck,
  isHealthy,
  OLLAMA_URL,
  EMBED_MODEL,
};
