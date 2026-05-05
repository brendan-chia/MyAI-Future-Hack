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

- Detects scam risk from text, screenshots, audio, and batch conversations
- Classifies likely scam type (Macau, phishing, job scam, investment scam, etc.)
- Extracts phone numbers, bank accounts, and URLs from user input
- Cross-checks indicators against:
  - Vertex AI Search knowledge base
  - VirusTotal URL reputation
- Escalates risk level when external signals confirm suspicious indicators
- Sends verdicts in English/Bahasa Melayu
- Supports family/guardian alerts for risky cases

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

## Main API Endpoints

- `POST /api/analyse` - Analyze text
- `POST /api/analyse-image` - Analyze screenshot/image
- `POST /api/analyse-audio` - Analyze audio/voice input
- `POST /api/analyse-batch` - Analyze multi-message conversation
- `POST /api/flow` - Direct Genkit flow execution
- `POST /api/search` - Vertex AI Search query
- `GET /health` - Service and integration status

## High-Level Project Structure

```text
.
├── README.md
├── TEST_CONVERSATIONS.md
├── safelah/
│   ├── sessionManager.js
│   ├── guardian.js
│   ├── connection.js
│   ├── queries.js
│   ├── public/
│   └── package.json
└── scrape/
	 ├── scrape.py
	 ├── scam_phones.jsonl
	 └── scam_bank_accounts.jsonl
```

## Tech Stack

- Node.js + Express Web server
- Genkit flow orchestration
- Google Gemini models
- Vertex AI Search (Discovery Engine)
- SQLite (`sql.js`) for local app data
- VirusTotal URL scanning
- Web frontend in `safelah/public/`

## Safety and Reliability

- Fallback keyword model keeps detection available if AI call fails
- External services are optional and fail-soft
- Guardrail-oriented verdict wording for non-technical users
- Health endpoint exposes integration readiness (Gemini, Vertex, VirusTotal, WhatsApp)







