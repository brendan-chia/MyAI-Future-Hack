const { spawnSync } = require('child_process');
const speech = require('@google-cloud/speech');
const ffmpegPath = require('ffmpeg-static');
const { downloadMedia } = require('./whatsapp');

const client = new speech.SpeechClient();

const MIME_TO_ENCODING = {
  'audio/ogg': 'OGG_OPUS',
  'audio/opus': 'OGG_OPUS',
  'audio/webm': 'WEBM_OPUS',
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/wav': 'LINEAR16',
  'audio/x-wav': 'LINEAR16',
  'audio/flac': 'FLAC',
};

function getSpeechEncodingFromMime(mimeType) {
  if (!mimeType) return null;
  const clean = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_ENCODING[clean] || null;
}

function convertToLinear16Mono(buffer, mimeType) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not found; install ffmpeg-static');
  }

  const inputType = (mimeType || '').split(';')[0].trim().toLowerCase();
  const format = (inputType === 'audio/ogg' || inputType === 'audio/opus') ? 'ogg' :
                 (inputType === 'audio/webm') ? 'webm' :
                 (inputType === 'audio/mpeg' || inputType === 'audio/mp3') ? 'mp3' :
                 (inputType === 'audio/wav' || inputType === 'audio/x-wav') ? 'wav' :
                 'auto';

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', format,
    '-i', 'pipe:0',
    '-ar', '16000',
    '-ac', '1',
    '-af', 'aresample=16000,highpass=f=200,lowpass=f=7000,volume=1.0',
    '-f', 'wav',
    'pipe:1',
  ];

  const proc = spawnSync(ffmpegPath, args, {
    input: buffer,
    maxBuffer: 50 * 1024 * 1024,
  });

  if (proc.error) {
    throw new Error(`ffmpeg conversion error: ${proc.error.message}`);
  }

  if (proc.status !== 0) {
    throw new Error(`ffmpeg conversion failed: ${proc.stderr ? proc.stderr.toString() : 'unknown'}`);
  }

  return proc.stdout;
}

async function transcribeAudio(message) {
  const media = await downloadMedia(message);
  if (!media) {
    throw new Error('audio download failed');
  }

  const encoding = getSpeechEncodingFromMime(media.mimetype);
  if (!encoding) {
    throw new Error(`unsupported audio mimetype: ${media.mimetype}`);
  }

  // Convert the audio to mono 16k WAV (LINEAR16) for best STT accuracy.
  const normalizedBuffer = convertToLinear16Mono(media.data, media.mimetype);
  const audioBytes = normalizedBuffer.toString('base64');

  const request = {
    audio: {
      content: audioBytes,
    },
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: process.env.SPEECH_LANGUAGE_CODE || 'en-US',
      //alternativeLanguageCodes: ['ms-MY', 'zh-CN'],
      speechContexts: [
        {
          phrases: [
            'pos malaysia', 'pdrm', 'bank negara', 'shopee', 'lazada', 'tiktok',
            'transfer', 'rekening', 'rm', 'scam', 'job scam', 'work from home',
          ],
          boost: 15,
        },
      ],
      enableAutomaticPunctuation: true,
      audioChannelCount: 1,
      model: 'default',
    },
  };

  const [response] = await client.recognize(request);
  if (!response || !Array.isArray(response.results) || response.results.length === 0) {
    return '';
  }

  const transcripts = response.results
    .map((r) => (r.alternatives && r.alternatives[0] ? r.alternatives[0].transcript : ''))
    .filter(Boolean);

  return transcripts.join(' ').trim();
}

module.exports = { transcribeAudio };
