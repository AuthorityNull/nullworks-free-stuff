#!/usr/bin/env node
/**
 * Check if a conversation is claimed by another agent
 * Usage: node check.js <channelId> <agentId>
 * Returns JSON: { claimed: bool, owner: string|null, age: number }
 */

const { checkConversation, disconnect } = require('./lib');

async function main() {
  const [,, channelId, agentId] = process.argv;
  
  if (!channelId || !agentId) {
    console.error('Usage: node check.js <channelId> <agentId>');
    process.exit(1);
  }
  
  try {
    const result = await checkConversation(channelId, agentId);
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
