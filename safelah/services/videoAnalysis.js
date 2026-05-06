/**
 * services/videoAnalysis.js
 * Core video analysis pipeline for SafeLah
 *
 * Pipeline:
 *   Step 1 — Ingest (file → GCS or URL → yt-dlp → GCS)
 *   Step 2 — Audio extraction (ffmpeg) → Speech-to-Text → Scam intent (Gemini)
 *   Step 3 — Deepfake / AI-generated detection (Gemini multimodal via GCS URI)
 *   Steps 2+3 run concurrently via Promise.all
 *   Step 4 — Combined verdict synthesis (Gemini)
 *   Step 5 — Cleanup temp files
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Storage } = require('@google-cloud/storage');

// ── Client initialisation ─────────────────────────────────────────────────────
// On Cloud Run, ADC (Application Default Credentials) is automatic —
// do NOT set GOOGLE_APPLICATION_CREDENTIALS to a file path in Cloud Run env vars.
// Locally: set GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json in .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const gcs   = new Storage();

const BUCKET      = process.env.GOOGLE_CLOUD_BUCKET;
const GCP_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const GCP_REGION  = process.env.GOOGLE_CLOUD_REGION || 'us-central1';

// Try to find ffmpeg / ffprobe / yt-dlp — prefer ffmpeg-static fallback
function findBinary(name) {
  if (name === 'ffmpeg') {
    try { return require('ffmpeg-static'); } catch (_) {}
  }
  return name; // fallback to system PATH
}

// yt-dlp can end up in non-PATH locations depending on how Python was installed
function findYtDlp() {
  const { execSync } = require('child_process');
  // Try direct call first
  try { execSync('yt-dlp --version', { stdio: 'ignore', timeout: 5000 }); return 'yt-dlp'; } catch (_) {}
  // Common Windows locations
  const candidates = [
    'C:\\Users\\ASUS\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\yt-dlp.exe',
    'C:\\Python311\\Scripts\\yt-dlp.exe',
    'C:\\Python312\\Scripts\\yt-dlp.exe',
    // Linux (Cloud Run)
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ];
  for (const c of candidates) {
    try { if (require('fs').existsSync(c)) { execSync(`"${c}" --version`, { stdio: 'ignore', timeout: 5000 }); return c; } } catch (_) {}
  }
  return 'yt-dlp'; // last resort
}

const FFMPEG  = findBinary('ffmpeg');
const FFPROBE = 'ffprobe';
const YT_DLP  = findYtDlp(); // resolves the actual path even if not on PATH
console.log(`[videoAnalysis] binaries — ffmpeg=${FFMPEG}, yt-dlp=${YT_DLP}`);

// ── Gemini model helper ──────────────────────────────────────────────────────
// Models confirmed available for this API key (v1 endpoint):
//   gemini-2.5-flash — analysis, scam intent, synthesis (fast + capable)
//   gemini-2.0-flash — audio transcription
function geminiModel(modelName = 'gemini-2.5-flash') {
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  });
}

// Safe JSON parse — strips any markdown fences Gemini might add
function safeParseJSON(raw) {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  return JSON.parse(cleaned);
}

// ── Step 1: Ingest ────────────────────────────────────────────────────────────
/**
 * Saves base64 video to temp file and uploads to GCS.
 * Returns { gcsUri, localPath, filename }
 */
async function ingestFromBase64(base64Data, originalName) {
  const ext      = path.extname(originalName || '').toLowerCase() || '.mp4';
  const uid      = crypto.randomUUID();
  const filename = `${uid}${ext}`;
  const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'safelah-vid-'));
  const localPath = path.join(tmpDir, filename);

  // Strip data-URL prefix if present
  const raw = base64Data.replace(/^data:[^;]+;base64,/, '');
  fs.writeFileSync(localPath, Buffer.from(raw, 'base64'));

  const gcsUri = await uploadToGCS(localPath, uid, filename);
  return { gcsUri, localPath, tmpDir, filename };
}

/**
 * Downloads video from URL using yt-dlp, uploads to GCS.
 * Returns { gcsUri, localPath, filename }
 */
async function ingestFromURL(videoUrl) {
  const uid    = crypto.randomUUID();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safelah-vid-'));
  const outTemplate = path.join(tmpDir, `${uid}.%(ext)s`);

  try {
    await execFileAsync(YT_DLP, [
      '--no-playlist',
      '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--output', outTemplate,
      '--quiet',
      videoUrl,
    ], { timeout: 120_000 });
  } catch (err) {
    throw new Error(`yt-dlp download failed: ${err.message}`);
  }

  // Find downloaded file
  const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(uid));
  if (!files.length) throw new Error('yt-dlp produced no output file');
  const filename  = files[0];
  const localPath = path.join(tmpDir, filename);

  const gcsUri = await uploadToGCS(localPath, uid, filename);
  return { gcsUri, localPath, tmpDir, filename };
}

/**
 * Upload local file to GCS.
 * GCS path: video-analysis/{uid}/{filename}
 */
async function uploadToGCS(localPath, uid, filename) {
  if (!BUCKET) throw new Error('GOOGLE_CLOUD_BUCKET env var not set');
  const destPath = `video-analysis/${uid}/${filename}`;
  await gcs.bucket(BUCKET).upload(localPath, { destination: destPath });
  console.log(`[videoAnalysis] GCS upload → gs://${BUCKET}/${destPath}`);
  return `gs://${BUCKET}/${destPath}`;
}

// ── Audio extraction ──────────────────────────────────────────────────────────
/**
 * Extract 16 kHz mono WAV from video using ffmpeg.
 * Handles AV1, h264, VP9, webm, mkv — any container yt-dlp produces.
 * Returns path to WAV file, or null if no audio track.
 */
async function extractAudio(videoPath, tmpDir) {
  const wavPath = path.join(tmpDir, 'audio.wav');
  try {
    // -map 0:a:0 — explicitly pick first audio stream (handles split AV+audio containers)
    // -ar 16000   — downsample to 16 kHz for STT
    // -ac 1       — mono
    await execFileAsync(FFMPEG, [
      '-y', '-i', videoPath,
      '-map', '0:a:0',
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-f', 'wav',
      wavPath,
    ], { timeout: 180_000 });
    const stat = fs.statSync(wavPath);
    if (stat.size < 1024) {
      console.warn('[videoAnalysis] WAV too small, likely no audio track');
      return null;
    }
    console.log(`[videoAnalysis] Audio extracted: ${(stat.size/1024/1024).toFixed(1)} MB`);
    return wavPath;
  } catch (err) {
    // If no audio stream, ffmpeg exits non-zero — that's expected, not a crash
    console.warn('[videoAnalysis] ffmpeg audio extract failed (may be silent video):', err.message.split('\n')[0]);
    return null;
  }
}

// ── ffprobe metadata ──────────────────────────────────────────────────────────
async function getVideoMetadata(videoPath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', videoPath,
    ], { timeout: 30_000 });
    const info = JSON.parse(stdout);
    const fmt  = info.format || {};
    const vstr = (info.streams || []).find(s => s.codec_type === 'video') || {};
    return {
      duration_s: parseFloat(fmt.duration) || null,
      size_bytes:  parseInt(fmt.size, 10)   || null,
      codec:       vstr.codec_name          || null,
      width:       vstr.width               || null,
      height:      vstr.height              || null,
      fps:         vstr.r_frame_rate        || null,
    };
  } catch (_) {
    return {};
  }
}

// ── Step 2: Transcript analysis ──────────────────────────────────────────────
// Primary: Gemini audio understanding (works in all regions, no extra API needed)
// Fallback: Cloud Speech-to-Text (optional, requires Speech API enabled)
async function analyseTranscript(wavPath, gcsUri) {
  let transcript = null;

  // ── Primary: Gemini audio transcription (Cloud Run safe, any region) ────────
  // Gemini 2.0 Flash handles audio natively via the Files API or inline data.
  // We read the WAV (16kHz mono, typically small) as base64 inline.
  try {
    const wavBuffer = fs.readFileSync(wavPath);
    const wavB64    = wavBuffer.toString('base64');
    const sizeMB    = (wavBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`[videoAnalysis] Gemini audio transcription — WAV size=${sizeMB} MB`);

    const model  = geminiModel('gemini-2.5-flash');
    const result = await model.generateContent([
      { inlineData: { mimeType: 'audio/wav', data: wavB64 } },
      `Transcribe every spoken word in this audio recording verbatim.
- Preserve the original language(s): Malay, English, Mandarin, Tamil, or mixed.
- If multiple speakers, separate lines with a dash (–).
- If inaudible, write [inaudible]. If silence only, write SILENCE.
- Output ONLY the raw transcript — no labels, no explanations.`,
    ]);
    const raw = result.response.text().trim();
    if (raw && raw !== 'SILENCE') transcript = raw;
    console.log(`[videoAnalysis] Gemini transcript: ${transcript?.length ?? 0} chars`);
  } catch (geminiErr) {
    console.warn('[videoAnalysis] Gemini audio transcription failed:', geminiErr.message);

    // ── Fallback: Cloud Speech-to-Text (requires Speech API enabled + correct region) ──
    // Note: Chirp model only available in us-central1. We use standard model here.
    try {
      const { SpeechClient } = require('@google-cloud/speech');
      const speechClient = new SpeechClient();

      const uid      = gcsUri.split('/')[3];
      const wavDest  = `video-analysis/${uid}/audio.wav`;
      await gcs.bucket(BUCKET).upload(wavPath, { destination: wavDest });
      const wavGcsUri = `gs://${BUCKET}/${wavDest}`;

      const [op] = await speechClient.longRunningRecognize({
        config: {
          languageCode: 'ms-MY',
          alternativeLanguageCodes: ['en-US', 'zh'],
          model: 'latest_long',          // available in all regions
          enableWordTimeOffsets: false,
          audioChannelCount: 1,
          sampleRateHertz:   16000,
          encoding:          'LINEAR16',
        },
        audio: { uri: wavGcsUri },
      });
      const [resp] = await op.promise();
      transcript = (resp.results || [])
        .map(r => r.alternatives?.[0]?.transcript || '')
        .join(' ')
        .trim() || null;
      console.log(`[videoAnalysis] Cloud STT transcript: ${transcript?.length ?? 0} chars`);
    } catch (sttErr) {
      console.warn('[videoAnalysis] Cloud STT fallback also failed:', sttErr.message);
    }
  }

  if (!transcript) {
    return {
      transcript: null,
      transcript_verdict: null,
      transcript_confidence: null,
      scam_indicators: [],
      transcript_explanation: 'No audio detected or transcription unavailable.',
    };
  }

  // Scam intent analysis on transcript
  const scamPrompt = `You are a scam detection analyst. Analyse this video transcript for scam indicators.
Detect: urgency manipulation, impersonation of institutions (banks, government, e-wallet, courier), 
requests for OTP or bank credentials, financial extraction (transfer, gift card, crypto), 
false prize or lottery claims, threats or fear tactics, suspicious URLs or phone numbers mentioned.
Focus on Malaysian scam patterns: Maybank, CIMB, LHDN, PDRM, Pos Laju, Shopee, Lazada, Touch n Go, DuitNow.

Transcript:
"""
${transcript}
"""

Return ONLY valid JSON with no markdown fences, no preamble:
{
  "transcript": "full transcript text",
  "transcript_verdict": "SAFE | SUSPICIOUS | SCAM",
  "transcript_confidence": 0-100,
  "scam_indicators": ["array of specific phrases or patterns found"],
  "transcript_explanation": "2-3 sentence plain English summary"
}`;

  try {
    const model  = geminiModel('gemini-2.5-flash');
    const result = await model.generateContent(scamPrompt);
    const parsed = safeParseJSON(result.response.text());
    // Ensure transcript is present
    parsed.transcript = parsed.transcript || transcript;
    return parsed;
  } catch (err) {
    console.error('[videoAnalysis] scam intent analysis failed:', err.message);
    return {
      transcript,
      transcript_verdict:     'SUSPICIOUS',
      transcript_confidence:  null,
      scam_indicators:        [],
      transcript_explanation: 'Transcript retrieved but scam analysis failed.',
    };
  }
}

// ── Upload video to Gemini Files API ────────────────────────────────────────
// The Gemini Developer API (API key) does NOT support GCS URIs in fileData.
// Files must be uploaded via the Files API and referenced by their upload URI.
async function uploadVideoToGeminiFiles(videoPath) {
  const { GoogleAIFileManager } = require('@google/generative-ai/server');
  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

  const mimeType = videoPath.endsWith('.webm') ? 'video/webm'
                 : videoPath.endsWith('.avi')  ? 'video/x-msvideo'
                 : videoPath.endsWith('.mov')  ? 'video/quicktime'
                 : 'video/mp4';

  console.log(`[videoAnalysis] Uploading to Gemini Files API: ${path.basename(videoPath)}`);
  const uploadResult = await fileManager.uploadFile(videoPath, {
    mimeType,
    displayName: path.basename(videoPath),
  });

  // Wait until the file is ACTIVE (processing)
  let file = uploadResult.file;
  while (file.state === 'PROCESSING') {
    await new Promise(r => setTimeout(r, 3000));
    file = await fileManager.getFile(file.name);
  }
  if (file.state !== 'ACTIVE') {
    throw new Error(`Gemini file upload failed: state=${file.state}`);
  }
  console.log(`[videoAnalysis] Gemini Files API ready: ${file.uri}`);
  return { fileUri: file.uri, mimeType, fileName: file.name, fileManager };
}

// ── Step 3: Deepfake / AI-generated visual detection ─────────────────────────
async function analyseVisual(localVideoPath, metadata) {
  const metaStr = JSON.stringify(metadata, null, 2);
  const deepfakePrompt = `You are a forensic media analyst specialising in detecting AI-generated and deepfake videos.
Examine this video carefully for signs of synthetic generation or face manipulation.
Check: facial boundary blending at hairline and neck, temporal consistency of face across frames,
unnatural eye blinking or reflection, lighting physics inconsistency between face and background,
lip-sync accuracy with speech, GAN noise patterns in skin texture, unnatural motion smoothness,
background warping near face edges, compression artifact patterns typical of face-swap models.
Also note: does the video appear to be fully AI-generated (e.g. Sora/Veo style), or is it a face-swap on a real video?
If no faces are detected, perform scene-level analysis only and note "No face detected — scene-level analysis only".

Video metadata:
${metaStr}

Return ONLY valid JSON with no markdown fences, no preamble:
{
  "visual_verdict": "REAL | LIKELY_FAKE | FAKE | AI_GENERATED",
  "visual_confidence": 0-100,
  "visual_signals": ["array of specific artifacts or observations"],
  "deepfake_type": "NONE | FACE_SWAP | FACE_REENACTMENT | FULLY_SYNTHETIC | UNKNOWN",
  "visual_explanation": "2-3 sentence plain English summary"
}`;

  let uploadedFile = null;
  try {
    // Upload via Gemini Files API (works with Developer API key, no Vertex AI needed)
    uploadedFile = await uploadVideoToGeminiFiles(localVideoPath);

    const model  = geminiModel('gemini-2.5-flash');
    const result = await model.generateContent([
      { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.fileUri } },
      deepfakePrompt,
    ]);
    return safeParseJSON(result.response.text());
  } catch (err) {
    console.error('[videoAnalysis] deepfake analysis failed:', err.message);
    return {
      visual_verdict:      null,
      visual_confidence:   null,
      visual_signals:      [],
      deepfake_type:       'UNKNOWN',
      visual_explanation:  'Visual analysis unavailable: ' + err.message,
    };
  }
}

// ── Step 4: Combined verdict ──────────────────────────────────────────────────
async function synthesisVerdict(transcriptResult, visualResult) {
  const synthesisPrompt = `Given these two analysis results from the same video:

Visual forensics:
${JSON.stringify(visualResult, null, 2)}

Transcript analysis:
${JSON.stringify(transcriptResult, null, 2)}

Synthesise a final scam risk verdict. A video can be dangerous even if visually real (scam script)
or visually fake but harmless (parody/art). Weight both signals.

Return ONLY valid JSON with no markdown fences, no preamble:
{
  "final_verdict": "SAFE | SUSPICIOUS | HIGH_RISK | SCAM",
  "final_risk_score": 0-100,
  "primary_threat": "VISUAL_MANIPULATION | SCAM_CONTENT | BOTH | NONE",
  "final_explanation": "3-4 sentence combined summary for a non-technical user",
  "recommended_action": "specific advice for the user e.g. do not share, report to NACSA, ignore"
}`;

  try {
    const model  = geminiModel();
    const result = await model.generateContent(synthesisPrompt);
    return safeParseJSON(result.response.text());
  } catch (err) {
    console.error('[videoAnalysis] synthesis failed:', err.message);
    // Build a basic fallback verdict from sub-results
    const isScam    = transcriptResult?.transcript_verdict === 'SCAM'
                   || visualResult?.visual_verdict === 'FAKE'
                   || visualResult?.visual_verdict === 'AI_GENERATED';
    const isSuspect = transcriptResult?.transcript_verdict === 'SUSPICIOUS'
                   || visualResult?.visual_verdict === 'LIKELY_FAKE';
    return {
      final_verdict:       isScam ? 'SCAM' : isSuspect ? 'SUSPICIOUS' : 'SAFE',
      final_risk_score:    isScam ? 85 : isSuspect ? 50 : 10,
      primary_threat:      'BOTH',
      final_explanation:   'Synthesis unavailable — partial results shown.',
      recommended_action:  'Review the visual and transcript details carefully.',
    };
  }
}

// ── Step 5: Cleanup ───────────────────────────────────────────────────────────
function cleanupTemp(tmpDir) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}

// Schedule GCS cleanup in 24 h (fire-and-forget)
function scheduleGCSDelete(gcsUri) {
  setTimeout(async () => {
    try {
      const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (!match) return;
      const [, bucket, filePath] = match;
      // Delete the whole folder (uid directory)
      const folder = filePath.split('/').slice(0, -1).join('/') + '/';
      const [files] = await gcs.bucket(bucket).getFiles({ prefix: folder });
      await Promise.all(files.map(f => f.delete().catch(() => {})));
      console.log(`[videoAnalysis] GCS cleanup: deleted ${files.length} files under ${folder}`);
    } catch (err) {
      console.warn('[videoAnalysis] GCS scheduled cleanup failed:', err.message);
    }
  }, 24 * 60 * 60 * 1000);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
/**
 * Analyse a single video.
 * @param {{ source: 'file'|'url', value: string, originalName?: string }} item
 * @returns {Promise<object>} Full analysis result
 */
async function analyseVideo(item) {
  let tmpDir    = null;
  let gcsUri    = null;
  let localPath = null;

  try {
    // ── Step 1: Ingest ──────────────────────────────────────────────────────
    if (item.source === 'url') {
      ({ gcsUri, localPath, tmpDir } = await ingestFromURL(item.value));
    } else if (item.source === 'localfile') {
      // File was already written to disk by the multipart parser (Cloud Run path)
      localPath = item.localPath;
      tmpDir    = item.tmpDir;
      const filename = path.basename(localPath);
      const uid      = filename.split('.')[0]; // uuid prefix
      gcsUri = await uploadToGCS(localPath, uid, path.basename(item.originalName || localPath));
    } else {
      // base64 or data-URL (local dev)
      ({ gcsUri, localPath, tmpDir } = await ingestFromBase64(item.value, item.originalName || 'video.mp4'));
    }

    // ── Metadata ────────────────────────────────────────────────────────────
    const metadata = await getVideoMetadata(localPath);

    // ── Audio extraction ────────────────────────────────────────────────────
    const wavPath = await extractAudio(localPath, tmpDir);

    // ── Steps 2 + 3 concurrently ────────────────────────────────────────────
    // Note: we keep localPath alive here for analyseVisual (Gemini Files API upload)
    // localPath is cleaned up by cleanupTemp(tmpDir) at Step 5
    const [transcriptResult, visualResult] = await Promise.all([
      wavPath
        ? analyseTranscript(wavPath, gcsUri)
        : Promise.resolve({
            transcript:             null,
            transcript_verdict:     null,
            transcript_confidence:  null,
            scam_indicators:        [],
            transcript_explanation: 'No audio track detected in video.',
          }),
      analyseVisual(localPath, metadata),
    ]);

    // ── Step 4: Combined verdict ────────────────────────────────────────────
    const verdictResult = await synthesisVerdict(transcriptResult, visualResult);

    // ── Step 5: Cleanup ─────────────────────────────────────────────────────
    cleanupTemp(tmpDir);
    scheduleGCSDelete(gcsUri);

    return {
      success: true,
      gcs_uri: gcsUri,
      metadata,
      transcript_analysis: transcriptResult,
      visual_analysis:     visualResult,
      ...verdictResult,
    };

  } catch (err) {
    console.error('[videoAnalysis] pipeline error:', err.message);
    if (tmpDir) cleanupTemp(tmpDir);
    return {
      success:            false,
      error:              err.message,
      transcript_analysis: null,
      visual_analysis:    null,
      final_verdict:      'SAFE',
      final_risk_score:   0,
      primary_threat:     'NONE',
      final_explanation:  `Analysis failed: ${err.message}`,
      recommended_action: 'Please try again or check your file/URL.',
    };
  }
}

module.exports = { analyseVideo };
