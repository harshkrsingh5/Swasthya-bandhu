const twilio = require('twilio');

// ── Twilio Config ──────────────────────────────────────────────────────────────
const accountSid  = process.env.TWILIO_ACCOUNT_SID || '';
const authToken   = process.env.TWILIO_AUTH_TOKEN  || '';
const twilioPhone = (process.env.TWILIO_PHONE_NUMBER || '').replace(/\s+/g, ''); // strip spaces

// Detect if credentials look real (not placeholders)
const credentialsLookReal =
  accountSid.startsWith('AC') &&
  authToken.length >= 32 &&
  twilioPhone.startsWith('+') &&
  !twilioPhone.includes('X') &&
  twilioPhone.length >= 10;

let client = null;
if (credentialsLookReal) {
  try {
    client = twilio(accountSid, authToken);
    console.log('✅ Twilio client initialized with real credentials');
  } catch (e) {
    console.warn('⚠️ Twilio client init failed:', e.message);
  }
} else {
  console.warn('⚠️ Twilio credentials missing or placeholder — calls will be mocked');
}

const CALL_TEMPLATES = {
  'follow-up': (patientName) =>
    `Hello, this is Swasthya Bandhu, your AI health companion calling on behalf of your hospital. ` +
    `This is a follow-up call for ${patientName}. ` +
    `Please check your medication schedule and health vitals for today. ` +
    `If you have any concerns, please contact your doctor immediately. Thank you and stay healthy.`,

  'vaccination-reminder': (patientName) =>
    `Hello, this is a reminder from Swasthya Bandhu health services. ` +
    `We are calling regarding the newborn vaccination schedule. ` +
    `An important vaccination is due shortly for your newborn. ` +
    `Please visit your nearest health centre or contact us to schedule the vaccination. Thank you.`,

  'ipd-followup': (patientName) =>
    `Hello, this is Swasthya Bandhu AI agent calling for ${patientName}. ` +
    `This is an update regarding your hospital admission. ` +
    `Our care team will visit you shortly. Please inform the nurse if you need immediate assistance. ` +
    `Get well soon.`,

  'recovery-followup': (patientName) =>
    `Hello ${patientName}, this is Swasthya Bandhu calling to check on your post-discharge recovery. ` +
    `We hope you are feeling better. Please remember to take your medications on time, ` +
    `drink plenty of water, and get adequate rest. ` +
    `If you experience any complications, please contact your doctor immediately. ` +
    `Wishing you a speedy recovery. Goodbye.`,
};

// ── Build TwiML voice message for patient calls ───────────────────────────────
function buildTwiML(patientName, callType = 'follow-up') {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const baseUrl = process.env.PUBLIC_URL || '';

  if (!baseUrl) {
    console.warn("⚠️ PUBLIC_URL is not set in .env. Interactive IVR disabled. Falling back to English only.");
    const messageText = CALL_TEMPLATES[callType] ? CALL_TEMPLATES[callType](patientName) : CALL_TEMPLATES['follow-up'](patientName);
    twiml.say(
      { voice: 'Polly.Aditi', language: 'en-IN' },
      messageText
    );
    return twiml.toString();
  }

  // Multilingual IVR Menu
  const actionUrl = `${baseUrl}/api/twilio/gather?patientName=${encodeURIComponent(patientName)}&callType=${encodeURIComponent(callType)}`;
  const gather = twiml.gather({ numDigits: 1, action: actionUrl, method: 'POST', timeout: 10 });
  
  gather.say({ voice: 'Polly.Aditi', language: 'en-IN' }, 
    "Welcome to Swasthya Bandhu. " +
    "For English, press 1. " +
    "Hindi ke liye, 2 dabaye. " +
    "Telugu kosam, 3 nokkandi. " +
    "Tamilukku, 4 azhuthavum. " +
    "Malayalam kku, 5 amarthuka. " +
    "Marathi sathi, 6 daba. " +
    "Kannada kagi, 7 otti. " +
    "Gujarati mate, 8 dabavo. " +
    "Odia paain, 9 dabantu."
  );

  // If no input, just repeat the English warning
  twiml.say({ voice: 'Polly.Aditi', language: 'en-IN' }, 'No input received. Goodbye.');

  return twiml.toString();
}

// ── Main function: Make an outbound call ──────────────────────────────────────
async function makeAutomatedCall(toPhoneNumber, patientName = 'Patient', callType = 'follow-up') {
  // Clean up phone number
  const cleanPhone = toPhoneNumber.trim().replace(/\s+/g, '');

  // ── MOCK mode: credentials are placeholder or missing ────────────────────────
  if (!credentialsLookReal || !client) {
    console.log(`[MOCK CALL] Would call ${patientName} at ${cleanPhone} (type: ${callType})`);
    console.log('[MOCK CALL] Set real TWILIO_PHONE_NUMBER in .env to enable real calls');
    return {
      success: true,
      mock: true,
      message: `Mock call placed to ${patientName} at ${cleanPhone}`,
    };
  }

  // ── REAL mode ────────────────────────────────────────────────────────────────
  try {
    const publicUrl = process.env.PUBLIC_URL || '';
    if (!publicUrl) {
      throw new Error('PUBLIC_URL is missing in .env. Interactive Twilio Voice AI strongly requires a public webhook URL (e.g., via Ngrok).');
    }

    const callUrl = `${publicUrl}/twilio/conversation-start?patientName=${encodeURIComponent(patientName)}&toPhoneNumber=${encodeURIComponent(cleanPhone)}`;

    console.log(`[Twilio] FROM: ${twilioPhone}`);
    console.log(`[Twilio] TO:   ${cleanPhone}`);
    console.log(`[Twilio] Webhook URL: ${callUrl}`);

    // Twilio triggers this endpoint immediately on pickup to start the dynamic voice loop
    const call = await client.calls.create({
      url: callUrl,
      to: cleanPhone,
      from: twilioPhone,
    });

    console.log(`✅ Twilio call initiated to ${cleanPhone} — SID: ${call.sid}`);
    return { success: true, callSid: call.sid, to: cleanPhone, patientName };
  } catch (err) {
    console.error('❌ Twilio Call Error:', err.message);

    // Give the user a human-friendly message based on error code
    let userMessage = err.message;

    if (err.code === 21608 || err.message.includes('unverified. Trial accounts')) {
      userMessage =
        `⚠️ Trial Account Restriction: The destination number "${cleanPhone}" is not verified. ` +
        `On a free Twilio trial, you can ONLY make calls to numbers you've personally verified. ` +
        `Go to console.twilio.com → "Verified Caller IDs" to add this number, or upgrade your account.`;
    } else if (err.code === 21212 || err.message.includes('not a valid phone number')) {
      userMessage = `⚠️ Invalid phone number format. Use international format like +91XXXXXXXXXX`;
    } else if (err.message.includes('not yet verified') || err.message.includes('source phone number')) {
      userMessage =
        `⚠️ TWILIO_PHONE_NUMBER in .env is not a verified/purchased Twilio number. ` +
        `Go to console.twilio.com → Phone Numbers → Buy a number, then update .env.`;
    }

    return { success: false, error: userMessage };
  }
}

module.exports = { makeAutomatedCall, CALL_TEMPLATES };
