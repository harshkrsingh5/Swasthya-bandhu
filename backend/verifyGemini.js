require('dotenv').config();

async function test() {
  try {
    const key = process.env.GEMINI_API_KEY;
    console.log('Testing Key:', key ? key.slice(0, 10) + '...' : 'MISSING');
    
    if (!key) return;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say hi' }] }]
      })
    });

    const data = await res.json();
    
    if (res.ok) {
      console.log('API IS ACTIVE AND GENERATING!');
      console.log('Response:', data.candidates[0].content.parts[0].text);
    } else {
      console.log('API FAILED.');
      console.log('Error details:', JSON.stringify(data, null, 2));
    }
  } catch(e) {
    console.log('Network Error:', e.message);
  }
}

test();
