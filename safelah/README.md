# SelamatLah 🛡️
**AI scam guardian for Malaysian WhatsApp users**

A WhatsApp bot that analyses suspicious messages using Google Gemini AI, cross-references PDRM's Semak Mule database, and alerts family guardians when elderly users check high-risk messages.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in your API keys (see below)
```

### 3. Get your API keys

| Key | Where to get it | Cost |
|-----|----------------|------|
| `GEMINI_API_KEY` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | Free |
| `VIRUSTOTAL_API_KEY` | [virustotal.com](https://www.virustotal.com) → Profile → API Key | Free (optional) |

### 4. Run the server
```bash
npm run dev          # development (auto-restarts on file change)
npm start            # production
```

The bot will display a QR code in the terminal that you need to scan with your WhatsApp account.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCAN THIS QR CODE WITH YOUR PHONE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ██████╗ ██████╗
  ██╔═══██╗██╔══██╗
  ██║   ██║██████╔╝
  ██║▄▄██║██╔══██╗
  ╚██████╔╝██║  ██║
   ╚═▀▀═══╝╚═╝  ╚═╝
```

### 5. Start using it
Once you scan the QR code, the bot will be logged in and ready to receive messages.

---

## Testing the Bot

Send these messages to your bot number:

| What to send | Expected response |
|-------------|------------------|
| Any message | Onboarding welcome (first time only) |
| `Tahniah! Anda menang RM5000! Klik: http://prize.xyz` | 🔴 HIGH RISK — Lucky Draw |
| `Ini PDRM, akaun anda dibekukan` | 🔴 HIGH RISK — Macau Scam |
| `Jom makan nasi lemak esok` | ✅ LOW RISK — Safe |
| `/bantuan` | Help menu |
| `/daftar` | Guardian registration code |
| `/jaga 123456` | Link as guardian |
| A screenshot of a scam message | 🔴 HIGH RISK (Gemini Vision) |

---

## How It Works

```
User forwards suspicious message to bot
          ↓
    Message router
    (dedup + rate limit)
          ↓
   ┌──────┴───────┐
  text           image
   ↓               ↓
Gemini AI      Gemini Vision
analysis       (OCR + analysis)
   ↓
CCID Semak Mule
(phone/bank check)
   ↓
VirusTotal
(URL scan)
   ↓
Build verdict (BM/EN/ZH/TA)
   ↓
Send to user
   ↓
HIGH RISK? → Alert guardians
   ↓
Log anonymously (community map)
```

---

## Guardian Network

1. Elderly user sends `/daftar` → receives 6-digit code
2. Child/family sends `/jaga [code]` → linked as guardian
3. When elderly checks a HIGH RISK message → guardian gets silent alert
4. Alert contains only: risk level, scam type, time (no message content)

---

## Scam Types Detected

| Code | Bahasa Malaysia | Description |
|------|----------------|-------------|
| `MACAU_SCAM` | Penipuan Macau | PDRM/BNM/LHDN impersonation |
| `LOVE_SCAM` | Penipuan Cinta | Romance scam |
| `INVESTMENT_SCAM` | Penipuan Pelaburan | Fake investment |
| `PARCEL_SCAM` | Penipuan Pos Laju | Fake courier |
| `JOB_SCAM` | Penipuan Kerja | Fake job |
| `LOAN_SCAM` | Penipuan Pinjaman | Upfront fee loan |
| `PHISHING_LINK` | Pautan Pancingan Data | Fake bank/gov URL |
| `LUCKY_DRAW` | Penipuan Cabutan Bertuah | Fake prize |
| `CRYPTO_SCAM` | Penipuan Kripto | Crypto fraud |

---

## Emergency Contacts (hardcoded in all HIGH risk responses)
- **Anti-Scam Hotline: 997** (8am–8pm daily)
- **PDRM CCID: 03-2610 1559**
- **CCID Semak Mule: semakmule.rmp.gov.my**
