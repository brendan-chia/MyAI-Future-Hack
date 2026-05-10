## High-Level Project Structure

```text
.
├── README.md
├── q&a.md
├── package.json
├── safelah/
│   ├── server.js                 # Express server
│   ├── sessionManager.js          # User sessions
│   ├── guardian.js                # Guardian alerts
│   ├── connection.js              # Database connection
│   ├── queries.js                 # Query builder
│   ├── verdictBuilder.js          # Response formatting
│   ├── keywordFallback.js         # Pattern matching
│   ├── messageExtractor.js        # Entity extraction
│   ├── public/
│   │   ├── index.html             # Main chat UI
│   │   ├── live-call.html         # Live call monitoring UI
│   │   ├── auth.html              # Authentication UI
│   │   ├── chat.js                # Chat logic
│   │   ├── liveCall.js            # Live call logic
│   │   └── videoAnalysis.js       # Video analysis UI
│   ├── services/
│   │   ├── gemini.js              # Gemini integration
│   │   ├── text.js                # Text analysis
│   │   ├── image.js               # Image analysis (Vision API)
│   │   ├── audio.js               # Audio preprocessing
│   │   ├── speech.js              # Speech-to-Text
│   │   ├── videoAnalysis.js       # Video frame analysis
│   │   ├── vertexSearch.js        # Vertex AI Search
│   │   └── guardian.js            # Guardian notifications
│   ├── routes/
│   │   └── videoRoutes.js         # Video API routes
│   ├── live call/
│   │   ├── sttStream.js           # Speech-to-Text streaming
│   │   ├── transcriptBuffer.js    # Transcript buffer
│   │   ├── verdictBroadcaster.js  # SSE verdict broadcasting
│   │   └── ws.js                  # WebSocket orchestration
│   ├── external integration/
│   │   └── virustotal.js          # VirusTotal API
│   ├── package.json
│   ├── Dockerfile
│   ├── cloudbuild.yaml
│   └── .env.example
├── live call/
│   ├── DELIVERY_SUMMARY.md
│   ├── LIVE_CALL_DEPLOYMENT.md
│   ├── FINAL_CHECKLIST.md
│   └── LIVE_CALL_CHECKLIST.md
├── skills/
│   ├── SKILL.md
│   └── design-system-library/
├── scrape/                        # Data collection (archived)
└── video sample/                  # Sample media assets
```

## Main API Endpoints

**Text & Batch Analysis**
- `POST /api/analyse` - Analyze text message
- `POST /api/analyse-batch` - Analyze multi-message conversation

**Image & Video Analysis**
- `POST /api/analyse-image` - Analyze screenshot/image for scams
- `POST /routes/video/*` - Dedicated video analysis endpoints

**Audio Analysis**
- `POST /api/analyse-audio` - Analyze audio/voice input

**Real-Time Monitoring**
- `WS wss://domain/ws/live-call` - WebSocket for live call monitoring
- `GET /api/events` - Server-Sent Events for guardian alerts

**Query & System**
- `POST /api/flow` - Direct Genkit flow execution
- `POST /api/search` - Vertex AI Search query
- `GET /health` - Service and integration status
