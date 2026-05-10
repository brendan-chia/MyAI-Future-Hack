# SafeLah: AI Scam Detection Web UI

SafeLah is an AI-powered Web UI that helps Malaysian users detect scam messages quickly.

It combines Gemini analysis, Vertex AI Search enrichment, and URL threat scanning to produce clear, bilingual scam verdicts.

## Live Deployment

- Cloud Run URL: https://safelah-231817059352.asia-southeast1.run.app

## Development Note

- Developed using Antigravity.

## Repository Overview

This repository has two main parts:

- `safelah/`: Main product (Web UI + API + analysis pipeline)
- `scrape/`: Supporting data collection artifacts and scripts

## What SafeLah Does

- **Detects scam risk** from text, screenshots, audio, and batch conversations
- **Monitors phone calls in real-time** with **live scam detection**
- **Analyzes video frames** from screen recordings or video messages
- **Classifies likely scam type** (Macau, phishing, job scam, investment scam, etc.)
- **Extracts phone numbers, bank accounts, and URLs** from user input
- **Cross-checks indicators** against:
  - **Vertex AI Search** knowledge base
  - **VirusTotal** URL reputation
- **Escalates risk level** when external signals confirm suspicious indicators
- **Sends verdicts** in English/Bahasa Melayu
- **Supports family/guardian alerts** for risky cases
- **Allows users to report scams** (phone numbers, URLs, screenshots) — reports are **fed directly into the Vertex AI Search datastore** to enrich detection for all users

## Core Architecture

1. Input enters the Web UI/API (`/api/analyse`, `/api/analyse-image`, `/api/analyse-audio`, `/api/analyse-batch`, `/api/flow`)
2. Pre-processing extracts entities and applies keyword fallback for fast high-risk short-circuiting
3. Gemini model performs semantic scam analysis when needed
4. Enrichment layer runs Vertex AI Search (+ VirusTotal for URLs)
5. Verdict builder composes final bilingual user-safe response
6. Optional guardian alert is triggered for high-risk findings

## Genkit Flow (How It Works)

SafeLah uses a Genkit flow named `scamDetectionFlow` to coordinate the text analysis pipeline.

Flow stages:

1. **Layer 1: Offline pre-filter**
	- Entity extraction (`phones`, `accounts`, `urls`)
	- Keyword-based risk pre-check

2. **Layer 2: Fast short-circuit**
	- If keyword fallback confidently flags `HIGH`, return immediately

3. **Layer 3: Gemini reasoning**
	- Uses Gemini with structured JSON schema output
	- Returns risk level, scam type, confidence, reasons, and extracted indicators

4. **Layer 4: Signal aggregation**
	- Queries Vertex AI Search for enhanced context
	- Scans URL with VirusTotal when a link exists
	- Escalates risk level when corroborating evidence is found

This flow is exposed directly through `POST /api/flow` and is reused by standard analysis routes.

## Vertex AI Search Usage

SafeLah integrates Vertex AI Search through Discovery Engine (`@google-cloud/discoveryengine`) as an enrichment source.

- The app queries Vertex AI Search for phone numbers, bank accounts, and URLs.
- Search config is built from:
  - `VERTEX_PROJECT_ID`
  - `VERTEX_LOCATION`
  - `VERTEX_ENGINE_ID` (preferred)
  - `VERTEX_DATASTORE_ID` (fallback path)
- Results are normalized into:
  - `found`
  - `hits`
  - `results`
- A lightweight in-memory cache reduces repeated lookups.
- If Vertex is unavailable, the system degrades gracefully without crashing.

Risk escalation logic example:

- If Vertex finds matching scam records and current risk is `LOW`, promote to `MEDIUM`.
- If Vertex returns high hit counts (for example, `>= 3`), promote to `HIGH`.

There is also a dedicated API endpoint:

- `POST /api/search` for manual/query-based Vertex lookup.

## Live Call Companion 🎤

The **Live Call Companion** enables real-time scam detection during phone calls:

### How It Works
1. **Audio Capture**: Browser captures phone audio via getUserMedia() API
2. **WebSocket Stream**: Audio streamed to backend via WebSocket (`wss://domain/ws/live-call`)
3. **Speech Recognition**: Google Cloud Speech-to-Text v2 with speaker diarization
4. **Real-Time Transcription**: Transcripts separated by speaker ("User:" / "Caller:")
5. **Rolling Analysis**: 90-second transcript buffer continuously analyzed
6. **Instant Verdict**: Gemini scam detection on transcript chunks
7. **Live Alerts**: Results broadcast via Server-Sent Events (SSE) to browser

### Features
- **Speaker Diarization**: Automatically identifies who is speaking
- **Multilingual**: Malay (ms-MY) primary, with English, Mandarin, Tamil fallbacks
- **Non-intrusive**: Alerts shown in browser, not intercepting call
- **Bilingual Verdicts**: Results in English and Bahasa Melayu
- **Mobile Optimized**: Works on smartphones during active calls

### Backend Components
| File | Purpose |
|------|----------|
| `safelah/live call/sttStream.js` | Google Cloud Speech-to-Text v2 streaming client |
| `safelah/live call/transcriptBuffer.js` | 90-second rolling transcript storage |
| `safelah/live call/verdictBroadcaster.js` | SSE pub/sub bridge for alerts |
| `safelah/live call/ws.js` | WebSocket orchestration |

### Frontend Components
| File | Purpose |
|------|----------|
| `safelah/public/live-call.html` | Mobile UI for live call monitoring |
| `safelah/public/liveCall.js` | WebSocket, SSE, audio capture logic |

### API Endpoint
- `WS wss://domain/ws/live-call` - WebSocket for audio streaming and verdict reception
- `GET /api/events` - SSE endpoint for guardian alerts

## Video Analysis 🎥

The **Video Analysis** feature detects scams in video frames and video messages:

### Capabilities
- **Frame Extraction**: Analyzes key frames from video files
- **Text Detection**: Uses Google Cloud Vision to extract on-screen text
- **Visual Fraud Detection**: Identifies:
  - Fake government logos and seals
  - Countdown timers and urgency banners
  - Bank/payment platform impersonation
  - Professional vs. amateur design quality
  - Suspicious UI elements
- **Integrated Analysis**: Extracted text flows through Gemini scam detection
- **Confidence Scoring**: Enhanced confidence based on visual indicators

### Supported Input
- Screenshot images (PNG, JPG)
- Video files (MP4, WebM, MOV)
- Screen recordings
- Video messages from messaging apps

### Backend Components
| File | Purpose |
|------|----------|
| `safelah/services/videoAnalysis.js` | Video frame extraction and processing |
| `safelah/services/image.js` | Google Cloud Vision integration |
| `safelah/routes/videoRoutes.js` | Video analysis API endpoints |

### Frontend
- `safelah/public/videoAnalysis.js` - Video frame capture and UI logic

### API Endpoints
- `POST /api/analyse-image` - Analyze screenshot/image for scams
- `POST /api/flow` - Full pipeline including video analysis
- `POST /routes/video/*` - Dedicated video analysis endpoints

## Quick Start (Local)

```bash
cd safelah
npm install
copy .env.example .env
```

Set required variables in `.env`:

```bash
GEMINI_API_KEY=your_gemini_key
VIRUSTOTAL_API_KEY=optional
VERTEX_PROJECT_ID=your_gcp_project
VERTEX_LOCATION=global
VERTEX_ENGINE_ID=your_vertex_engine
VERTEX_DATASTORE_ID=optional_fallback_datastore
PORT=3000
DB_PATH=./selamatlah.db
```

Run:

```bash
npm run dev
# or
npm start
```

## Tech Stack

- Node.js + Express Web server
- Genkit flow orchestration
- Google Gemini models
- Vertex AI Search (Discovery Engine)
- SQLite (`sql.js`) for local app data
- VirusTotal URL scanning
- Web frontend in `safelah/public/`

## Google AI Ecosystem Stack

SafeLah is built entirely on the Google AI and Cloud ecosystem. The following Google services power the core detection pipeline:

### 🤖 Google AI / Gemini

| Service | Package | Usage |
|---------|---------|-------|
| **Gemini 2.5 Flash** | `@google/generative-ai` | Primary scam detection model — structured JSON reasoning, scam type classification, confidence scoring, bilingual verdict generation |
| **Gemini 2.5 Flash** | `@google/generative-ai` | Audio transcription — natively decodes WAV audio inline for speech-to-text during video analysis |
| **Gemini 2.5 Flash** | `@google/generative-ai` | Deepfake / visual forensics — multimodal analysis of video frames for AI-generated content, face-swap detection |
| **Gemini 2.5 Flash** | `@google/generative-ai` | Scam intent analysis — analyses transcript text for Malaysian scam patterns (Maybank, LHDN, PDRM, etc.) |
| **Gemini Files API** | `@google/generative-ai/server` | Uploads video files to Gemini's Files API for multimodal video understanding and deepfake analysis |
| **Gemini 2.5 Flash** | `@google/generative-ai` | Live call transcript analysis — evaluates 90-second rolling call transcript windows for real-time scam signals |

### 🔍 Vertex AI

| Service | Package | Usage |
|---------|---------|-------|
| **Vertex AI Search** (Discovery Engine) | `@google-cloud/discoveryengine` | Enrichment knowledge base — cross-checks extracted phone numbers, bank accounts, and URLs against known scam records |
| **Vertex AI Search** | `@google-cloud/discoveryengine` | Community scam reporting — ingests user-submitted scam reports as documents into the Vertex AI datastore |

### 🎙️ Google Cloud Speech

| Service | Package | Usage |
|---------|---------|-------|
| **Cloud Speech-to-Text v2** | `@google-cloud/speech` | Live Call Companion — streams phone call audio via WebSocket and transcribes in real time with speaker diarization |
| **Cloud Speech-to-Text** | `@google-cloud/speech` | Video analysis fallback — used as a backup transcription service when Gemini audio transcription is unavailable |
| **Speaker Diarization** | `@google-cloud/speech` | Automatically separates "User" vs "Caller" speech in live call transcripts |
| **Multilingual STT** | `@google-cloud/speech` | Primary language: Malay (`ms-MY`); fallback: English (`en-US`), Mandarin (`zh`), Tamil |

### 🎬 Google Cloud Video Intelligence

| Service | Package | Usage |
|---------|---------|-------|
| **Video Intelligence API** | `@google-cloud/video-intelligence` | Frame-level analysis of video messages and screen recordings for visual scam indicators (fake logos, countdown timers, payment platform impersonation) |

### 👁️ Google Cloud Vision

| Service | Package | Usage |
|---------|---------|-------|
| **Cloud Vision API** | `@google-cloud/vision` | OCR text extraction from screenshot images — feeds extracted on-screen text into the Gemini scam detection pipeline |
| **Text Detection** | `@google-cloud/vision` | Identifies suspicious UI elements: fake bank logos, government seals, urgency banners |

### 🗄️ Google Cloud Storage

| Service | Package | Usage |
|---------|---------|-------|
| **Cloud Storage (GCS)** | `@google-cloud/storage` | Temporary staging bucket for video files during analysis pipeline (`video-analysis/{uid}/`) |
| **GCS + Gemini Files API bridge** | `@google-cloud/storage` | Uploads extracted WAV audio to GCS for Cloud Speech-to-Text longRunningRecognize fallback |
| **Auto-cleanup** | `@google-cloud/storage` | Automatically deletes uploaded video files from GCS after 24 hours |

### ⚙️ Google Cloud Infrastructure

| Service | Usage |
|---------|-------|
| **Google Cloud Run** | Serverless container hosting — auto-scales the Node.js Express backend; uses Application Default Credentials (ADC) |
| **Google Cloud Build** | CI/CD pipeline defined in `cloudbuild.yaml` for automated container builds and deployments |
| **Application Default Credentials (ADC)** | Authentication strategy — automatic on Cloud Run, JSON key file locally via `GOOGLE_APPLICATION_CREDENTIALS` |

### 🔧 Google AI Frameworks & SDKs

| Framework | Package | Usage |
|-----------|---------|-------|
| **Firebase Genkit** | `genkit`, `@genkit-ai/google-genai` | Orchestrates the `scamDetectionFlow` — a multi-stage pipeline coordinating pre-filter → Gemini reasoning → Vertex enrichment → verdict |
| **Google AI Node.js SDK** | `@google/generative-ai` | Direct Gemini API access for image, audio, and text analysis outside the Genkit flow |

---








