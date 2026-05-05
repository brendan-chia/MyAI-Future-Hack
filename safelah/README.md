# SafeLah 🛡️
**AI scam guardian for Malaysian users**

SafeLah is a web UI for analysing suspicious text, screenshots, audio, and multi-message conversations. It uses Google Gemini, Vertex AI Search, and VirusTotal to return a fast scam verdict when needed.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
copy .env.example .env
# Fill in your API keys and optional DB settings
```

### 3. Get your API keys

| Key | Where to get it | Cost |
|-----|-----------------|------|
| `GEMINI_API_KEY` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | Free |
| `VIRUSTOTAL_API_KEY` | [virustotal.com](https://www.virustotal.com) → Profile → API Key | Free (optional) |
| `VERTEX_PROJECT_ID` / `VERTEX_ENGINE_ID` | Google Cloud Vertex AI Search setup | Optional |

### 4. Run the app
```bash
npm run dev          # development (auto-restarts on file change)
npm start            # production
```

The web app is ready to use once the server is running.

### 5. Start using it
Once the server is running, you can use the web UI for analysis.

---

## Testing the App

Send these messages in the web UI:

| What to send | Expected response |
|--------------|------------------|
| Any message | Onboarding welcome (first time only) |
| `Tahniah! Anda menang RM5000! Klik: http://prize.xyz` | 🔴 High risk - Lucky Draw |
| `Ini PDRM, akaun anda dibekukan` | 🔴 High risk - Macau Scam |
| `Jom makan nasi lemak esok` | ✅ Low risk - Safe |
| `/help` | Help menu |
| `/register` | Guardian registration code |
| `/link 123456` | Link as guardian |
| A screenshot of a scam message | 🔴 High risk (Gemini Vision) |
| Voice note | Transcribed, then analysed |
| Multiple messages sent together | Batch conversation analysis |

---

## How It Works

```
User sends text, image, audio, or batch conversation
          ↓
    Router / API layer
    (dedup, rate limit, auth)
          ↓
   ┌──────┬────────┬────────┐
   text   image    audio    batch
    ↓       ↓        ↓        ↓
Gemini   Gemini   Gemini   Conversation
NLP      Vision   STT      analysis
    ↓       ↓        ↓        ↓
Entity extraction + keyword fallback
          ↓
Vertex AI Search + VirusTotal
          ↓
Verdict builder (English / Malay output)
          ↓
Send to user or web client
          ↓
High risk? → Alert guardians
          ↓
Log anonymised scam intelligence
```

---

## Guardian Network

1. User sends `/register` to get a 6-digit guardian code.
2. Family member sends `/link [code]` or `/family [code]` to become a guardian.
3. When a high-risk message is detected, the guardian receives a silent alert.
4. Alerts contain only risk level, scam type, and time, not the original message content.

---

## Scam Types Detected

| Code | English label | Description |
|------|---------------|-------------|
| `MACAU_SCAM` | Macau Scam | PDRM/BNM/LHDN impersonation |
| `LOVE_SCAM` | Love / Romance Scam | Romance scam |
| `INVESTMENT_SCAM` | Investment Scam | Fake investment |
| `PARCEL_SCAM` | Parcel / Courier Scam | Fake courier |
| `JOB_SCAM` | Job Scam | Fake job or task scam |
| `LOAN_SCAM` | Loan Scam | Upfront fee loan |
| `PHISHING_LINK` | Phishing Link | Fake bank/gov URL |
| `LUCKY_DRAW` | Fake Lucky Draw | Fake prize |
| `CRYPTO_SCAM` | Crypto Scam | Crypto fraud |

---

## Current Commands

Primary commands are English-first, with legacy aliases still supported:

- `/help` or `/bantuan`
- `/register` or `/daftar`
- `/link <code>` or `/family <code>` or `/jaga <code>`
- `/begin` or `/start` or `/mula`
- `/analyze` or `/scan` or `/analisis`
- `/stop` or `/batalkan`
- `/info` or `/status`

---

## Project Structure

```
safelah/
├── server.js              # Express server + API routes + WhatsApp startup
├── whatsapp.js            # WhatsApp Web.js client setup
├── message.js             # WhatsApp message router
├── text.js                # Shared scam analysis pipeline
├── image.js               # Screenshot analysis
├── audio.js               # Audio transcription + analysis
├── sessionManager.js      # Batch conversation analysis + clarification flow
├── commands.js            # Chat commands and batch mode handling
├── guardian.js            # Guardian alerts
├── gemini.js              # Gemini wrappers for text, image, conversation, audio
├── extractor.js           # Phone/account/URL extraction
├── verdictBuilder.js      # Final verdict formatting
├── keywordFallback.js     # Offline fallback classifier
├── queries.js             # Database helpers and logging
├── connection.js          # SQLite initialization and migrations
└── public/                # Web UI assets
```

---

## Troubleshooting

**Browser already running**
```bash
taskkill /F /IM node.exe
taskkill /F /IM chrome.exe
rmdir /S /Q ".wwebjs_auth"
npm start
```

**Messages not being received**
- Refresh the page and try again.
- Check that the server is running.
- Verify your API keys are configured correctly.

**API quota exceeded**
- Gemini and VirusTotal have free-tier limits. Wait for reset or upgrade the plan.

---

## Emergency Contacts

- **Anti-Scam Hotline: 997** (8am–8pm daily)
- **PDRM CCID: 03-2610 1559**

