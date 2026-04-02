const { analyseText } = require('./text');
const { sendMessage } = require('./whatsapp');
const { notifyGuardians } = require('./guardian');
const { buildVerdict } = require('./verdictBuilder');
const { logScamIntelligence, getBatchMessages, saveClarificationAnswer, getClarificationAnswers, clearBatchSession } = require('./queries');
const { extractEntities } = require('./extractor');
const { analyseConversationWithGemini, analyseImageWithGemini } = require('./gemini');
const { keywordAnalyse } = require('./keywordFallback');
const { inferSenderType } = require('./messageExtractor');

/**
 * Analyzes all messages collected in batch mode using sequential context reasoning
 * Now includes sender detection for better conversation understanding
 */
async function analyzeBatchMessages(phone, lang = 'bm') {
  const messages = getBatchMessages(phone);
  
  const errorMsgs = {
    bm: '❌ Tiada mesej untuk dianalisis. Hantar mesej dahulu atau guna /bantuan untuk bantuan.',
    en: '❌ No messages to analyze. Send messages first or use /help for help.',
  };

  const processingMsgs = {
    bm: (count) => `⏳ Menganalisis ${count} mesej dengan konteks pengirim... sila tunggu.\n\n(Boleh ambil masa sehingga beberapa minit)`,
    en: (count) => `⏳ Analyzing ${count} messages with sender context... please wait.\n\n(This may take a few minutes)`,
  };

  const errorAnalysisMsgs = {
    bm: (err) => `❌ Ralat semasa analisis: ${err}\n\nSila cuba lagi atau hantar /cancel untuk batalkan.`,
    en: (err) => `❌ Error during analysis: ${err}\n\nPlease try again or use /stop to cancel.`,
  };

  if (!messages || messages.length === 0) {
    await sendMessage(phone, errorMsgs[lang] || errorMsgs.bm);
    return;
  }

  await sendMessage(phone, (processingMsgs[lang] || processingMsgs.bm)(messages.length));

  try {
    // Process images to get descriptions, enrich messages
    const enrichedMessages = await Promise.all(messages.map(async (msg, idx) => {
      if (msg.type === 'image') {
        // Analyze image to get description
        console.log(`[batch] Analyzing image ${idx + 1} for context...`);
        try {
          const imageAnalysis = await analyseImageWithGemini(msg.data, msg.mime);
          return {
            ...msg,
            type: 'image',
            text: imageAnalysis ? `[Image: ${imageAnalysis.scam_type || 'Screenshot'}]` : '[Image]',
            imageDescription: imageAnalysis || null,
            senderType: 'IMAGE',
          };
        } catch (err) {
          console.error(`[batch] Image analysis failed for ${idx + 1}:`, err.message);
          return {
            ...msg,
            type: 'image',
            text: '[Image: Could not analyze]',
            imageDescription: null,
            senderType: 'IMAGE',
          };
        }
      } else if (msg.type === 'audio') {
        // Audio transcript
        return {
          ...msg,
          type: 'audio',
          text: msg.text,
          senderType: inferSenderType(msg.text),
        };
      } else {
        // Text message
        return {
          ...msg,
          type: 'text',
          text: msg.text,
          senderType: inferSenderType(msg.text),
        };
      }
    }));

    // Format conversation with proper labels including images
    const conversationText = enrichedMessages
      .map((msg, idx) => {
        let sender, content;
        
        if (msg.type === 'image') {
          sender = '[Image/Screenshot]';
          content = msg.imageDescription 
            ? `${msg.imageDescription.scam_type || 'Screenshot detected'} - Risk: ${msg.imageDescription.risk_level || 'Unknown'}`
            : 'Screenshot (content unclear)';
        } else {
          sender = msg.senderType === 'SCAMMER' ? '[Pengirim Syak]' :
                   msg.senderType === 'USER' ? '[Anda]' :
                   '[Mesej]';
          content = msg.text;
        }
        
        return `${sender} (Message ${idx + 1}):\n${content}`;
      })
      .join('\n\n---\n\n');

    console.log(`[batch] Processing ${enrichedMessages.length} messages (${enrichedMessages.filter(m => m.type === 'image').length} images)`);

    // Send to Gemini with enhanced context
    let conversationResult = await analyseConversationWithGemini(enrichedMessages);

    // Fallback if Gemini unavailable
    if (!conversationResult) {
      console.warn('[batch] Gemini conversation unavailable, falling back to keyword analysis');
      const combinedText = enrichedMessages.map(m => m.text).join('\n\n');
      conversationResult = keywordAnalyse(combinedText);
      conversationResult.source = 'keyword_fallback';
    }

    // Extract entities from all text messages
    const allEntities = [];
    enrichedMessages.forEach((msg, idx) => {
      if (msg.type === 'text') {
        const { phones, accounts, urls } = extractEntities(msg.text);
        allEntities.push({ phones, accounts, urls, messageIndex: idx });
      }
    });

    // Merge extracted entities into result
    conversationResult.extracted_phones = [
      ...new Set(allEntities.flatMap(e => e.phones))
    ];
    conversationResult.extracted_accounts = [
      ...new Set(allEntities.flatMap(e => e.accounts))
    ];
    conversationResult.extracted_urls = [
      ...new Set(allEntities.flatMap(e => e.urls))
    ];

    // Wrap single result in array for consistency
    const analysisResults = [{
      ...conversationResult,
      messageIndex: 0,
      isConversationAnalysis: true,
      totalMessages: messages.length,
      enrichedMessages: enrichedMessages,
    }];

    // Check if clarification is needed
    const needsClarification = conversationResult.risk_level === 'MEDIUM' && conversationResult.confidence < 0.7;

    if (needsClarification) {
      await askClarificationQuestionsForConversation(phone, messages, analysisResults[0], lang);
    } else {
      await sendConversationVerdict(phone, messages, analysisResults[0], enrichedMessages, lang);
    }

    clearBatchSession(phone);
  } catch (err) {
    console.error('[batch] Unexpected error:', err);
    const errorMsg = lang === 'en'
      ? `❌ Error during analysis: ${err.message}\n\nPlease try again or send /stop to cancel.`
      : `❌ Ralat semasa analisis: ${err.message}\n\nSila cuba lagi atau hantar /cancel untuk batalkan.`;
    await sendMessage(phone, errorMsg);
  }
}

/**
 * Correlate messages to detect if they're part of the same scam campaign
 * Boosts confidence if multiple related messages are detected
 */
function correlateMessages(results, messages) {
  // Extract phones/accounts from all messages
  const messageSignatures = messages.map((msg, idx) => {
    const { phones, accounts, urls } = extractEntities(msg.text);
    const scamType = results[idx]?.scam_type;
    return {
      idx,
      phones,
      accounts,
      urls,
      scamType,
      riskLevel: results[idx]?.risk_level,
      text: msg.text,
    };
  });

  // Find groups of related messages
  const correlatedGroups = [];

  for (let i = 0; i < messageSignatures.length; i++) {
    for (let j = i + 1; j < messageSignatures.length; j++) {
      const sig1 = messageSignatures[i];
      const sig2 = messageSignatures[j];

      // Check if messages are related:
      const relatedByPhone = sig1.phones.some(p => sig2.phones.includes(p)) ||
                             sig1.accounts.some(a => sig2.accounts.includes(a));
      
      const relatedByScamType = sig1.scamType && sig2.scamType && 
                               sig1.scamType === sig2.scamType &&
                               sig1.scamType !== 'UNKNOWN_SCAM';

      const relatedByPatterns = detectCommonPatterns(sig1.text, sig2.text);

      if (relatedByPhone || relatedByScamType || relatedByPatterns) {
        correlatedGroups.push({ indices: [i, j], reason: 'campaignMessage' });
      }
    }
  }

  // Boost confidence for correlated messages
  if (correlatedGroups.length > 0) {
    correlatedGroups.forEach(group => {
      group.indices.forEach(idx => {
        const result = results[idx];
        if (result && !result.error) {
          // Multiple related messages = definitely HIGH RISK
          result.risk_level = 'HIGH';
          result.confidence = Math.min(0.95, result.confidence + 0.25);
          result.scam_type = result.scam_type || 'UNKNOWN_SCAM';
          result.isPartOfCampaign = true;
          result.campaignGroup = group;
        }
      });
    });
  }

  // Also boost if multiple MEDIUM/HIGH messages from different sources
  const highRiskCount = results.filter(r => r && !r.error && r.risk_level === 'HIGH').length;
  const mediumRiskCount = results.filter(r => r && !r.error && r.risk_level === 'MEDIUM').length;

  if (highRiskCount >= 2 || (highRiskCount >= 1 && mediumRiskCount >= 1)) {
    // Multiple suspicious messages → likely coordinated scam
    results.forEach(r => {
      if (r && !r.error && (r.risk_level === 'MEDIUM' || r.risk_level === 'HIGH')) {
        if (!r.isPartOfCampaign) {
          r.risk_level = 'HIGH';
          r.confidence = Math.min(0.95, r.confidence + 0.15);
          r.reason_bm = (r.reason_bm || '') + '\n\n⚠️ Beberapa mesej mencurigakan diterima — mungkin bahagian kampanye penipuan yang sama.';
          r.reason_en = (r.reason_en || '') + '\n\nMultiple suspicious messages received — likely part of the same scam campaign.';
        }
      }
    });
  }
}

/**
 * Detect if two messages share common scam patterns (upfront payment, urgency, etc.)
 */
function detectCommonPatterns(text1, text2) {
  const patterns = [
    /bayar|transfer|deposit|bank in/i,
    /segera|urgent|immediately|cepat/i,
    /watsap|whatsapp|hubungi|call|0\d{9,10}/i,
    /hadiah|menang|prize|won|tahniah/i,
    /pinjaman|loan|kredit/i,
    /kerja|job|employment|bekerja/i,
  ];

  const matches1 = patterns.filter(p => p.test(text1));
  const matches2 = patterns.filter(p => p.test(text2));

  // If they share 2+ patterns, likely related
  const commonPatterns = matches1.filter(p => matches2.includes(p));
  return commonPatterns.length >= 2;
}

/**
 * Ask clarification questions for borderline cases
 */
async function askClarificationQuestions(phone, messages, results, indices) {
  const firstIndex = indices[0];
  const msg = messages[firstIndex];
  const result = results[firstIndex];

  const questions = generateQuestions(result.scam_type, msg.text);

  let promptText = `⚠️ Untuk analisis yang lebih tepat, tolong jawab soalan ini untuk mesej pertama yang ragu:\n\n`;
  promptText += `**Mesej:** "${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}"\n\n`;

  questions.forEach((q, idx) => {
    promptText += `${idx + 1}. ${q.question}\n`;
  });

  promptText += `\nJawab dengan:\n`;
  promptText += `• Ya / Tidak / Tidak Pasti\n`;
  promptText += `• atau hantar /skip untuk langkau\n`;
  promptText += `• atau hantar /cancel untuk batalkan analisis\n`;

  await sendMessage(phone, promptText);

  // Store clarification state temporarily
  const tempState = {
    messageIndex: firstIndex,
    questions: questions,
    allResults: results,
    allMessages: messages,
    clarificationIndices: indices,
  };

  global.pendingClarification = global.pendingClarification || {};
  global.pendingClarification[phone] = tempState;
}

/**
 * Generate questions based on scam type
 */
function generateQuestions(scamType, messageText) {
  const questions = [];

  if (!scamType || scamType === 'UNKNOWN_SCAM') {
    return [
      { id: 'ownership', question: 'Adakah anda kenal pengirim mesej ini?' },
      { id: 'requested', question: 'Adakah anda meminta bantuan atau perkhidmatan ini?' },
    ];
  }

  switch (scamType) {
    case 'INVESTMENT_SCAM':
      questions.push(
        { id: 'signup', question: 'Adakah anda mendaftar di platform/kumpulan ini?' },
        { id: 'guaranteed', question: 'Adakah jaminan pulangan tinggi membuatkan anda ragu-ragu?' }
      );
      break;

    case 'LOVE_SCAM':
      questions.push(
        { id: 'known', question: 'Adakah anda kenal orang ini dalam kehidupan sebenar?' },
        { id: 'asked_money', question: 'Adakah mereka pernah minta wang atau maklumat peribadi?' }
      );
      break;

    case 'JOB_SCAM':
      questions.push(
        { id: 'applied', question: 'Adakah anda benar-benar memohon kerja ini?' },
        { id: 'upfront', question: 'Adakah mereka minta wang pendahuluan atau maklumat bank?' }
      );
      break;

    case 'LOAN_SCAM':
      questions.push(
        { id: 'applied', question: 'Adakah anda memohon pinjaman kepada institusi ini?' },
        { id: 'upfront', question: 'Adakah mereka minta bayaran pendahuluan sebelum pinjaman diluluskan?' }
      );
      break;

    case 'PARCEL_SCAM':
      questions.push(
        { id: 'expected', question: 'Adakah anda memang menunggu parsel?' },
        { id: 'know_shipper', question: 'Adakah anda tahu siapa pengirim sebenar?' }
      );
      break;

    case 'MACAU_SCAM':
      questions.push(
        { id: 'official', question: 'Adakah anda hubungi agensi ini secara rasmi sebelum ini?' },
        { id: 'likely_scam', question: 'Adakah anda merasa ini adalah penipuan sebenarnya?' }
      );
      break;

    default:
      questions.push(
        { id: 'ownership', question: 'Adakah anda kenal pengirim mesej ini?' },
        { id: 'suspicious', question: 'Adakah anda merasa mesej ini mencurigakan?' }
      );
  }

  return questions;
}

/**
 * Process user's answer to clarification question
 */
async function processClarificationAnswer(phone, answerText) {
  const state = global.pendingClarification?.[phone];
  if (!state) {
    await sendMessage(phone, '❌ Tiada soalan menunggu jawapan. Hantar /start untuk mula analisis baru.');
    return;
  }

  const { messageIndex, questions, allResults, allMessages, clarificationIndices } = state;

  // Parse answer (Yes/No/Tidak Pasti)
  const answer = parseAnswer(answerText);
  if (answer === null && !answerText.toLowerCase().includes('skip')) {
    await sendMessage(phone, '❓ Sila jawab dengan: Ya, Tidak, atau Tidak Pasti');
    return;
  }

  if (answerText.toLowerCase() === '/skip') {
    // Skip to next clarification question or send verdicts
    clarificationIndices.shift();
    if (clarificationIndices.length > 0) {
      delete global.pendingClarification[phone];
      await askClarificationQuestions(phone, allMessages, allResults, clarificationIndices);
    } else {
      delete global.pendingClarification[phone];
      await sendBatchVerdicts(phone, allMessages, allResults);
    }
    return;
  }

  if (answerText.toLowerCase() === '/cancel') {
    delete global.pendingClarification[phone];
    await sendMessage(phone, '✅ Analisis dibatalkan. Hantar /start untuk analisis baru.');
    clearBatchSession(phone);
    return;
  }

  // Save the answer
  saveClarificationAnswer(phone, messageIndex, questions[0].question, answer);

  // Refine verdict based on answer
  if (answer !== null) {
    refineVerdictWithAnswer(allResults[messageIndex], answer);
  }

  // Move to next clarification or send verdicts
  clarificationIndices.shift();
  if (clarificationIndices.length > 0) {
    delete global.pendingClarification[phone];
    await askClarificationQuestions(phone, allMessages, allResults, clarificationIndices);
  } else {
    delete global.pendingClarification[phone];
    await sendBatchVerdicts(phone, allMessages, allResults);
  }
}

/**
 * Refine verdict based on user's answer
 */
function refineVerdictWithAnswer(result, answer) {
  if (answer === 'Ya') {
    // User confirms they know sender or applied for service → likely SAFE
    result.risk_level = 'LOW';
    result.confidence = 0.95;
  } else if (answer === 'Tidak' || answer === 'Tidak Pasti') {
    // User doesn't know sender or didn't apply → likely SCAM
    if (result.risk_level === 'MEDIUM') {
      result.risk_level = 'HIGH';
      result.confidence = 0.85;
    }
  }
}

/**
 * Parse yes/no answer
 */
function parseAnswer(text) {
  const t = text.toLowerCase().trim();
  if (t.includes('ya') || t.includes('yes') || t === '1' || t === 'y') return 'Ya';
  if (t.includes('tidak') || t.includes('no') || t === '0' || t === 'n') return 'Tidak';
  if (t.includes('pasti') || t.includes('uncertain') || t.includes('maybe')) return 'Tidak Pasti';
  return null;
}

/**
 * Send all batch verdicts (or individual ones accumulated)
 */
async function sendBatchVerdicts(phone, messages, results) {
  let summaryText = `✅ Analisis selesai untuk ${messages.length} mesej:\n\n`;
  let highRiskCount = 0;
  let mediumRiskCount = 0;
  let lowRiskCount = 0;
  let campaignWarning = '';

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const msg = messages[i];

    if (result.error) {
      summaryText += `${i + 1}. ❌ Gagal menganalisis\n`;
      continue;
    }

    const emoji = result.risk_level === 'HIGH' ? '🔴' : 
                  result.risk_level === 'MEDIUM' ? '⚠️' : '🟢';

    const campaignBadge = result.isPartOfCampaign ? ' 🎯' : '';

    summaryText += `${i + 1}. ${emoji} ${result.risk_level} - ${result.scam_type || 'UNKNOWN'}${campaignBadge}\n`;

    if (result.risk_level === 'HIGH') highRiskCount++;
    else if (result.risk_level === 'MEDIUM') mediumRiskCount++;
    else lowRiskCount++;

    // Log to database
    logScamIntelligence({
      scamType:   result.scam_type,
      riskLevel:  result.risk_level,
      callerPhone: phone,
      phones:     result.extracted_phones   || [],
      accounts:   result.extracted_accounts || [],
      urls:       result.extracted_urls     || [],
      confidence: result.confidence         || 0,
    });
  }

  // Check if multiple related messages detected
  const campaignMessages = results.filter(r => r?.isPartOfCampaign);
  if (campaignMessages.length > 1) {
    campaignWarning = `\n\n⚠️ PENTING: Dikesan ${campaignMessages.length} mesej berkaitan dari kemungkinan kampanye penipuan yang sama!\nIni menunjukkan pola penipuan yang terkoordinasi. Sila hati-hati! 🚨`;
  }

  summaryText += `\n📊 Ringkasan:\n`;
  summaryText += `🔴 Tinggi: ${highRiskCount}\n`;
  summaryText += `⚠️ Sederhana: ${mediumRiskCount}\n`;
  summaryText += `🟢 Rendah: ${lowRiskCount}\n`;
  summaryText += campaignWarning;

  await sendMessage(phone, summaryText);

  // Send detailed verdict for each
  for (let i = 0; i < results.length; i++) {
    if (!results[i].error && results[i].risk_level !== 'LOW') {
      const ccidResult = results[i].ccidResult || { found: false, reports: 0 };
      let verdict = buildVerdict(results[i], ccidResult, 'bm');
      
      if (results[i].isPartOfCampaign) {
        verdict += `\n\n🎯 [KAMPANYE TERKOORDINASI] Mesej ini adalah sebahagian daripada kampanye penipuan yang melibatkan mesej lain yang anda hantar.`;
      }

      await sendMessage(phone, `\n📌 Mesej ${i + 1}:\n${verdict}`);

      // Notify guardians if HIGH
      if (results[i].risk_level === 'HIGH') {
        await notifyGuardians(phone, results[i].scam_type);
      }
    }
  }
}

// ── Conversation-level analysis functions ──────────────────────────────────

/**
 * Generate questions for conversation-level analysis
 */
function generateConversationQuestions(scamType, lang = 'bm') {
  const questions = [];

  if (!scamType || scamType === 'UNKNOWN_SCAM') {
    return [
      { 
        id: 'sender_known', 
        question: lang === 'en' 
          ? 'Do you know the sender of these messages?' 
          : 'Adakah anda kenal pengirim mesej-mesej ini?' 
      },
      { 
        id: 'context_requested', 
        question: lang === 'en'
          ? 'Did you request the help or service being offered?'
          : 'Adakah anda meminta bantuan atau perkhidmatan yang ditawarkan?'
      },
    ];
  }

  switch (scamType) {
    case 'INVESTMENT_SCAM':
      questions.push(
        { 
          id: 'signup', 
          question: lang === 'en'
            ? 'Did you intentionally sign up for this platform/group?'
            : 'Adakah anda mendaftar di platform/kumpulan ini dengan sengaja?'
        },
        { 
          id: 'promised', 
          question: lang === 'en'
            ? 'Is the sender promising exceptionally high returns?'
            : 'Adakah pemberi mesej menjanjikan pulangan yang luar biasa tinggi?'
        }
      );
      break;

    case 'LOAN_SCAM':
      questions.push(
        { 
          id: 'applied', 
          question: lang === 'en'
            ? 'Did you seriously apply for a loan from this party?'
            : 'Adakah anda secara serius memohon pinjaman dari pihak ini?'
        },
        { 
          id: 'upfront_asked', 
          question: lang === 'en'
            ? 'Are they asking for upfront payment before loan approval?'
            : 'Adakah mereka minta bayaran pendahuluan sebelum pinjaman diluluskan?'
        }
      );
      break;

    case 'LOVE_SCAM':
      questions.push(
        { 
          id: 'known_offline', 
          question: lang === 'en'
            ? 'Do you know this person in real life?'
            : 'Adakah anda kenal orang ini dalam kehidupan sebenar?'
        },
        { 
          id: 'money_requested', 
          question: lang === 'en'
            ? 'Are they starting to ask for money in this message sequence?'
            : 'Adakah mereka mula meminta wang di dalam urutan mesej ini?'
        }
      );
      break;

    case 'JOB_SCAM':
      questions.push(
        { 
          id: 'applied_job', 
          question: lang === 'en'
            ? 'Did you actually apply for this job?'
            : 'Adakah anda benar-benar memohon kerja ini?'
        },
        { 
          id: 'payment_required', 
          question: lang === 'en'
            ? 'Are they asking for payment/registration fee?'
            : 'Adakah mereka minta pembayaran/yuran pendaftaran?'
        }
      );
      break;

    case 'PARCEL_SCAM':
      questions.push(
        { 
          id: 'expecting_parcel', 
          question: lang === 'en'
            ? 'Were you expecting a parcel delivery?'
            : 'Adakah anda mengharapkan penghantaran parcel?'
        },
        { 
          id: 'payment_for_delivery', 
          question: lang === 'en'
            ? 'Are they asking you to pay for delivery/clearance?'
            : 'Adakah mereka minta anda bayar untuk penghantaran/pembersihan?'
        }
      );
      break;

    case 'MACAU_SCAM':
      questions.push(
        { 
          id: 'won_legitimately', 
          question: lang === 'en'
            ? 'Did you legitimately enter this prize/lottery draw?'
            : 'Adakah anda benar-benar menyertai cabutan hadiah/lotteri ini?'
        },
        { 
          id: 'deposit_required', 
          question: lang === 'en'
            ? 'Are they asking for deposit money to claim prize?'
            : 'Adakah mereka minta deposit untuk menuntut hadiah?'
        }
      );
      break;

    default:
      questions.push(
        { 
          id: 'sender_known', 
          question: lang === 'en'
            ? 'Do you know the sender of these messages?'
            : 'Adakah anda kenal pengirim mesej-mesej ini?'
        },
        { 
          id: 'suspicious_pattern', 
          question: lang === 'en'
            ? 'Does this message sequence feel suspicious to you?'
            : 'Adakah anda merasa urutan mesej ini mencurigakan?'
        }
      );
  }

  return questions;
}

/**
 * Ask clarification questions for conversation-level analysis
 */
async function askClarificationQuestionsForConversation(phone, messages, result, lang = 'bm') {
  const enrichedMessages = result.enrichedMessages || messages;
  const questions = generateConversationQuestions(result.scam_type, lang);

  const headerMsgs = {
    bm: `⚠️ Untuk analisis yang lebih tepat, tolong jawab soalan tentang urutan mesej ini:\n\n`,
    en: `⚠️ For more accurate analysis, please answer questions about this message sequence:\n\n`,
  };

  const msgListHeaderMsgs = {
    bm: `**Mesej Diterima (dalam urutan):**\n`,
    en: `**Messages Received (in order):**\n`,
  };

  const moreMessagesMsgs = {
    bm: (count) => `... dan ${count} mesej lagi\n`,
    en: (count) => `... and ${count} more messages\n`,
  };

  const questionHeaderMsgs = {
    bm: `**Soalan:**\n`,
    en: `**Questions:**\n`,
  };

  const answerInstructionsMsgs = {
    bm: `Jawab dengan:\n• Ya / Tidak / Tidak Pasti\n• atau hantar /skip untuk langkau\n• atau hantar /cancel untuk batalkan\n`,
    en: `Answer with:\n• Yes / No / Not Sure\n• or send /skip to skip\n• or send /stop to cancel\n`,
  };

  let promptText = headerMsgs[lang] || headerMsgs.bm;
  promptText += msgListHeaderMsgs[lang] || msgListHeaderMsgs.bm;
  
  enrichedMessages.slice(0, 3).forEach((msg, idx) => {
    const senderLabel = msg.senderType === 'SCAMMER' ? '👤 Pengirim' :
                        msg.senderType === 'USER' ? '👤 Anda' :
                        '📨 Mesej';
    const preview = msg.text.substring(0, 60) + (msg.text.length > 60 ? '...' : '');
    promptText += `${idx + 1}. [${senderLabel}]: "${preview}"\n`;
  });
  if (enrichedMessages.length > 3) {
    promptText += (moreMessagesMsgs[lang] || moreMessagesMsgs.bm)(enrichedMessages.length - 3);
  }

  promptText += `\n${questionHeaderMsgs[lang] || questionHeaderMsgs.bm}`;
  questions.forEach((q, idx) => {
    promptText += `${idx + 1}. ${q.question}\n`;
  });

  promptText += `\n${answerInstructionsMsgs[lang] || answerInstructionsMsgs.bm}`;

  await sendMessage(phone, promptText);

  // Store clarification state with language preference
  global.pendingClarification = global.pendingClarification || {};
  global.pendingClarification[phone] = {
    questions: questions,
    conversationResult: result,
    messages: messages,
    enrichedMessages: enrichedMessages,
    isConversationLevel: true,
    lang: lang,
  };
}

/**
 * Send verdict for entire conversation
 */
async function sendConversationVerdict(phone, messages, result, enrichedMessages = null, lang = 'bm') {
  const audioCount = messages.filter(m => m.type === 'audio').length;
  const imageCount = messages.filter(m => m.type === 'image').length;
  const textCount = messages.filter(m => m.type === 'text').length;
  
  const summaryMsgs = {
    bm: () => `✅ Analisis selesai (Mesej: ${textCount}, Gambar: ${imageCount}, Audio: ${audioCount}):\n\n`,
    en: () => `✅ Analysis complete (Text: ${textCount}, Images: ${imageCount}, Audio: ${audioCount}):\n\n`,
  };

  const riskLabels = {
    bm: { HIGH: 'RISIKO TINGGI', MEDIUM: 'RISIKO SEDERHANA', LOW: 'RISIKO RENDAH' },
    en: { HIGH: 'HIGH RISK', MEDIUM: 'MEDIUM RISK', LOW: 'LOW RISK' },
  };

  const scamTypeLabel = {
    bm: 'Jenis Penipuan',
    en: 'Scam Type',
  };

  const confidenceLabel = {
    bm: 'Keyakinan',
    en: 'Confidence',
  };

  const conversationContextLabel = {
    bm: `**Urutan Percakapan yang Dianalisis:**\n`,
    en: `**Conversation Sequence Analyzed:**\n`,
  };



  const detailedVerdictLabel = {
    bm: `\n📌 **Keputusan Terperinci:**\n`,
    en: `\n📌 **Detailed Verdict:**\n`,
  };

  let summaryText = (summaryMsgs[lang] || summaryMsgs.bm)();
  
  const emoji = result.risk_level === 'HIGH' ? '🔴' : 
                result.risk_level === 'MEDIUM' ? '⚠️' : '🟢';

  summaryText += `${emoji} **${riskLabels[lang]?.[result.risk_level] || riskLabels.bm[result.risk_level]}**\n`;
  summaryText += `${scamTypeLabel[lang] || scamTypeLabel.bm}: ${result.scam_type || 'UNKNOWN'}\n`;
  summaryText += `${confidenceLabel[lang] || confidenceLabel.bm}: ${Math.round(result.confidence * 100)}%\n\n`;

  // Show the conversation context with sender labels
  summaryText += conversationContextLabel[lang] || conversationContextLabel.bm;
  
  if (enrichedMessages && enrichedMessages.length > 0) {
    enrichedMessages.forEach((msg, idx) => {
      const senderLabel = msg.senderType === 'SCAMMER' ? '👤 Pengirim' :
                          msg.senderType === 'USER' ? '👤 Anda' :
                          '📨 Mesej';
      const preview = msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : '');
      summaryText += `${idx + 1}. ${senderLabel}: ${preview}\n`;
    });
  } else {
    messages.forEach((msg, idx) => {
      const preview = msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : '');
      summaryText += `${idx + 1}. ${preview}\n`;
    });
  }

  await sendMessage(phone, summaryText);

  // Send detailed verdict
  const verdictMsg = buildVerdict(result, { found: false, reports: 0 }, lang);
  await sendMessage(phone, `${detailedVerdictLabel[lang] || detailedVerdictLabel.bm}${verdictMsg}`);

  // Log and notify guardians if HIGH
  logScamIntelligence({
    scamType:   result.scam_type,
    riskLevel:  result.risk_level,
    callerPhone: phone,
    phones:     result.extracted_phones   || [],
    accounts:   result.extracted_accounts || [],
    urls:       result.extracted_urls     || [],
    confidence: result.confidence         || 0,
  });
  if (result.risk_level === 'HIGH') {
    await notifyGuardians(phone, result.scam_type);
  }
}

/**
 * Process clarification answer for conversation-level analysis
 */
async function processClarificationAnswerForConversation(phone, answerText) {
  const state = global.pendingClarification?.[phone];
  const lang = state?.lang || 'bm';

  const noQuestionMsgs = {
    bm: '❌ Tiada soalan menunggu jawapan. Hantar /start untuk mula analisis baru.',
    en: '❌ No questions waiting for answers. Send /begin to start a new analysis.',
  };

  const skipMsgs = {
    bm: '⏭️ Soalan dilangkau. Menganalisis dengan maklumat sedia ada...',
    en: '⏭️ Question skipped. Analyzing with available information...',
  };

  const cancelMsgs = {
    bm: '✅ Analisis dibatalkan. Hantar /start untuk analisis baru.',
    en: '✅ Analysis cancelled. Send /begin to start a new analysis.',
  };

  const invalidAnswerMsgs = {
    bm: '❓ Sila jawab dengan: Ya, Tidak, atau Tidak Pasti',
    en: '❓ Please answer with: Yes, No, or Not Sure',
  };

  if (!state || !state.isConversationLevel) {
    await sendMessage(phone, noQuestionMsgs[lang] || noQuestionMsgs.bm);
    return;
  }

  const { questions, conversationResult, messages, enrichedMessages } = state;

  // Parse answer
  const answer = parseAnswer(answerText);

  if (answerText.toLowerCase() === '/skip') {
    delete global.pendingClarification[phone];
    await sendMessage(phone, skipMsgs[lang] || skipMsgs.bm);
    await sendConversationVerdict(phone, messages, conversationResult, enrichedMessages, lang);
    return;
  }

  if (answerText.toLowerCase() === '/cancel' || answerText.toLowerCase() === '/stop') {
    delete global.pendingClarification[phone];
    await sendMessage(phone, cancelMsgs[lang] || cancelMsgs.bm);
    clearBatchSession(phone);
    return;
  }

  if (answer === null) {
    await sendMessage(phone, invalidAnswerMsgs[lang] || invalidAnswerMsgs.bm);
    return;
  }

  // Refine verdict based on answer
  if (answer === 'Ya' || answer === 'Yes') {
    // User knows sender or applied/requested → likely SAFE
    conversationResult.risk_level = 'LOW';
    conversationResult.confidence = 0.95;
  } else if (answer === 'Tidak' || answer === 'No' || answer === 'Tidak Pasti' || answer === 'Not Sure') {
    // User doesn't know or unsure → likely SCAM
    if (conversationResult.risk_level === 'MEDIUM') {
      conversationResult.risk_level = 'HIGH';
      conversationResult.confidence = 0.85;
    }
  }

  delete global.pendingClarification[phone];
  await sendConversationVerdict(phone, messages, conversationResult, enrichedMessages, lang);
}

module.exports = {
  analyzeBatchMessages,
  processClarificationAnswer,
  processClarificationAnswerForConversation,
};
