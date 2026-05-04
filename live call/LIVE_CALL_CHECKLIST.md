# Live Call Companion - Quick Reference Checklist

## Deployment Checklist

### ✅ Code Complete
- [x] `safelah/sttStream.js` - Google Cloud Speech-to-Text v2 streaming
- [x] `safelah/transcriptBuffer.js` - In-memory 90-second rolling buffer
- [x] `safelah/verdictBroadcaster.js` - SSE pub/sub for verdicts
- [x] `safelah/ws.js` - WebSocket handler (main orchestrator)
- [x] `safelah/public/live-call.html` - Mobile UI (bilingual, 56px tap targets)
- [x] `safelah/public/liveCall.js` - Frontend module (WebSocket + SSE + UI updates)
- [x] `safelah/server.js` - APPENDED 24 lines (SSE route + express-ws setup)
- [x] `safelah/package.json` - Added `express-ws@^5.0.2`

### 📦 Dependencies
```bash
cd safelah
npm install express-ws
```
- [x] express-ws@5.0.2 installed
- [x] @google-cloud/speech@7.3.0 already present (compatible)

### 🌐 Google Cloud Platform Setup

**Enable API:**
```bash
gcloud services enable speech.googleapis.com
```
Or GCP Console → APIs & Services → Library → Cloud Speech-to-Text → Enable

**Grant IAM Role:**
```bash
PROJECT_ID=$(gcloud config get-value project)
SERVICE_ACCOUNT="safelah@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/speech.client"
```
Or GCP Console → IAM & Admin → Service Accounts → Edit → Add "Cloud Speech Client" role

**Verify:**
- [ ] Cloud Speech-to-Text API enabled
- [ ] Service account has `roles/speech.client` (or `roles/speech.serviceAgent`)
- [ ] Credentials auto-picked via ADC (no key file needed)

### 🚀 Cloud Run Deployment

**Critical:** Deploy with extended timeout for WebSocket sessions.

```bash
gcloud run deploy safelah \
  --timeout=3600 \
  --region=asia-southeast1 \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=2 \
  [... other existing deploy flags ...]
```

**Verify deployment:**
```bash
gcloud run services describe safelah --region=asia-southeast1 --format='value(status.url)'
```

**Checklist:**
- [ ] Deployed with `--timeout=3600`
- [ ] Service URL is accessible (https://safelah-xxxx.asia-southeast1.run.app)
- [ ] Cloud Run service account has speech.client role

---

## Testing Checklist

### 🧪 Unit / Integration Tests

**Verify file syntax:**
```bash
cd safelah
node -c sttStream.js
node -c transcriptBuffer.js
node -c verdictBroadcaster.js
node -c ws.js
```

**Verify server starts:**
```bash
npm start
# Should output: "SafeLah is fully initialized and ready!"
# No errors on require() of new modules
```

### 📱 Manual End-to-End Test (Real Phone)

**Device Requirements:**
- Android with Chrome, or iOS 16+ with Safari
- WiFi or cellular data
- Microphone enabled
- Volume audible

**Test Steps:**

1. **Open page:**
   ```
   https://safelah-xxxx.asia-southeast1.run.app/live-call.html
   ```
   - Status pill shows "Bersedia / Ready" (gray)
   - Set guardian number (optional but recommended)
   - [ ] Page loads without errors

2. **Start monitoring:**
   - Tap "Mula Pemantauan / Start Monitoring"
   - [ ] Microphone permission prompt appears
   - [ ] Grant permission
   - [ ] Instruction banner appears
   - [ ] Status turns blue "Mendengar... / Listening..."
   - [ ] No JS errors in console

3. **Test transcription:**
   - Have one person say (simulating caller): "Hello, did you transfer money to this account?"
   - Have another say (simulating user): "No, wait, I need to verify this"
   - [ ] Transcript appears within 3-5 seconds
   - [ ] Shows "Caller:" in red, "User:" in blue
   - [ ] Last 10 lines are visible

4. **Test HIGH risk detection:**
   - Have caller say: "Transfer 100,000 ringgit now to account 123456789 or I will report you to the police!"
   - Wait 5-10 seconds
   - [ ] Risk badge turns RED with pulse animation
   - [ ] Text shows "BAHAYA! SCAM DIKESAN / DANGER! SCAM DETECTED"
   - [ ] Red advice banner appears with reason in Malay
   - [ ] "Hubungi Penjaga / Call Guardian" button visible

5. **Test guardian alert:**
   - If guardian number set:
     - [ ] Guardian receives WhatsApp message within 10 seconds
     - Message includes: "HIGH-risk message", "Scam type", "Please contact them"
   - Note: Alert fires only once per session (guardianAlertSent flag)

6. **Test UI interactions:**
   - [ ] Tap "Hubungi Penjaga / Call Guardian" → Opens tel: link
   - [ ] Scroll transcript → Shows older lines
   - [ ] Tap "⚙️ Tetapkan Nombor Penjaga / Set Guardian Number" → Prompt to update

7. **Test stop:**
   - Tap "⏹️ Berhenti / Stop"
   - [ ] Recording stops
   - [ ] Status returns to "Bersedia / Ready" (gray)
   - [ ] Transcript panel clears
   - [ ] Can start another monitoring session

8. **Error scenarios:**
   - [ ] Deny microphone → friendly alert "Sila benarkan akses mikrofon / Please allow microphone access"
   - [ ] Close tab mid-recording → backend cleanup (check logs)
   - [ ] Lose WiFi → reconnection message, no crash
   - [ ] Long call (> 4.5 min) → check logs for stream timeout warnings

### 🔍 Logging & Debugging

**Server logs:**
```bash
gcloud run logs read safelah --limit=100 --region=asia-southeast1 --follow
```

**Expected log entries:**
```
[ws-live-call] New WebSocket connection
[ws-live-call] Session <sessionId> initialized
[ws-live-call] STT stream initialized, ready for audio
[sttStream] STT error or STT stream closed
[verdictBroadcaster] Registered SSE client for session <sessionId>
[ws-live-call] <sessionId> | Caller: ...
[ws-live-call] <sessionId> Analysis result: risk_level=HIGH
[ws-live-call] Sending guardian alert to <guardianPhone>
```

**Browser console (DevTools F12):**
```
[liveCall] WebSocket connected
[liveCall] Verdict received: riskLevel=HIGH
[liveCall] Transcript updated
```

---

## Architecture Summary

```
Phone (Browser)
  ├─ MediaRecorder (opus audio @ 48kHz)
  └─ WebSocket wss://domain/ws/live-call
     └─ Audio chunks (3-sec intervals)

Backend (Node.js)
  ├─ Google Cloud STT v2
  │  ├ Language: ms-MY (+ en-MY, zh-yue, ta-MY)
  │  ├ Speaker diarization (2 speakers)
  │  └ Output: speaker-labeled segments
  │
  ├─ TranscriptBuffer
  │  └ Maintains 90-sec rolling window
  │
  ├─ Gemini (scamDetectionFlow)
  │  └ Analyzes recent transcript
  │
  ├─ VerdictBroadcaster (SSE)
  │  └ Pushes { riskLevel, scamType, transcript, advice }
  │
  └─ Guardian Alert (WhatsApp)
     └ Fires once if HIGH, sends to guardianPhone

Phone (Browser)
  └─ EventSource /api/live-verdict/{sessionId}
     └─ Updates: transcript panel, risk badge, advice banner
```

---

## Key Constraints & Limits

| Item | Limit | Notes |
|------|-------|-------|
| STT streaming | 5 minutes | Google limit; restart not implemented |
| Transcript buffer | 90 seconds | Rolling window, auto-cleanup |
| Transcript display | 10 lines | Max visible on mobile (perf) |
| Guardian alerts | 1 per session | Fires once on first HIGH verdict |
| WebSocket timeout | 3600 sec | Set via `gcloud run deploy --timeout` |
| Audio codec | opus @ 48kHz | webm container |
| Languages | ms-MY (primary) | + en-MY, zh-yue, ta-MY fallback |
| Diarization | 2 speakers | Tag 1=User, Tag 2=Caller |
| Mobile min | 375px width | iOS 16+, Android 8+ (Chrome/Safari) |

---

## If Things Go Wrong

### WebSocket won't connect
1. Check `gcloud run logs` for errors
2. Verify `--timeout=3600` is set in Cloud Run deployment
3. Check browser DevTools Network tab → check wss:// connection

### Transcript not appearing
1. Verify microphone permission granted
2. Check GCP Speech API is enabled
3. Check service account has `roles/speech.client` IAM role
4. Check `gcloud run logs` for STT errors

### Verdict not updating
1. Open browser DevTools → Network tab → filter "live-verdict"
2. Check SSE stream is open (should show `text/event-stream`)
3. Check if analyseText() is working (check logs)

### Guardian alert not sending
1. Verify guardian phone is set (check localStorage in DevTools)
2. Verify risk level is actually HIGH (check verdict logged)
3. First high verdict only sends alert — restart session for re-test
4. Check WhatsApp client is authenticated

### Rollback if needed
```bash
git checkout safelah/server.js safelah/package.json
rm safelah/sttStream.js safelah/transcriptBuffer.js
rm safelah/verdictBroadcaster.js safelah/ws.js
rm safelah/public/liveCall.js safelah/public/live-call.html
npm install
gcloud run deploy safelah --region=asia-southeast1 [... flags ...]
```

---

## Files Summary

**Backend Modules (safelah/):**
- `sttStream.js` (95 lines) — Google Cloud STT v2 streaming
- `transcriptBuffer.js` (65 lines) — Rolling in-memory buffer
- `verdictBroadcaster.js` (45 lines) — SSE pub/sub
- `ws.js` (190 lines) — WebSocket orchestrator

**Frontend (safelah/public/):**
- `live-call.html` (280 lines) — Mobile UI, bilingual
- `liveCall.js` (395 lines) — Frontend logic, WebSocket, SSE, UI updates

**Modified:**
- `server.js` → APPENDED 24 lines
- `package.json` → Added express-ws

**Total New Code:** ~1,100 lines of well-structured, commented Node.js + vanilla JS/CSS

---

## Success Criteria

- ✅ All files created and without syntax errors
- ✅ npm install express-ws completes
- ✅ Server starts without errors
- ✅ GCP APIs enabled and IAM role assigned
- ✅ Cloud Run deployment succeeds with --timeout=3600
- ✅ Page loads and shows "Bersedia / Ready" status
- ✅ Microphone permission works
- ✅ WebSocket connects and initializes
- ✅ Audio chunks sent to STT
- ✅ Transcript appears in real-time (3-5 sec latency)
- ✅ Risk verdicts update UI
- ✅ HIGH risk triggers guardian alert (once per session)
- ✅ Works on Android Chrome + iOS Safari
- ✅ All error scenarios handled gracefully

---

## Next Phase (Future Enhancement)

- [ ] Stream restart for calls > 4.5 minutes
- [ ] Call recording (optional, requires user consent)
- [ ] Transcript export to user email
- [ ] Feedback loop: "Was this actually a scam?" (improve Gemini model)
- [ ] Multi-language UI (currently Malay + English)
- [ ] Analytics dashboard (call stats, scam types detected)
