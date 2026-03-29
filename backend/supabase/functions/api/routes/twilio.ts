import { Hono } from 'npm:hono@3';
import { TRANSLATIONS } from '../utils/translations.ts';
import { buildTwiML, makeAutomatedCall } from '../utils/twilioService.ts';

const twilioRoutes = new Hono();
const BASE_URL = 'https://abdblukbngbapatrqvkr.supabase.co/functions/v1/api';

// ── POST /twilio/conversation-start — Entry Hook ───────────────────────────
twilioRoutes.post('/conversation-start', async (c) => {
  try {
    const patientName = c.req.query('patientName') || '';
    const toPhoneNumber = c.req.query('toPhoneNumber') || '';

    const twilio = await import('npm:twilio');
    const VoiceResponse = twilio.default.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    
    const gather = twiml.gather({
      numDigits: 1,
      action: `${BASE_URL}/twilio/conversation-greet?patientName=${encodeURIComponent(patientName)}&toPhoneNumber=${encodeURIComponent(toPhoneNumber)}`,
      method: 'POST',
      timeout: 10
    });

    // Define explicitly supported voices to avoid Twilio default voice crashing on regional languages
    const getVoiceOpts = (code: string) => {
      if (code === 'en-IN' || code === 'hi-IN' || code === 'mr-IN') return { language: code, voice: 'Polly.Aditi' };
      return { language: code, voice: `Google.${code}-Standard-A` };
    };

    // 1 - English, 2 - Hindi, 3 - Marathi, 4 - Malayalam, 5 - Telugu, 6 - Kannada, 7 - Gujarati, 8 - Odia, 9 - Urdu
    gather.say(getVoiceOpts('en-IN'), "Hello. This is Swasthya Bandhu calling on behalf of your hospital for a follow-up. Press 1 for English.");
    gather.say(getVoiceOpts('hi-IN'), "नमस्ते। मैं आपके अस्पताल की ओर से स्वास्थ्य बंधु बोल रहा हूँ। हिंदी के लिए दो दबाएं।");
    gather.say(getVoiceOpts('hi-IN'), "नमस्कार. मी रुग्णालयाच्या वतीने स्वास्थ्य बंधू बोलत आहे. मराठीसाठी ३ दाबा."); // Aditi reads Devanagari
    gather.say(getVoiceOpts('ml-IN'), "നമസ്കാരം. ഞാൻ ആശുപത്രിയുടെ പ്രതിനിധിയായി വിളിക്കുന്ന സ്വാസ്ഥ്യ ബന്ധുവാണ്. മലയാളത്തിനായി നാല് അമർത്തുക.");
    gather.say(getVoiceOpts('te-IN'), "నమస్కారం. నేను హాస్పిటల్ తరపున కాల్ చేస్తున్న స్వాస్థ్య బంధుని. తెలుగు కోసం ఐదు నొక్కండి.");
    gather.say(getVoiceOpts('kn-IN'), "ನಮಸ್ಕಾರ. ನಾನು ಆಸ್ಪತ್ರೆಯ ಪರವಾಗಿ ಕರೆ ಮಾಡುತ್ತಿರುವ ಸ್ವಾಸ್ಥ್ಯ ಬಂಧು. ಕನ್ನಡಕ್ಕಾಗಿ ಆರು ಒತ್ತಿರಿ.");
    gather.say(getVoiceOpts('gu-IN'), "નમસ્તે. હું હોસ્પિટલ વતી સ્વાસ્થ્ય બંધુ બોલી રહ્યો છું. ગુજરાતી માટે સાત દબાવો.");
    gather.say(getVoiceOpts('hi-IN'), "ନମସ୍କାର ମୁଁ ଡାକ୍ତରଖାନା ତରଫରୁ ସ୍ୱାସ୍ଥ୍ୟ ବନ୍ଧୁ କହୁଛି ଓଡ଼ିଆ ପାଇଁ ଆଠ ଦବାନ୍ତୁ"); 
    gather.say(getVoiceOpts('ur-IN'), "سلام۔ میں ہسپتال کی طرف سے سواستھیا بندھو بات کر رہا ہوں۔ اردو کے لیے نو دبائیں۔");

    twiml.say(getVoiceOpts('en-IN'), "No input received. Goodbye.");
    
    return new Response(twiml.toString(), { headers: { 'Content-Type': 'text/xml' } });
  } catch (err: any) {
    console.error("Error in conversation-start:", err);
    return new Response("<Response><Say>System error.</Say></Response>", { headers: { 'Content-Type': 'text/xml' }});
  }
});

// ── POST /twilio/conversation-greet — Translate & Launch Speech Loop ───────
twilioRoutes.post('/conversation-greet', async (c) => {
  try {
    const patientName = c.req.query('patientName') || '';
    const toPhoneNumber = c.req.query('toPhoneNumber') || '';
    
    let body: any = {};
    try {
      body = await c.req.parseBody();
    } catch (e) {
      console.error("Failed to parse body", e);
    }
    const Digits = body['Digits'] || '1';

    const twilio = await import('npm:twilio');
    const VoiceResponse = twilio.default.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    const LANG_MAP: Record<string, { id: string, code: string, welcome: string }> = {
      '1': { id: 'English',   code: 'en-IN', welcome: "I am the Swasthya Bandhu AI calling on behalf of the hospital for a follow-up. How are you feeling today, and when are you planning to visit the doctor?" },
      '2': { id: 'Hindi',     code: 'hi-IN', welcome: "मैं अस्पताल की ओर से फॉलो-अप के लिए स्वास्थ्य बंधु एआई कॉल कर रहा हूँ। आप कैसा महसूस कर रहे हैं और आप डॉक्टर के पास कब आने वाले हैं?" },
      '3': { id: 'Marathi',   code: 'mr-IN', welcome: "मी रूग्णालयाच्या वतीने फॉलो-अपसाठी स्वास्थ्य बंधू एआय कॉल करत आहे. तुम्हाला आज कसे वाटत आहे आणि तुम्ही डॉक्टरांना कधी भेटणार आहात?" },
      '4': { id: 'Malayalam', code: 'ml-IN', welcome: "ആശുപത്രിക്ക് വേണ്ടി ഫോളോ-അപ്പിനായി വിളിക്കുന്ന സ്വാസ്ഥ്യ ബന്ധു എഐ ആണ് ഞാൻ. നിങ്ങൾക്ക് ഇന്ന് എങ്ങനെയുണ്ട്, എപ്പോഴാണ് ഡോക്ടറെ കാണാൻ വരുന്നത്?" },
      '5': { id: 'Telugu',    code: 'te-IN', welcome: "నేను హాస్పిటల్ తరపున ఫాలో-అప్ కోసం కాల్ చేస్తున్న స్వాస్థ్య బంధు AI ని. మీరు ఈరోజు ఎలా ఫీల్ అవుతున్నారు, డాక్టర్‌ను ఎప్పుడు కలవాలనుకుంటున్నారు?" },
      '6': { id: 'Kannada',   code: 'kn-IN', welcome: "ನಾನು ಆಸ್ಪತ್ರೆಯ ಪರವಾಗಿ ಫಾಲೋ-ಅಪ್‌ಗಾಗಿ ಕರೆ ಮಾಡುತ್ತಿರುವ ಸ್ವಾಸ್ಥ್ಯ ಬಂಧು ಎಐ. ನೀವು ಇಂದು ಹೇಗೆ ಭಾವಿಸುತ್ತಿದ್ದೀರಿ, ಮತ್ತು ನೀವು ಯಾವಾಗ ವೈದ್ಯರನ್ನು ಭೇಟಿ ಮಾಡಲು ಯೋಜಿಸುತ್ತಿದ್ದೀರಿ?" },
      '7': { id: 'Gujarati',  code: 'gu-IN', welcome: "હું હોસ્પિટલ વતી ફોલો-અપ માટે સ્વાસ્થ્ય બંધુ એઆઈ બોલી રહ્યો છું. આજે તમને કેવું લાગે છે, અને તમે ડોક્ટરને ક્યારે મળવાના છો?" },
      '8': { id: 'Odia',      code: 'hi-IN', welcome: "ମୁଁ ହସ୍ପିଟାଲ୍ ତରଫରୁ ଫଲୋ-ଅପ୍ ପାଇଁ କଲ୍ କରୁଥିବା ସ୍ୱାସ୍ଥ୍ୟ ବନ୍ଧୁ AI | ଆଜି ଆପଣ କିପରି ଅନୁଭବ କରୁଛନ୍ତି ଏବଂ ଆପଣ କେବେ ଡାକ୍ତରଙ୍କ ନିକଟକୁ ଯିବାକୁ ଯୋଜନା କରୁଛନ୍ତି?" }, // using hi-IN voice engine as Twilio doesn't officially list Odia (or-IN) TTS
      '9': { id: 'Urdu',      code: 'ur-IN', welcome: "میں ہسپتال کی طرف سے فالو اپ کے لیے سواستھیا بندھو اے آئی کال کر رہا ہوں۔ آپ آج کیسا محسوس کر رہے ہیں، اور آپ کب ڈاکٹر کے پاس جانے کا ارادہ رکھتے ہیں؟" }
    };

    const selected = LANG_MAP[Digits] || LANG_MAP['1'];
    const displayLang = selected.id;
    const langVoice = selected.code;
    const greetingText = selected.welcome;

    const getVoiceOpts = (code: string) => {
      if (code === 'en-IN' || code === 'hi-IN' || code === 'mr-IN') return { language: code, voice: 'Polly.Aditi' };
      return { language: code, voice: `Google.${code}-Standard-A` };
    };
    
    const gather = twiml.gather({
      input: 'speech',
      action: `${BASE_URL}/twilio/chat?patientName=${encodeURIComponent(patientName)}&toPhoneNumber=${encodeURIComponent(toPhoneNumber)}&lang=${displayLang}`,
      method: 'POST',
      timeout: 5,
      language: langVoice
    });

    gather.say(getVoiceOpts(langVoice), greetingText);
    
    return new Response(twiml.toString(), { headers: { 'Content-Type': 'text/xml' } });
  } catch (err: any) {
    console.error("Error in conversation-greet:", err);
    return new Response("<Response><Say>System error.</Say></Response>", { headers: { 'Content-Type': 'text/xml' }});
  }
});

// ── POST /twilio/chat — The AI Conversation Engine ─────────────────────────
twilioRoutes.post('/chat', async (c) => {
  try {
    const patientName = c.req.query('patientName') || '';
    const toPhoneNumber = c.req.query('toPhoneNumber') || '';
    const lang = c.req.query('lang') || 'English';

    let body: any = {};
    try {
      body = await c.req.parseBody();
    } catch (e) {
      console.error("Failed to parse body in chat", e);
    }
    const SpeechResult = body['SpeechResult'] as string;

    const twilio = await import('npm:twilio');
    const VoiceResponse = twilio.default.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    
    // Map to BCP-47 tag for TTS engine
    const langToCode: Record<string, string> = {
      'English': 'en-IN', 'Hindi': 'hi-IN', 'Marathi': 'mr-IN', 
      'Malayalam': 'ml-IN', 'Telugu': 'te-IN', 'Kannada': 'kn-IN', 
      'Gujarati': 'gu-IN', 'Odia': 'hi-IN', 'Urdu': 'ur-IN'
    };
    const langVoice = langToCode[lang] || 'en-IN';

    // Must enforce voice property to prevent Twilio default voice crash
    const getVoiceOpts = (code: string) => {
      if (code === 'en-IN' || code === 'hi-IN' || code === 'mr-IN') return { language: code, voice: 'Polly.Aditi' };
      return { language: code, voice: `Google.${code}-Standard-A` };
    };

    // Fallback if Twilio detects no speech
    if (!SpeechResult) {
      if (lang === 'Hindi') twiml.say(getVoiceOpts('hi-IN'), "मुझे कुछ सुनाई नहीं दिया। कृपया फिर से बोलें।");
      else twiml.say(getVoiceOpts('en-IN'), "I didn't catch that. Please speak again.");

      const gatherRepeat = twiml.gather({ 
        input: 'speech', 
        action: `${BASE_URL}/twilio/chat?patientName=${encodeURIComponent(patientName)}&toPhoneNumber=${encodeURIComponent(toPhoneNumber)}&lang=${lang}`, 
        method: 'POST', timeout: 5, language: langVoice 
      });
      gatherRepeat.say(getVoiceOpts(langVoice), " ");
      return new Response(twiml.toString(), { headers: { 'Content-Type': 'text/xml' } });
    }

    // Fetch patient database from Supabase
    let vitalsContext = 'No hospital records found.';
    try {
      const { supabase } = await import('../utils/db.ts');
      const { data, error } = await supabase.from('patient_data').select('*').limit(50);
      if (!error && data) {
         const p = data.find((d: any) => String(d.name).toLowerCase().includes(patientName.toLowerCase()));
         if (p) {
           vitalsContext = `Heart Risk: ${p.heart_risk_level}, BP: ${p.systolic_bp}/${p.diastolic_bp}, Status: ${p.status}, Latest Symptoms: ${p.symptoms || 'none reported'}`;
         }
      }
    } catch(e) {
      console.error("Supabase edge query error", e);
    }

    try {
      const { GoogleGenerativeAI } = await import('npm:@google/generative-ai');
      const genAIClient = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '');
      const model = genAIClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
      
      const prompt = `
        You are **Swasthya Bandhu AI Caller**, speaking natively to a patient on a voice call in ${lang}.
        Patient Speech Text: "${SpeechResult}"
        Patient Hospital Vitals/Context: ${vitalsContext}

        GOAL: The patient was asked "How are you feeling and when are you planning to visit the doctor?".
        1. Answer any objections (e.g., "Why should I come?") by quoting their Vitals/Context intelligently.
        2. Keep it VERY short (1-3 sentences max) because it will be spoken over the phone.
        3. If the patient agrees to come, says goodbye, or hangs up, evaluate it and end your response with exactly "[END_CALL]" so the system terminates the call cleanly.
        4. DO NOT use markdown, emojis, asterisks, or any special characters. Speak totally naturally. Output exactly in ${lang}.
      `;

      const result = await model.generateContent(prompt);
      let aiResponse = result.response.text().trim();

      let concluded = false;
      if (aiResponse.includes('[END_CALL]')) {
        concluded = true;
        aiResponse = aiResponse.replace('[END_CALL]', '').trim();
      }

      twiml.say(getVoiceOpts(langVoice), aiResponse);

      if (concluded) {
        twiml.hangup();
      } else {
        const gather = twiml.gather({
          input: 'speech',
          action: `${BASE_URL}/twilio/chat?patientName=${encodeURIComponent(patientName)}&toPhoneNumber=${encodeURIComponent(toPhoneNumber)}&lang=${lang}`,
          method: 'POST',
          timeout: 5,
          language: langVoice
        });
        gather.say(getVoiceOpts(langVoice), " ");
      }
    } catch (err: any) {
      console.error('Twilio Gemini Edge error:', err.message);
      twiml.say(getVoiceOpts(langVoice), lang === 'Hindi' ? "माफ़ करना, सिस्टम में त्रुटि है।" : "Sorry, I encountered an internal system error.");
      twiml.hangup();
    }

    return new Response(twiml.toString(), { headers: { 'Content-Type': 'text/xml' } });
  } catch (err: any) {
    console.error("Error in chat:", err);
    return new Response("<Response><Say>System error in chat.</Say></Response>", { headers: { 'Content-Type': 'text/xml' }});
  }
});

// ── POST /twilio/call — Initiate Outbound Call ────────────────────────────
twilioRoutes.post('/call', async (c) => {
  const { phoneNumber, patientName, callType } = await c.req.json();
  if (!phoneNumber || !patientName) return c.json({ error: 'phoneNumber and patientName are required' }, 400);

  const result = await makeAutomatedCall(phoneNumber, patientName, callType || 'follow-up');
  if (!result.success) return c.json({ error: result.error, details: result.rawError }, 500);
  return c.json({ message: 'Call initiated successfully', callSid: result.callSid });
});

export default twilioRoutes;
