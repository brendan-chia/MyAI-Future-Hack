const { transcribeAudio } = require('./speech');
const { analyseText } = require('./text');
const { sendMessage } = require('./whatsapp');

async function analyseAudio(from, message) {
  try {
    const transcript = await transcribeAudio(message);

    if (!transcript || transcript.trim().length === 0) {
      await sendMessage(from,
        'Sorry, I could not transcribe this audio. Please try again or send the message in text.'
      );
      return;
    }

    await sendMessage(from, `✅ Audio transcribed to text:
"${transcript}"

Analyzing content...`);

    await analyseText(from, transcript, false, 'en');
  } catch (err) {
    console.error('[audio] analyseAudio error:', err.message);
    await sendMessage(from,
      'Maaf, terjadi masalah semasa memproses audio. Sila cuba lagi atau hantar teks mesej tersebut.'
    );
  }
}

module.exports = { analyseAudio };
