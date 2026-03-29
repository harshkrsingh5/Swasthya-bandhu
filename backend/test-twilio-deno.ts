import twilio from 'npm:twilio';

try {
  console.log("twilio keys:", Object.keys(twilio));
  console.log("twilio.twiml:", twilio.twiml);
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say("Hello");
  console.log(twiml.toString());
} catch(e) {
  console.error("Error:", e);
}
