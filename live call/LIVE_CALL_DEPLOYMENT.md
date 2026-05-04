# SafeLah Live Call Companion - Deployment & Testing Guide

## Overview

This document provides step-by-step instructions for deploying and testing the "Live Call Companion" feature for SafeLah.

**What it does:**
- Real-time voice call monitoring during a scam call
- Google Cloud Speech-to-Text v2 transcription with speaker diarization
- Live scam analysis via existing Gemini pipeline
- Real-time risk verdicts sent to phone via SSE
- Automatic guardian alerts on HIGH risk (WhatsApp)

---

## Files Created

### Backend Modules (Node.js)
| File | Purpose |
|------|---------|
| `safelah/sttStream.js` | Google Cloud Speech-to-Text v2 streaming handler |
| `safelah/transcriptBuffer.js` | In-memory rolling transcript (90s window) |
| `safelah/verdictBroadcaster.js` | SSE pub/sub bridge for verdicts |
| `safelah/ws.js` | WebSocket handler orchestrating the pipeline |

### Frontend (HTML/CSS/JS)
| File | Purpose |
|------|---------|
| `safelah/public/live-call.html` | Mobile-optimized UI page |
| `safelah/public/liveCall.js` | Frontend module (audio, WebSocket, SSE, UI) |

### Server Changes
| Change | Details |
|--------|---------|
| `safelah/server.js` | APPENDED 24 lines at bottom (SSE route + express-ws setup) |
| `safelah/package.json` | Added `"express-ws": "^5.0.2"` dependency |

---

## Installation & Dependencies

### 1. Install new npm packages

```bash
cd safelah
npm install express-ws
```

Status: `@google-cloud/speech@^7.3.0` already in package.json (compatible with v6.0.0+ requirement).

### 2. Verify installed packages

```bash
npm ls | grep -E "(express-ws|@google-cloud/speech)"
```

Expected output:
```
├── express-ws@5.0.2
└── @google-cloud/speech@7.3.0
```

---

## Google Cloud Platform Setup

### 1. Enable the Cloud Speech-to-Text API

```bash
gcloud services enable speech.googleapis.com
```

Or via GCP Console:
- Go to **APIs & Services → Library**
- Search for "Cloud Speech-to-Text"
- Click **Enable**

### 2. Grant IAM Role to Cloud Run Service Account

```bash
PROJECT_ID=$(gcloud config get-value project)
SERVICE_ACCOUNT="safelah@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/speech.client"
```

Or via GCP Console:
- Go to **IAM & Admin → Service Accounts**
- Find your Cloud Run service account (e.g., `safelah@[PROJECT].iam.gserviceaccount.com`)
- Click **Edit**
- Add Role: **Cloud Speech Client** (or broader: **Cloud Speech-to-Text Service Agent**)
- Save

### 3. Verify Credentials Setup

The app uses Application Default Credentials (ADC). No key file needed on Cloud Run.

```bash
# Verify service account has correct role
gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --format="table(bindings.role)" \
  --filter="bindings.members:$SERVICE_ACCOUNT"
```

---

## Cloud Run Deployment

### Deploy with Extended Timeout

WebSocket connections for long calls need extended timeout (default 300s is too short).

```bash
gcloud run deploy safelah \
  --timeout=3600 \
  --region=asia-southeast1 \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=2 \
  [... other existing deploy flags ...]
```

**Key flags:**
- `--timeout=3600` → 1-hour timeout for long calls (required for WebSocket)
- Other flags: match your existing deployment config

### Verify Deployment

```bash
# Get the service URL
gcloud run services describe safelah --region=asia-southeast1 --format='value(status.url)'

# Example output:
# https://safelah-xxxxx.asia-southeast1.run.app
```

---

## Architecture Overview

### Pipeline Flow

```
📱 Phone (Browser)
    ↓ [getUserMedia]
    ↓ [MediaRecorder → opus chunks]
    ↓ WebSocket /ws/live-call
    ↓
🖥️ Backend (Node.js)
    ├→ Google Cloud STT v2 (streaming)
    │  ├ Audio encoding: webm/opus @ 48kHz
    │  ├ Language: ms-MY (+ en-MY, zh-yue, ta-MY fallback)
    │  ├ Speaker diarization: 2 speakers
    │  └ Output: "User: [text]" + "Caller: [text]"
    │
    ├→ Transcript Buffer
    │  └ Maintains last 90 seconds
    │
    ├→ Gemini Analysis (existing scamDetectionFlow)
    │  ├ Input: recent transcript
    │  └ Output: { risk_level, scam_type, reason_bm, reason_en }
    │
    ├→ Verdict Broadcaster (SSE)
    │  └ Pushes { riskLevel, scamType, transcript, advice }
    │
    └→ Guardian Alert (on HIGH)
       └ Calls notifyGuardians() → WhatsApp alert
    ↓ SSE /api/live-verdict/{sessionId}
    ↓
📱 Phone (Browser)
    └ EventSource listens for updates
    └ Updates UI: transcript, risk badge, advice
```

---

## Frontend Usage

### Access the Page

```
https://safelah-xxxxx.asia-southeast1.run.app/live-call.html
```

### User Flow

1. **Page loads**
   - Status: "Bersedia / Ready" (gray)
   - Optional: user sets guardian number via "Tetapkan Nombor Penjaga / Set Guardian Number"

2. **Tap "Mula Pemantauan / Start Monitoring"**
   - Request microphone permission
   - Banner: "Letakkan telefon dalam mod pembesar suara sekarang / Put your phone on speaker now"
   - Status: "Mendengar... / Listening..." (blue)
   - WebSocket connects, initializes STT stream
   - MediaRecorder starts (3-sec chunks)

3. **During call**
   - Transcript panel shows live "Caller:" (red) and "User:" (blue) segments
   - Risk badge updates as verdicts arrive
   - Max 10 lines visible in transcript panel
   - Auto-scrolls to newest text

4. **Risk Levels**
   - **SAFE / LOW** → Green badge, "Selamat / Safe"
   - **MEDIUM** → Yellow badge, "Syak Wasangka / Suspicious" + advice shown
   - **HIGH** → Red pulsing badge, "BAHAYA! SCAM DIKESAN / DANGER! SCAM DETECTED"
     - Large red advice banner
     - "Hubungi Penjaga / Call Guardian" button (tel: link)

5. **Tap "Berhenti / Stop"**
   - MediaRecorder stops
   - WebSocket closes
   - SSE closes
   - Screen wake lock released
   - UI returns to idle state

---

## Testing Checklist

### Local Testing (Development)

Run locally first before deploying:

```bash
cd safelah

# Install dependencies
npm install

# Set env variables (check .env)
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
export SESSION_SECRET=your-dev-secret

# Start server
npm start

# Access at http://localhost:3000/live-call.html
# Note: getUserMedia() will fail without HTTPS/localhost exception
```

### End-to-End Testing on Cloud Run

#### Prerequisites
- Android phone with Chrome, or iOS 16+ with Safari
- WiFi or mobile data
- Guardian phone number set (optional but recommended)

#### Step 1: Verify Infrastructure
```bash
# Ensure Cloud Run service is up
curl https://safelah-xxxxx.asia-southeast1.run.app/

# Should get a 200 response
```

#### Step 2: Access the Page
- Open https://safelah-xxxxx.asia-southeast1.run.app/live-call.html
- Should load with gray "Bersedia / Ready" status
- Set a guardian number (tap the button)

#### Step 3: Initiate Test Call
1. Tap "Mula Pemantauan / Start Monitoring"
2. **Grant microphone permission** when prompted (critical!)
3. Banner appears: "Letakkan telefon dalam mod pembesar suara sekarang"
4. Status turns blue: "Mendengar... / Listening..."
5. **Wait 2-3 seconds for WebSocket & STT to initialize**

#### Step 4: Verify Audio & Transcription
1. **Speak a test phrase:**
   - Caller side: "Hello, I'm calling about your bank account. Did you transfer money today?"
   - User side: "Eh? Who is this? I don't recognize this number."
2. **Check transcript panel:**
   - Should show within ~3-5 seconds: "Caller: Hello I'm calling..." and "User: Eh Who is this..."
   - If not appearing: check browser console for WebSocket errors

#### Step 5: Test Risk Detection
1. **Simulate a HIGH-risk message** (or read an actual scam message):
   - Caller: "Transfer 50,000 ringgit to this account number 1234567890 immediately or your son is in trouble"
   - User: "No wait, I need to call my son first"
2. **Expect within 5-10 seconds:**
   - Risk badge turns **red with pulse animation**
   - Text: "BAHAYA! SCAM DIKESAN / DANGER! SCAM DETECTED"
   - Red advice banner appears with reason (Malay)
   - Guardian alert fires: check if guardian receives WhatsApp (if set)

#### Step 6: Test UI Interactions
1. Tap "Hubungi Penjaga / Call Guardian" → should dial tel: link
2. Scroll transcript panel → should show last 10 lines
3. Tap "Berhenti / Stop" → recording stops, panel clears, status → gray

#### Step 7: Test Error Handling
1. **Deny microphone permission** → friendly alert appears
2. **Close tab during recording** → backend cleanup (WebSocket close)
3. **Lose WiFi mid-call** → reconnection message, does not crash
4. **Call lasts > 4.5 min** → (Known limitation) log a ticket to restart STT stream

---

## Monitoring & Troubleshooting

### Enable Debug Logging

In `ws.js` and `liveCall.js`, all major events are logged with `[ws-live-call]` and `[liveCall]` prefixes.

**Server logs:**
```bash
gcloud run logs read safelah --limit=50 --region=asia-southeast1
```

**Browser console:**
- Open DevTools (F12)
- Logs will show WebSocket, STT, and verdict updates

### Common Issues

#### WebSocket fails to connect
- ✓ Verify Cloud Run URL is correct (https://)
- ✓ Check IAM role assigned to service account
- ✓ Check timeout flag in deploy: `--timeout=3600`
- ✓ Check browser console for CORS or connection errors

#### No transcript appearing
- ✓ Microphone permission granted?
- ✓ Audio actually being captured? (check system volume)
- ✓ STT service enabled in GCP?
- ✓ Service account has `roles/speech.client` IAM role?
- ✓ Check `gcloud run logs` for STT errors

#### Verdicts not updating
- ✓ SSE connection active? Check `/api/live-verdict/{sessionId}` in network tab
- ✓ Is `analyseText()` being called? Check logs for analysis result
- ✓ Is Gemini API accessible? (existing feature, already tested)

#### Guardian alert not sent
- ✓ Guardian phone set on page? (localStorage)
- ✓ Risk level actually HIGH (not MEDIUM)?
- ✓ First HIGH verdict only sends alert (guardianAlertSent flag)
- ✓ Check if WhatsApp client is initialized and authenticated

#### Browser crashes or freezes on mobile
- ✓ Transcript panel auto-scrolls every verdict: might be resource-intensive on low-end phones
- ✓ Limit: keeping only 10 lines in DOM should help
- ✓ Test on Android 8+ or iOS 16+

---

## Important Notes

### STT Streaming Timeout
- Google Cloud STT streaming sessions have a **5-minute hard limit**
- Current implementation does not handle stream restart
- For calls > 4.5 minutes: implement stream restart logic at higher level
- Commented in `sttStream.js` — add TODO for future versions

### Speaker Diarization
- Tag 1 = first speaker heard (usually the elder answering) → labeled "User"
- Tag 2 = second speaker heard (usually the scammer) → labeled "Caller"
- If only one speaker detected, STT returns single tag → labeled "Unknown"
- Frontend displays with color coding: "User:" in blue, "Caller:" in red

### Transcript Buffer
- Keeps last **90 seconds** of conversation
- Helps Gemini understand context for better scam detection
- Cleared when WebSocket closes
- No database writes — fully in-memory

### Guardian Alerts
- Fires **once per session** via existing `notifyGuardians()` function
- Uses WhatsApp (existing integration)
- Only on HIGH risk
- Flag: `guardianAlertSent` prevents duplicate sends

### HTTPS Requirement
- `getUserMedia()` requires HTTPS (or localhost)
- Cloud Run provides HTTPS by default — no action needed

---

## Rollback

If issues arise:

```bash
# Revert to previous version of safelah service
gcloud run deploy safelah --source .  # Re-deploys without the new code

# Or manually remove new files:
rm safelah/sttStream.js
rm safelah/transcriptBuffer.js
rm safelah/verdictBroadcaster.js
rm safelah/ws.js
rm safelah/public/liveCall.js
rm safelah/public/live-call.html

# Revert package.json and server.js changes (git checkout or manual edit)
git checkout safelah/package.json safelah/server.js
npm install
```

---

## Summary

✅ **All files created**
- 4 backend modules (STT, buffer, broadcaster, WebSocket)
- 2 frontend files (HTML + JS)
- 1 server route + initialization

✅ **Dependencies installed**
- express-ws@5.0.2

✅ **Ready for deployment**
1. Enable Cloud Speech-to-Text API in GCP
2. Grant IAM role to service account
3. Deploy with `--timeout=3600`
4. Test with real phone

🎯 **Next Steps**
1. Complete GCP setup (API + IAM)
2. Deploy to Cloud Run with extended timeout
3. Test on Android/iOS devices
4. Monitor logs for any issues
5. Iterate and refine based on user feedback
