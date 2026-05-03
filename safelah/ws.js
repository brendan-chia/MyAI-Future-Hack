/**
 * SafeLah Live Call Companion - WebSocket Handler
 * 
 * Orchestrates the live call pipeline:
 * 1. Receives audio via WebSocket
 * 2. Sends to Google Cloud STT v2 Streaming
 * 3. Accumulates transcript in buffer
 * 4. Analyzes with Gemini (via existing scamDetectionFlow)
 * 5. Broadcasts verdicts to SSE clients
 * 6. Alerts guardians on HIGH risk (once per session)
 */

const { createSTTStream } = require('./sttStream');
const { getBuffer, removeBuffer } = require('./transcriptBuffer');
const { pushVerdict, removeClient } = require('./verdictBroadcaster');
const { analyseText } = require('./text');
const { notifyGuardians } = require('./guardian');

/**
 * Setup WebSocket route for live call monitoring
 * @param {Object} app - Express app instance (express-ws must already be initialized)
 */
function setupLiveCallWS(app) {
  app.ws('/ws/live-call', async (ws, req) => {
    let initReceived = false;
    let guardianAlertSent = false;
    let sessionId = null;
    let guardianPhone = null;
    let sttStream = null;
    let buffer = null;

    console.log('[ws-live-call] New WebSocket connection');

    /**
     * Message handler: init or audio data
     */
    ws.on('message', async (message) => {
      try {
        // Try to parse as JSON (init message)
        if (!initReceived && typeof message === 'string') {
          let initMsg;
          try {
            initMsg = JSON.parse(message);
          } catch (e) {
            // Not JSON, treat as audio data but init not received
            console.warn(
              '[ws-live-call] Received non-JSON message before init'
            );
            ws.close(1002, 'Init message required first');
            return;
          }

          // Process init message
          if (initMsg.type !== 'init') {
            ws.close(1002, 'First message must have type: "init"');
            return;
          }

          sessionId = initMsg.sessionId;
          guardianPhone = initMsg.guardianPhone;

          console.log(
            `[ws-live-call] Session ${sessionId} initialized, guardian: ${guardianPhone || 'none'}`
          );

          // Get or create transcript buffer
          buffer = getBuffer(sessionId);

          // Create STT stream with callbacks
          sttStream = createSTTStream(
            async (speakerLabel, text) => {
              // Callback: new transcript segment from STT
              console.log(
                `[ws-live-call] ${sessionId} | ${speakerLabel}: ${text.substring(0, 50)}...`
              );

              // Append to buffer
              buffer.append(speakerLabel, text);

              // Get formatted recent transcript
              const recentTranscript = buffer.getRecent();
              if (!recentTranscript) {
                return;
              }

              // Analyze with Gemini
              let verdict;
              try {
                // Call analyseText with batchMode=true to suppress auto-sending
                // Use a dummy phone number for the session
                const analysisPhone = `live-call-${sessionId.substring(0, 8)}`;
                verdict = await analyseText(
                  analysisPhone,
                  recentTranscript,
                  true, // batchMode
                  'ms-MY' // Force Malay
                );
              } catch (err) {
                console.error(
                  `[ws-live-call] ${sessionId} Analysis error:`,
                  err.message
                );
                return; // Fail silently, try again on next chunk
              }

              // Map verdict to riskLevel (camelCase for frontend)
              const riskLevel =
                verdict.risk_level === 'HIGH'
                  ? 'HIGH'
                  : verdict.risk_level === 'MEDIUM'
                  ? 'MEDIUM'
                  : 'LOW';

              // Push verdict to SSE client
              pushVerdict(sessionId, {
                riskLevel,
                scamType: verdict.scam_type || null,
                transcript: recentTranscript,
                advice: verdict.reason_bm || null, // Use Malay reason
              });

              // Send guardian alert once if HIGH
              if (riskLevel === 'HIGH' && !guardianAlertSent) {
                guardianAlertSent = true;
                if (guardianPhone) {
                  try {
                    console.log(
                      `[ws-live-call] ${sessionId} Sending guardian alert to ${guardianPhone}`
                    );
                    await notifyGuardians(guardianPhone, verdict.scam_type);
                  } catch (err) {
                    console.error(
                      '[ws-live-call] Guardian alert failed:',
                      err.message
                    );
                  }
                }
              }
            },
            (err) => {
              // Error callback from STT
              console.error(`[ws-live-call] ${sessionId} STT error:`, err.message);
            }
          );

          initReceived = true;
          console.log(
            `[ws-live-call] ${sessionId} STT stream initialized, ready for audio`
          );
          return;
        }

        // Subsequent messages are audio data
        if (!initReceived) {
          console.warn(
            '[ws-live-call] Received audio data before init, ignoring'
          );
          return;
        }

        if (!sttStream) {
          console.warn('[ws-live-call] STT stream not ready');
          return;
        }

        // Write audio chunk to STT stream
        sttStream.write(message);
      } catch (err) {
        console.error('[ws-live-call] Message handler error:', err);
      }
    });

    /**
     * Connection close handler
     */
    ws.on('close', () => {
      console.log(`[ws-live-call] ${sessionId} WebSocket closed`);

      // Cleanup
      if (sttStream) {
        sttStream.end();
      }
      if (buffer) {
        removeBuffer(sessionId);
      }
      if (sessionId) {
        removeClient(sessionId);
      }
    });

    /**
     * Error handler
     */
    ws.on('error', (err) => {
      console.error(`[ws-live-call] ${sessionId} WebSocket error:`, err.message);
    });
  });
}

module.exports = { setupLiveCallWS };
