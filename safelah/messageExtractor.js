/**
 * Extract message metadata including forwarding/quoting information
 * Helps identify original sender and message context
 */

/**
 * Extract sender information from a message
 * Detects: forwarded messages, quoted replies, mentions
 */
async function extractMessageSender(message) {
  const senderInfo = {
    isForwarded: message.isForwarded || false,
    hasQuotedMsg: message.hasQuotedMsg || false,
    fromPhone: null,
    senderType: 'UNKNOWN', // 'FORWARDED', 'QUOTED', 'DIRECT', 'UNKNOWN'
    originalSender: null,
  };

  try {
    // Check if message is forwarded
    if (message.isForwarded) {
      senderInfo.isForwarded = true;
      senderInfo.senderType = 'FORWARDED';
      
      // Try to extract original sender from message metadata
      if (message.author) {
        senderInfo.originalSender = message.author;
        senderInfo.fromPhone = extractPhone(message.author);
      }
    }
    
    // Check if message quotes/replies to another message
    if (message.hasQuotedMsg) {
      senderInfo.hasQuotedMsg = true;
      
      try {
        const quotedMsg = await message.getQuotedMessage();
        if (quotedMsg) {
          senderInfo.senderType = 'QUOTED';
          senderInfo.originalSender = quotedMsg.author || quotedMsg.from;
          senderInfo.fromPhone = extractPhone(quotedMsg.from);
        }
      } catch (err) {
        console.log('[messageExtractor] Could not get quoted message:', err.message);
      }
    }
    
    // If no forwarding/quoting metadata, it's a direct message
    if (!senderInfo.isForwarded && !senderInfo.hasQuotedMsg) {
      senderInfo.senderType = 'DIRECT';
      senderInfo.fromPhone = extractPhone(message.from);
    }

  } catch (err) {
    console.error('[messageExtractor] Error extracting sender:', err.message);
  }

  return senderInfo;
}

/**
 * Extract plain phone number from various formats
 */
function extractPhone(phoneStr) {
  if (!phoneStr) return null;
  
  // Remove @c.us, @s.whatsapp.net, +, spaces, hyphens
  return phoneStr
    .replace(/@c\.us|@s\.whatsapp\.net/g, '')
    .replace(/[^\d]/g, '')
    .slice(-10); // Get last 10 digits (Malaysian format)
}

/**
 * Detect message sender type based on content analysis
 * Helps classify if message sounds like it's from scammer or victim
 */
function inferSenderType(messageText) {
  // Scammer indicators (pressure, urgency, promises)
  const scammerPatterns = [
    /segera|urgent|immediately|cepat|hari ini|24 jam/i,
    /transfer|bayar|deposit|bank in|bank card/i,
    /terjamin|dijamin|guaranteed|untung tinggi|profit/i,
    /jangan|don't|berhenti|stop telling/i,
    /cod|swift|western union|bitcoin|crypto/i,
  ];

  // User/victim indicators (questions, doubts, hesitation)
  const userPatterns = [
    /\?$/m, // ends with question
    /boleh|bolehkah|dapat|dapatkah|berapa|bila|bagaimana|kenapa/i,
    /tak percaya|tidak percaya|suspicious|ragu|doubt/i,
    /tunggu|sebentar|dulu|later|check/i,
  ];

  const scammerMatches = scammerPatterns.filter(p => p.test(messageText)).length;
  const userMatches = userPatterns.filter(p => p.test(messageText)).length;

  if (scammerMatches >= 2) return 'SCAMMER';
  if (userMatches >= 2) return 'USER';
  return 'NEUTRAL';
}

module.exports = {
  extractMessageSender,
  inferSenderType,
  extractPhone,
};
