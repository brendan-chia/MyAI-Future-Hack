const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const { genkit} = require('genkit');
const { googleAI } = require('@genkit-ai/google-genai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ai = genkit({
  plugins: [googleAI({ apiKey: process.env.GEMINI_API_KEY })],
});


// ── System instruction ───────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `You are SafeLah, a Malaysian scam detection AI. Analyse messages for scam indicators targeting Malaysian users.

⚠️ HIGHEST PRIORITY — FAMILY EMERGENCY SCAM (extremely common in Malaysia):
A scammer contacts you pretending to be a family member (child, sibling, relative) from a new/unknown number, saying their phone is spoilt/lost/broken. They then describe an emergency (accident, arrested, hospital, hit someone's car, police involved) and urgently request money to "settle" the problem privately — often asking you to keep it secret from other family members. This is ALWAYS a scam. Flag as HIGH risk whenever you see:
- New phone number + claim to be family member + emergency + money request
- "phone spoil/rosak/broken" + accident/police/arrest + pay/bayar/settle/RM amount
- Urgency + "don't tell papa/mama/anyone" + money request
- "Help me first" / "you help me first cannot" + financial amount

IMPORTANT: E-commerce task scams (JOB_SCAM) are EXTREMELY common in Malaysia right now. Messages recruiting people to "click orders", "write reviews", "boost ratings", or "complete tasks" for e-commerce platforms (Shopee, Lazada, TikTok Shop, Amazon, etc.) for unrealistic daily pay are ALWAYS HIGH RISK scams. Flag them aggressively.

Malaysian scam types:
- FAMILY_EMERGENCY_SCAM: Impersonating a family member from a new number, claiming accident/arrest/hospital emergency, requesting urgent money transfer, asking for secrecy. The tone may be polite and emotional — this does NOT make it less dangerous.
- MACAU_SCAM: Impersonating PDRM, BNM, LHDN, Jabatan Kastam, courts. Claims of money laundering, arrest warrants, frozen accounts. Demands money to "resolve" legal issues.
- LOVE_SCAM: Romantic interest from strangers, requests for money for emergencies, hospital bills, travel, "investment opportunities".
- INVESTMENT_SCAM: Guaranteed high returns, Shariah-compliant scams, Telegram/WhatsApp VIP groups, crypto/forex, celebrity endorsements, deposit to personal accounts.
- PARCEL_SCAM: Fake Pos Malaysia, J&T, DHL, Ninja Van. Customs clearance fees. Unexpected packages requiring payment.
- JOB_SCAM: This is one of the MOST COMMON scams in Malaysia. It includes ALL of these variants:
  (a) E-COMMERCE TASK SCAM (most prevalent): Recruiting to "click orders", "write/boost reviews", "complete tasks", "help merchants", "like products" on Shopee, Lazada, TikTok Shop, Amazon, etc. Offers unrealistic pay like RM150-500/day or RM3000-15000/month for simple clicking. Asks to add a "manager" or "supervisor" on WhatsApp. Often impersonates HR from real companies. Uses wa.me links or personal phone numbers for contact. THIS IS ALWAYS A SCAM — legitimate platforms NEVER recruit this way.
  (b) Work-from-home scam: High salary for minimal work, vague job descriptions.
  (c) Like/follow scam: Payment for liking social media posts, subscribing to YouTube channels.
  (d) Advance-fee job scam: Requires upfront deposit, registration fee, or "training fee" before starting.
  (e) Data entry/typing scam: Online typing jobs with unrealistic per-page rates.
  Key signals: Any message mentioning "part-time", "online workers", "kerja online", "kerja dari rumah" combined with high salary claims (RM200+/day) is almost certainly a scam.
- LOAN_SCAM: Upfront processing fee before disbursement. No credit check. Rates too good to be true.
- PHISHING_LINK: URLs mimicking Maybank2u, CIMB Clicks, RHB, Public Bank, MyEG, SSM, or other gov portals.
- LUCKY_DRAW: Fake prize wins, suspicious collection location or link, processing fee required.
- CRYPTO_SCAM: NFT investment, crypto platforms, DeFi groups.
- PAYMENT_SCAM: DuitNow QR codes with countdown timers presented as proof of payment — actually charging the victim.

Red flags (any = elevated risk):
- Urgency: "segera", "24 jam", "hari ini sahaja", "URGENT", "IMMEDIATELY", "rushing me"
- Authority: "PDRM", "polis", "mahkamah", "Bank Negara", "LHDN", "kastam", "lawyer", "peguam"
- Reward: "tahniah", "menang", "hadiah", "prize", "lucky draw", "congratulations"
- Secrecy: "jangan beritahu", "rahsia", "don't tell anyone", "jangan bagitau papa/mama"
- Money requests paired with unverified strangers: "transfer", "bank in", "bayar", "deposit", "settle"
- Shortened/suspicious URLs: bit.ly, tinyurl, random-string domains, non-.gov.my for official claims
- Job recruitment via WhatsApp: Unsolicited job offers via WhatsApp, asking to add manager number, wa.me links, personal contact for recruitment
- Unrealistic salary: RM200-500/day or RM3000-15000/month for simple online tasks
- E-commerce task language: "click orders", "write reviews", "boost ratings", "help merchants", "complete tasks", "like products", "online workers", "part time workers"
- Impersonating known companies: "HR from Shopee", "Lazada recruitment", "TikTok hiring", mentioning real company names in informal recruitment messages`;

// ── JSON response schema ─────────────────────────────────────────────────────
const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    risk_level:         { type: SchemaType.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
    scam_type:          { type: SchemaType.STRING, nullable: true },
    confidence:         { type: SchemaType.NUMBER },
    reason_bm:          { type: SchemaType.STRING },
    reason_en:          { type: SchemaType.STRING },
    extracted_phones:   { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    extracted_accounts: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    extracted_urls:     { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ['risk_level', 'confidence', 'reason_bm', 'reason_en',
             'extracted_phones', 'extracted_accounts', 'extracted_urls'],
};

// Safety settings — required: scam messages trigger Gemini's default filters
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

function getModel() {
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 1000,
      temperature: 0.1,
    },
  });
}

// ── Text analysis ─────────────────────────────────────────────────────────────
/**
 * @param {string}  text          — message text to analyse
 * @param {string}  [visualContext] — optional visual cues from image extraction
 * @param {number}  [retries=2]
 */
async function analyseWithGemini(text, visualContext = '', retries = 2) {
  let prompt = `Analyse this message for scam indicators:\n\n"${text}"`;

  if (visualContext) {
    prompt += `\n\nADDITIONAL VISUAL CONTEXT (from screenshot analysis):\n${visualContext}\n\nFactor these visual observations into your risk assessment. Fake logos, urgency banners, countdown timers, and government seals in unofficial messages are strong scam indicators.`;
  }

  for (let i = 0; i <= retries; i++) {
    try {
      const model = getModel();
      const result = await model.generateContent(prompt);
      const parsed = JSON.parse(result.response.text());
      console.log(`[gemini text] ✅ risk=${parsed.risk_level}, type=${parsed.scam_type}, conf=${parsed.confidence}`);
      return parsed;
    } catch (err) {
      console.error(`[gemini text] ❌ attempt ${i + 1} failed: ${err.message}`);
      if (i < retries) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null; // triggers keyword fallback
}

// ── Stage 1: Image text + visual cue extraction ──────────────────────────────
const EXTRACTION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    extracted_text: { type: SchemaType.STRING, description: 'All visible text from the image, transcribed verbatim' },
    phones:         { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Phone numbers visible in the image' },
    accounts:       { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Bank account numbers visible in the image' },
    urls:           { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'URLs / links visible in the image' },
    visual_cues:    { type: SchemaType.STRING, description: 'Description of visual elements: logos, seals, banners, countdown timers, colour schemes, urgency cues, anything indicating legitimacy or fraud' },
  },
  required: ['extracted_text', 'phones', 'accounts', 'urls', 'visual_cues'],
};

const EXTRACTION_PROMPT = `You are an OCR and visual analysis specialist. Your ONLY job is to extract information from this image — do NOT judge if it is a scam.

1. Extract ALL visible text from the image VERBATIM — every word, number, URL, heading, button text, watermark.
2. Extract any phone numbers visible (Malaysian format: 01X-XXXXXXX, +60XX, 03-XXXX XXXX, etc.).
3. Extract any bank account numbers (sequences of 10–16 digits).
4. Extract any URLs or links visible (including shortened links like bit.ly).
5. Describe visual elements that may indicate legitimacy OR fraud:
   - Official logos (PDRM, BNM, bank logos, government seals)
   - Urgency banners, countdown timers, flashing text
   - WhatsApp chat bubbles, SMS interface elements
   - Professional vs amateur design quality
   - Red/yellow warning colours, exclamation marks
   - QR codes

Be thorough — missing text means missing scam evidence.`;

/**
 * Stage 1 — Extract text and visual cues from an image (no scam judgement)
 */
async function extractTextFromImage(base64Image, mimeType = 'image/jpeg', retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: EXTRACTION_SCHEMA,
          maxOutputTokens: 1000,
          temperature: 0.1,
        },
      });
      const result = await model.generateContent([
        { inlineData: { mimeType, data: base64Image } },
        EXTRACTION_PROMPT,
      ]);
      const parsed = JSON.parse(result.response.text());
      console.log(`[gemini extract] extracted ${parsed.extracted_text?.length || 0} chars, ` +
        `${parsed.phones?.length || 0} phones, ${parsed.urls?.length || 0} urls`);
      return parsed;
    } catch (err) {
      console.error(`[gemini extract] attempt ${i + 1} failed:`, err.message);
      if (i < retries) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}

// ── Legacy single-pass image analysis (kept for backward-compat) ──────────────
async function analyseImageWithGemini(base64Image, mimeType = 'image/jpeg', retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const model = getModel(); // uses gemini-2.5-flash
      const result = await model.generateContent([
        { inlineData: { mimeType, data: base64Image } },
        'Analyse this screenshot for scam indicators. Extract any phone numbers, bank accounts, or URLs visible. Look for: fake prize/lottery notices, DuitNow QR codes used for scam payments, urgency banners, Amazon/Shopee gift card claims, government impersonation.',
      ]);
      return JSON.parse(result.response.text());
    } catch (err) {
      console.error(`[gemini vision] attempt ${i + 1} failed:`, err.message);
      if (i < retries) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}

// ── Conversation analysis (multiple messages with sequential context) ────────
async function analyseConversationWithGemini(messages, retries = 2) {
  // Format messages — include visual_cues from image extraction
  const conversationText = messages
    .map((msg, idx) => {
      let entry = `[Item ${idx + 1} — type: ${msg.type || 'text'}]:\n${msg.text || '(no text)'}`;
      if (msg.visual_cues) entry += `\n[Visual cues from image: ${msg.visual_cues}]`;
      return entry;
    })
    .join('\n\n---\n\n');

  const prompt = `You are SafeLah, a Malaysian scam detection AI. Analyse this batch of messages/images for scam indicators.

${conversationText}

CRITICAL PATTERNS TO DETECT (any of these alone = HIGH risk):
1. FAMILY EMERGENCY / SOCIAL ENGINEERING: Messages claiming to be a family member with a new number, then describing an urgent crisis (accident, arrest, hospital) and requesting money. This is an extremely common Malaysian scam.
   Signals: "new number", "phone spoil/rosak", "accident", "hospital", "police", "pay first", "help me first", urgency + money + unverified sender
2. LUCKY DRAW / PRIZE: Congratulations for prizes (Amazon gift cards, cash prizes), urgent countdown, requests to click a link or pay a processing fee.
3. DUITNOW QR SCAM: QR codes presented as payment receipts to COLLECT money but actually charge the victim. Fake countdown timers. "I've completed the payment" buttons.
4. IMAGE SCAM INDICATORS: If visual cues mention QR codes, countdown timers, prize notices, DuitNow, payment screens — treat as HIGH risk.
5. ANY combination of: (a) claimed urgency + (b) money/payment request + (c) unknown/unverified sender = HIGH risk.

Provide ONE overall verdict for this entire batch. Judge the WORST item — if ANY single item is HIGH risk, the overall verdict must be HIGH.`;

  for (let i = 0; i <= retries; i++) {
    try {
      const model = getModel();
      const result = await model.generateContent(prompt);
      const parsed = JSON.parse(result.response.text());
      console.log(`[gemini conversation] ✅ risk=${parsed.risk_level}, type=${parsed.scam_type}, conf=${parsed.confidence}`);
      return parsed;
    } catch (err) {
      console.error(`[gemini conversation] ❌ attempt ${i + 1} failed: ${err.message}`);
      if (i < retries) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null; // triggers keyword fallback
}

// ── Audio transcription + analysis ──────────────────────────────────────────
async function analyseAudioWithGemini(base64Audio, mimeType = 'audio/ogg', retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: EXTRACTION_SCHEMA,
          maxOutputTokens: 1000,
          temperature: 0.1,
        },
      });

      const result = await model.generateContent([
        { inlineData: { mimeType, data: base64Audio } },
        `You are an audio transcription specialist. Listen to this audio and:
1. Transcribe ALL spoken words verbatim into extracted_text
2. Extract any phone numbers mentioned into phones array
3. Extract any bank account numbers mentioned into accounts array  
4. Extract any URLs or websites mentioned into urls array
5. Describe audio cues in visual_cues: tone of voice (urgent/threatening/friendly), 
   background sounds, if caller claims to be authority (PDRM/bank/government)`,
      ]);

      const parsed = JSON.parse(result.response.text());
      console.log(`[gemini audio] transcribed ${parsed.extracted_text?.length || 0} chars`);
      return parsed;
    } catch (err) {
      console.error(`[gemini audio] attempt ${i + 1} failed:`, err.message);
      if (i < retries) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}

module.exports = { ai, analyseWithGemini, analyseImageWithGemini, extractTextFromImage, analyseConversationWithGemini, analyseAudioWithGemini };
