/**
 * SafeLah Live Call Companion - Transcript Buffer
 * 
 * In-memory rolling buffer for transcribed call segments.
 * Stores recent segments and formats them for Gemini analysis.
 */

/**
 * TranscriptBuffer: In-memory store for recent transcript segments
 */
class TranscriptBuffer {
  /**
   * @param {string} sessionId - Unique session identifier
   * @param {number} windowSeconds - How long to keep history (default 90s)
   */
  constructor(sessionId, windowSeconds = 90) {
    this.sessionId = sessionId;
    this.windowSeconds = windowSeconds;
    this.segments = []; // Array of { speakerLabel, text, timestamp }
  }

  /**
   * Add a transcribed segment
   * @param {string} speakerLabel - 'User' | 'Caller' | 'Unknown'
   * @param {string} text - Transcribed text
   */
  append(speakerLabel, text) {
    this.segments.push({
      speakerLabel,
      text,
      timestamp: Date.now(),
    });
    this._cleanup();
  }

  /**
   * Get all recent segments as a formatted string
   * @returns {string} Formatted transcript or empty string if no data
   */
  getRecent() {
    if (this.segments.length === 0) {
      return '';
    }

    return this.segments
      .map((seg) => `${seg.speakerLabel}: ${seg.text}`)
      .join('\n');
  }

  /**
   * Clear all segments
   */
  clear() {
    this.segments = [];
  }

  /**
   * Remove segments older than windowSeconds
   * @private
   */
  _cleanup() {
    const cutoff = Date.now() - this.windowSeconds * 1000;
    this.segments = this.segments.filter((seg) => seg.timestamp >= cutoff);
  }
}

// Singleton store for buffers keyed by sessionId
const bufferStore = new Map();

/**
 * Get or create a buffer for a session
 * @param {string} sessionId - Session identifier
 * @returns {TranscriptBuffer} The buffer for this session
 */
function getBuffer(sessionId) {
  if (!bufferStore.has(sessionId)) {
    bufferStore.set(sessionId, new TranscriptBuffer(sessionId, 90));
  }
  return bufferStore.get(sessionId);
}

/**
 * Remove a buffer (called when session ends)
 * @param {string} sessionId - Session identifier
 */
function removeBuffer(sessionId) {
  bufferStore.delete(sessionId);
}

module.exports = { TranscriptBuffer, getBuffer, removeBuffer };
