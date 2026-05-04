/**
 * SafeLah Live Call Companion - Verdict Broadcaster
 * 
 * Simple SSE (Server-Sent Events) pub/sub bridge.
 * Allows the WebSocket handler to push verdicts to connected HTTP clients.
 */

// Map: sessionId → Express Response object (SSE connection)
const verdictClients = new Map();

/**
 * Register an SSE client for verdict updates
 * @param {string} sessionId - Session identifier
 * @param {Object} res - Express response object
 */
function registerClient(sessionId, res) {
  verdictClients.set(sessionId, res);
  console.log(
    `[verdictBroadcaster] Registered SSE client for session ${sessionId}`
  );
}

/**
 * Push a verdict to a connected SSE client
 * @param {string} sessionId - Session identifier
 * @param {Object} payload - Verdict object { riskLevel, scamType, transcript, advice }
 */
function pushVerdict(sessionId, payload) {
  const res = verdictClients.get(sessionId);
  if (!res) {
    return;
  }

  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (err) {
    console.error(
      `[verdictBroadcaster] Failed to push verdict to ${sessionId}:`,
      err.message
    );
    removeClient(sessionId);
  }
}

/**
 * Unregister an SSE client (called when connection closes)
 * @param {string} sessionId - Session identifier
 */
function removeClient(sessionId) {
  verdictClients.delete(sessionId);
  console.log(
    `[verdictBroadcaster] Unregistered SSE client for session ${sessionId}`
  );
}

module.exports = { registerClient, pushVerdict, removeClient };
