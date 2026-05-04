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
const { pushVerdict } = require('./verdictBroadcaster');
const { analyseText } = require('./text');
const { notifyGuardians } = require('./guardian');
const WS_OPEN = 1;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mapRiskLevel(verdict) {
  return verdict.risk_level === 'HIGH'
    ? 'HIGH'
    : verdict.risk_level === 'MEDIUM'
    ? 'MEDIUM'
    : 'LOW';
}

/**
 * Setup WebSocket route for live call monitoring
 * @param {Object} app - Express app instance (express-ws must already be initialized)
 */
function setupLiveCallWS(app) {
  console.log('[ws] Setting up /ws/live-call route with app.ws()');
  
  app.ws('/ws/live-call', async (ws, req) => {
    let initReceived = false;
    let guardianAlertSent = false;
    let sessionId = null;
    let guardianPhone = null;
    let sttStream = null;
    let sttStreamReady = false;  // Track if STT stream is usable
    let closing = false;
    let finalizing = false;
    let buffer = null;
    let latestInterim = null;
    let sttClosedResolve = null;

    console.log('[ws-live-call] ✓ New WebSocket connection established!');
    console.log('[ws-live-call] Connection headers:', {
      'upgrade': req.headers.upgrade,
      'connection': req.headers.connection,
      'origin': req.headers.origin
    });

    async function analyzeAndPushTranscript(isFinal = false) {
      if (!buffer || !sessionId) {
        return null;
      }

      const transcript = buffer.getRecent();
      if (!transcript) {
        if (latestInterim?.text) {
          buffer.append(latestInterim.speakerLabel || 'Unknown', latestInterim.text);
          latestInterim = null;
          return analyzeAndPushTranscript(isFinal);
        }

        if (isFinal) {
          pushVerdict(sessionId, {
            type: 'final',
            final: true,
            riskLevel: 'LOW',
            scamType: null,
            transcript: '',
            advice: 'No speech was transcribed. Please try again with the phone audio louder or closer to the microphone.',
          });
        }
        return null;
      }

      let verdict;
      try {
        const analysisPhone = `live-call-${sessionId.substring(0, 8)}`;
        verdict = await analyseText(analysisPhone, transcript, true);
      } catch (err) {
        console.error(
          `[ws-live-call] ${sessionId} Analysis error:`,
          err.message
        );
        if (isFinal) {
          pushVerdict(sessionId, {
            type: 'final',
            final: true,
            riskLevel: 'LOW',
            scamType: null,
            transcript,
            advice: 'Transcript captured, but final AI scam analysis failed. Please review the transcript manually.',
          });
        }
        return null;
      }

      const riskLevel = mapRiskLevel(verdict);
      pushVerdict(sessionId, {
        type: isFinal ? 'final' : 'update',
        final: isFinal,
        riskLevel,
        scamType: verdict.scam_type || null,
        transcript,
        advice: verdict.reason_en || verdict.reason_bm || null,
        confidence: verdict.confidence || 0,
      });

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

      return verdict;
    }

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
            async (speakerLabel, text, isFinal) => {
              // Callback: new transcript segment from STT
              console.log(
                `[ws-live-call] ${sessionId} | ${speakerLabel}${isFinal ? '' : ' interim'}: ${text.substring(0, 50)}...`
              );

              if (!isFinal) {
                latestInterim = { speakerLabel, text };
                pushVerdict(sessionId, {
                  type: 'transcript',
                  final: false,
                  transcriptOnly: true,
                  transcript: buffer.getRecent() || `${speakerLabel}: ${text}`,
                });
                return;
              }

              latestInterim = null;
              buffer.append(speakerLabel, text);

              await analyzeAndPushTranscript(false);
            },
            (err) => {
              // Error callback from STT
              console.error(`[ws-live-call] ${sessionId} STT error:`, err.message);
              sttStreamReady = false;  // Mark stream as no longer usable
              // Close WebSocket on fatal STT error
              if (ws.readyState === WS_OPEN) {
                ws.close(1011, 'STT stream error: ' + err.message);
              }
            }
          );

          initReceived = true;
          sttStreamReady = true;  // Mark stream as ready
          sttStream.once('close', () => {
            if (sttClosedResolve) {
              sttClosedResolve();
              sttClosedResolve = null;
            }
          });
          console.log(
            `[ws-live-call] ${sessionId} STT stream initialized, ready for audio`
          );
          return;
        }

        if (initReceived && typeof message === 'string') {
          let controlMsg = null;
          try {
            controlMsg = JSON.parse(message);
          } catch (e) {
            controlMsg = null;
          }

          if (controlMsg?.type === 'stop') {
            if (finalizing) {
              return;
            }

            finalizing = true;
            console.log(`[ws-live-call] ${sessionId} Stop requested, running final analysis`);

            if (sttStream && sttStream.isUsable?.()) {
              try {
                sttStream.end();
              } catch (err) {
                console.error(`[ws-live-call] ${sessionId} Error ending STT stream:`, err.message);
              }
            }
            sttStreamReady = false;

            await Promise.race([
              new Promise((resolve) => {
                sttClosedResolve = resolve;
              }),
              delay(5000),
            ]);
            await analyzeAndPushTranscript(true);
            if (ws.readyState === WS_OPEN) {
              ws.close(1000, 'Monitoring stopped');
            }
            return;
          }
        }

        // Subsequent messages are audio data
        if (!initReceived) {
          console.warn(
            '[ws-live-call] Received audio data before init, ignoring'
          );
          return;
        }

        if (closing || !sttStream || !sttStreamReady || !sttStream.isUsable?.()) {
          console.warn('[ws-live-call] STT stream not ready, cannot write audio');
          return;
        }

        // Write audio chunk to STT stream
        try {
          sttStream.write(message);
        } catch (writeErr) {
          console.error(`[ws-live-call] ${sessionId} Failed to write audio:`, writeErr.message);
          sttStreamReady = false;
          if (ws.readyState === WS_OPEN) {
            ws.close(1011, 'Failed to write audio to STT');
          }
        }
      } catch (err) {
        console.error('[ws-live-call] Message handler error:', err);
      }
    });

    /**
     * Connection close handler
     */
    ws.on('close', () => {
      console.log(`[ws-live-call] ${sessionId} WebSocket closed`);
      closing = true;

      // Cleanup - properly end the STT stream
      if (sttStream && sttStream.isUsable?.()) {
        try {
          sttStream.end();
        } catch (err) {
          console.error(`[ws-live-call] ${sessionId} Error closing STT stream:`, err.message);
        }
      }
      sttStreamReady = false;
      
      if (buffer) {
        setTimeout(() => removeBuffer(sessionId), 30000);
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
