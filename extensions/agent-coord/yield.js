#!/usr/bin/env node
/**
 * Yield/release a conversation
 * Usage: node yield.js <channelId> <agentId>
 * Returns JSON: { success: bool }
 */

const { yieldConversation, logAction, disconnect } = require('./lib');

async function main() {
  const [,, channelId, agentId] = process.argv;
  
  if (!channelId || !agentId) {
    console.error('Usage: node yield.js <channelId> <agentId>');
    process.exit(1);
  }
  
  try {
    const result = await yieldConversation(channelId, agentId);
    if (result.success) {
      await logAction(agentId, 'yield', { channelId });
    }
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
