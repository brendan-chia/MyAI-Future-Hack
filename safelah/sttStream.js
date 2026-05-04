/**
 * SafeLah Live Call Companion - STT Stream Handler
 *
 * Interfaces with Google Cloud Speech-to-Text streaming.
 */

const speech = require('@google-cloud/speech');

/**
 * Create and configure an STT streaming connection.
 *
 * @param {Function} onTranscript - Callback: (speakerLabel, text, isFinal) => void
 * @param {Function} onError - Callback: (error) => void
 * @returns {Stream} The recognizeStream for writing audio data
 */
function createSTTStream(onTranscript, onError) {
  const client = new speech.SpeechClient();

  const languageCode = process.env.LIVE_STT_LANGUAGE_CODE || 'en-US';
  const alternativeLanguageCodes = (
    process.env.LIVE_STT_ALTERNATIVE_LANGUAGE_CODES || 'ms-MY,en-MY,ta-MY'
  )
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code && code !== languageCode);

  const config = {
    encoding: 'WEBM_OPUS',
    sampleRateHertz: 48000,
    languageCode,
    alternativeLanguageCodes,
    enableSpeakerDiarization: true,
    diarizationSpeakerCount: 2,
    enableAutomaticPunctuation: true,
  };

  const recognizeStream = client.streamingRecognize({
    config,
    interimResults: true,
  });
  let closed = false;

  recognizeStream.isUsable = () => (
    !closed &&
    !recognizeStream.destroyed &&
    !recognizeStream.writableEnded &&
    !recognizeStream.writableFinished
  );

  recognizeStream.on('data', (data) => {
    if (!data.results || data.results.length === 0) {
      return;
    }

    const result = data.results[data.results.length - 1];
    if (!result.alternatives || result.alternatives.length === 0) {
      return;
    }

    const alternative = result.alternatives[0];
    const words = alternative.words || [];
    const transcript = (alternative.transcript || '').trim();
    const isFinal = Boolean(result.isFinal);

    if (words.length === 0) {
      if (transcript) {
        onTranscript('Unknown', transcript, isFinal);
      }
      return;
    }

    let currentTag = null;
    let currentText = '';

    words.forEach((word) => {
      const tag = word.speakerTag || 1;

      if (tag !== currentTag) {
        if (currentText.trim()) {
          onTranscript(speakerTagToLabel(currentTag), currentText.trim(), isFinal);
        }
        currentTag = tag;
        currentText = '';
      }

      if (currentText) {
        currentText += ' ';
      }
      currentText += word.word;
    });

    if (currentText.trim()) {
      onTranscript(speakerTagToLabel(currentTag), currentText.trim(), isFinal);
    }
  });

  recognizeStream.on('error', (err) => {
    closed = true;
    console.error('[sttStream] STT error:', err.message);
    onError(err);
  });

  recognizeStream.on('close', () => {
    closed = true;
    console.log('[sttStream] STT stream closed');
  });

  recognizeStream.on('finish', () => {
    closed = true;
  });

  return recognizeStream;
}

function speakerTagToLabel(tag) {
  switch (tag) {
    case 1:
      return 'User';
    case 2:
      return 'Caller';
    default:
      return 'Unknown';
  }
}

module.exports = { createSTTStream };
