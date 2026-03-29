import twilio from 'npm:twilio';
import { TRANSLATIONS } from './translations.ts';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const TWILIO_AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')  || '';
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER') || '+1234567890';

const client = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

if (!client) {
  console.warn('⚠️ Twilio credentials missing or placeholder — calls will be mocked');
}

export const CALL_TEMPLATES: Record<string, (name: string) => string> = {
  'follow-up': (patientName) => TRANSLATIONS['follow-up']['English'](patientName),
  'vaccination-reminder': (patientName) => TRANSLATIONS['vaccination-reminder']['English'](patientName),
  'ipd-followup': (patientName) => TRANSLATIONS['ipd-followup']['English'](patientName),
  'recovery-followup': (patientName) => TRANSLATIONS['recovery-followup']['English'](patientName),
};

export function buildTwiML(patientName: string, callType = 'follow-up') {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const baseUrl = Deno.env.get('PUBLIC_URL') || '';

  if (!baseUrl) {
    console.warn("⚠️ PUBLIC_URL is not set. Interactive IVR disabled.");
    const messageText = CALL_TEMPLATES[callType] ? CALL_TEMPLATES[callType](patientName) : CALL_TEMPLATES['follow-up'](patientName);
    twiml.say({ voice: 'Polly.Aditi', language: 'en-IN' }, messageText);
    return twiml.toString();
  }

  const actionUrl = `${baseUrl}/api/twilio/gather?patientName=${encodeURIComponent(patientName)}&callType=${encodeURIComponent(callType)}`;

  twiml.say(
    { voice: 'Polly.Aditi', language: 'en-IN' },
    "Hello. This is Swasthya Bandhu. Please select your preferred language."
  );

  const gather = twiml.gather({ numDigits: 1, action: actionUrl, method: 'POST', timeout: 10 });
  gather.say({ voice: 'Polly.Aditi', language: 'en-IN' }, "Press 1 for English.");
  gather.say({ language: 'hi-IN' }, "हिंदी के लिए दो दबाएं.");
  gather.say({ language: 'te-IN' }, "తెలుగు కోసం మూడు నొక్కండి.");
  gather.say({ language: 'ta-IN' }, "தமிழுக்கு நான்கு அழுத்தவும்.");
  gather.say({ language: 'ml-IN' }, "മലയാളത്തിന് അഞ്ച് അമർത്തുക.");
  gather.say({ language: 'mr-IN' }, "मराठीसाठी सहा दाबा.");
  gather.say({ language: 'kn-IN' }, "ಕನ್ನಡಕ್ಕಾಗಿ ಏಳು ಒತ್ತಿರಿ.");
  gather.say({ language: 'gu-IN' }, "ગુજરાતી માટે આઠ દબાવો.");
  gather.say({ language: 'hi-IN' }, "ଓଡିଆ ପାଇଁ ନଅ ଦବାନ୍ତୁ.");

  twiml.say({ voice: 'Polly.Aditi', language: 'en-IN' }, "We didn't receive any input. Goodbye.");
  return twiml.toString();
}

export async function makeAutomatedCall(toPhoneNumber: string, patientName: string, callType = 'follow-up') {
  if (!client) {
    console.log(`\n[MOCK CALL DETECTED] Would have actively called ${toPhoneNumber} for ${patientName} via Webhooks.\n`);
    return { success: true, message: 'Mock active interactive call generated successfully' };
  }

  try {
    const publicUrl = Deno.env.get('PUBLIC_URL');
    if (!publicUrl) {
      throw new Error("Edge Environment missing PUBLIC_URL context. Cannot orchestrate conversational AI without a webhook base.");
    }
    
    // Pass query params gracefully so Edge Twilio webhook can retrieve the exact context during call execution
    const callUrl = `${publicUrl}/twilio/conversation-start?patientName=${encodeURIComponent(patientName)}&toPhoneNumber=${encodeURIComponent(toPhoneNumber)}`;
    const cleanNumber = toPhoneNumber.startsWith('+') ? toPhoneNumber : `+91${toPhoneNumber}`;

    const call = await client.calls.create({
      url: callUrl,
      to: cleanNumber,
      from: TWILIO_PHONE_NUMBER
    });

    return { success: true, callSid: call.sid };
  } catch (err: any) {
    return { success: false, error: "Error orchestrating Twilio Conversational Call on Edge", rawError: err.message };
  }
}
