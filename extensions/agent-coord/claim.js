#!/usr/bin/env node
/**
 * Claim a conversation for this agent
 * Usage: node claim.js <channelId> <agentId> [messageId]
 * Returns JSON: { success: bool, previousOwner: string|null }
 */

const { claimConversation, logAction, disconnect } = require('./lib');

async function main() {
  const [,, channelId, agentId, messageId] = process.argv;
  
  if (!channelId || !agentId) {
    console.error('Usage: node claim.js <channelId> <agentId> [messageId]');
    process.exit(1);
  }
  
  try {
    const result = await claimConversation(channelId, agentId, messageId);
    await logAction(agentId, 'claim', { channelId, messageId, previousOwner: result.previousOwner });
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
