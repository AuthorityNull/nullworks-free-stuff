/**
 * Restart Continuation Module
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.env.HOME || '/home/clawdbot', '.openclaw', 'restart-state.json');

function saveRestartState(sessionKey, message) {
  const state = { sessionKey, message, savedAt: Date.now() };
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

function getRestartState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Date.now() - state.savedAt > 120000) {
      fs.unlinkSync(STATE_FILE);
      return null;
    }
    fs.unlinkSync(STATE_FILE);
    return state;
  } catch (e) {
    return null;
  }
}

module.exports = { saveRestartState, getRestartState };
