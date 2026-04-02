# Safelah 🌏

A collection of digital tools and services for ASEAN youth communities.

## Projects

### SelamatLah 🛡️
**AI-powered WhatsApp scam detection bot for Malaysian users**

An intelligent bot that analyzes suspicious messages in real-time using Google Gemini AI, cross-references PDRM's Semak Mule database, and alerts family guardians when elderly users encounter high-risk messages.

**Directory:** `safelah/`

#### Quick Start

```bash
cd safelah
npm install
cp .env.example .env
# Add your GEMINI_API_KEY to .env
npm start
```

The bot will display a QR code — scan it with your WhatsApp account to authenticate. Once scanned, it will automatically receive and analyze messages.

#### Key Features

- **Real-time Analysis**: Analyzes text messages and screenshots using Gemini AI Vision
- **Scam Detection**: Identifies phishing, lottery scams, macau scams, and more
- **Database Cross-Reference**: Checks against PDRM's CCID Semak Mule database
- **URL Scanning**: Integrates with VirusTotal to detect malicious links
- **Family Protection**: Alerts guardians when elderly users receive high-risk messages
- **Multi-Language**: Supports Bahasa Melayu, English, Mandarin, and Tamil
- **Offline Fallback**: Keyword-based detection when AI is unavailable

#### Technology Stack

- **WhatsApp Integration**: whatsapp-web.js with QR code authentication
- **AI Analysis**: Google Gemini 2.0 Flash (text + vision)
- **Database**: SQLite (sql.js)
- **Server**: Express.js for web UI
- **Browser Automation**: Puppeteer (built into whatsapp-web.js)

#### API Endpoints

- `POST /api/analyse` — Analyze text for scams (web UI)
- `POST /api/analyse-image` — Analyze screenshots (web UI)
- `GET /health` — Health check

#### Environment Variables

```bash
GEMINI_API_KEY=your_google_gemini_api_key
VIRUSTOTAL_API_KEY=optional_virustotal_key
PORT=3000
DB_PATH=./selamatlah.db
```

#### Testing

Send these messages to your bot:

| Message | Expected Response |
|---------|------------------|
| Any message | Onboarding welcome (first time) |
| `Tahniah! Anda menang RM5000!` | 🔴 HIGH RISK — Lucky Draw |
| `Ini PDRM, akaun dibekukan` | 🔴 HIGH RISK — Macau Scam |
| `Jom makan nasi lemak` | ✅ LOW RISK — Safe |
| `/bantuan` | Help menu |
| `/daftar` | Register as guardian |
| Screenshot of scam | 🔴 HIGH RISK (AI Vision) |

#### Project Structure

```
safelah/
├── server.js              # Express server + WhatsApp event listener
├── whatsapp.js            # WhatsApp Web.js client setup
├── message.js             # Message routing & deduplication
├── text.js                # Text analysis pipeline
├── image.js               # Image/screenshot analysis
├── commands.js            # /bantuan /daftar /jaga handlers
├── guardian.js            # Guardian alert system
├── gemini.js              # Gemini API wrapper
├── semakmule.js           # CCID Semak Mule scraper
├── virustotal.js          # URL scanner
├── extractor.js           # Phone/account/URL extraction
├── language.js            # Language detection
├── verdictBuilder.js      # Multilingual verdict messages
├── keywordFallback.js     # Offline pattern matching
├── queries.js             # Database helpers
├── connection.js          # SQLite initialization
├── public/                # Web UI
│   ├── index.html
│   ├── chat.js
│   └── style.css
├── .env.example           # Environment template
├── .gitignore
├── Procfile              # Deployment config
└── package.json
```

#### Troubleshooting

**"Browser already running" error:**
```bash
taskkill /F /IM node.exe
taskkill /F /IM chrome.exe
rmdir /S /Q ".wwebjs_auth"
npm start
```

**API quota exceeded:**
- Free tier is limited. Upgrade your Gemini API plan or wait for quota reset.

**Messages not being received:**
- Ensure QR code was properly scanned
- Check WhatsApp app is installed on phone
- Verify WhatsApp Web isn't open elsewhere

---




