/**
 * SafeLah Live Call Companion - STT Stream Handler
 * 
 * Interfaces with Google Cloud Speech-to-Text v2 Streaming API.
 * Provides real-time transcription with speaker diarization.
 * 
 * NOTE: STT streaming sessions have a 5-minute Google limit.
 * For calls longer than 4.5 minutes, the caller should restart the stream.
 * This version does not implement restart logic — handle it at a higher level.
 */

const speech = require('@google-cloud/speech');

/**
 * Create and configure an STT streaming connection.
 * 
 * @param {Function} onTranscript - Callback: (speakerLabel, text) => void
 *   speakerLabel: 'Caller' | 'User' | 'Unknown'
 *   text: Transcribed text segment
 * @param {Function} onError - Callback: (error) => void
 * @returns {Stream} The recognizeStream for writing audio data
 */
function createSTTStream(onTranscript, onError) {
  const client = new speech.SpeechClient({
    // Credentials are picked up automatically from Cloud Run service account
    // via Application Default Credentials (ADC)
  });

  const config = {
    encoding: 'WEBM_OPUS',
    sampleRateHertz: 48000,
    languageCode: 'ms-MY',
    alternativeLanguageCodes: ['en-MY', 'zh-yue-Hant-HK', 'ta-MY'],
    enableSpeakerDiarization: true,
    diarizationSpeakerCount: 2,
    model: 'latest_long',
    useEnhanced: true,
  };

  const request = {
    config,
    interimResults: false, // Finals only — reduces noise sent to Gemini
  };

  const recognizeStream = client.streamingRecognize(request);

  recognizeStream.on('data', (data) => {
    if (!data.results || data.results.length === 0) {
      return;
    }

    // Get the last (most recent) result
    const result = data.results[data.results.length - 1];

    if (result.isFinal && result.alternatives && result.alternatives.length > 0) {
      const words = result.alternatives[0].words || [];

      if (words.length === 0) {
        return;
      }

      // Group consecutive words by speakerTag
      let currentTag = null;
      let currentText = '';

      words.forEach((word) => {
        const tag = word.speakerTag || 1;

        if (tag !== currentTag) {
          // Speaker changed or first word
          if (currentText.trim()) {
            // Emit the previous segment
            const label = speakerTagToLabel(currentTag);
            onTranscript(label, currentText.trim());
          }
          currentTag = tag;
          currentText = '';
        }

        if (currentText) {
          currentText += ' ';
        }
        currentText += word.word;
      });

      // Emit the final segment
      if (currentText.trim()) {
        const label = speakerTagToLabel(currentTag);
        onTranscript(label, currentText.trim());
      }
    }
  });

  recognizeStream.on('error', (err) => {
    console.error('[sttStream] STT error:', err.message);
    onError(err);
  });

  recognizeStream.on('close', () => {
    console.log('[sttStream] STT stream closed');
  });

  return recognizeStream;
}

/**
 * Convert STT speaker tag to a readable label.
 * 
 * Speaker tag semantics:
 *   tag 1 = First speaker heard (typically the elder answering)
 *   tag 2 = Second speaker heard (typically the scammer caller)
 * 
 * @param {number} tag - Speaker tag from STT
 * @returns {string} 'User' | 'Caller' | 'Unknown'
 */
function speakerTagToLabel(tag) {
  switch (tag) {
    case 1:
      return 'User'; // First speaker = the elder / user answering
    case 2:
      return 'Caller'; // Second speaker = the caller / scammer
    default:
      return 'Unknown';
  }
}

module.exports = { createSTTStream };
