#!/usr/bin/env node
/**
 * Get coordination status - active conversations and recent log
 * Usage: node status.js [--log]
 * Returns JSON with active conversations (and optionally log)
 */

const { listConversations, getLog, disconnect } = require('./lib');

async function main() {
  const showLog = process.argv.includes('--log');
  
  try {
    const conversations = await listConversations();
    const result = {
      activeConversations: conversations.length,
      conversations,
    };
    
    if (showLog) {
      result.recentLog = await getLog(20);
    }
    
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
