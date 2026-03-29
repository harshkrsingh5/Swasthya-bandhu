const https = require('https');

function postReq(path, data) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'abdblukbngbapatrqvkr.supabase.co',
      port: 443,
      path: `/functions/v1/api/twilio${path}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('Testing /conversation-start...');
  let res = await postReq('/conversation-start?patientName=Test&toPhoneNumber=+123', '');
  console.log(`Status: ${res.status}\nHeaders:`, res.headers, `\nBody: ${res.body}\n`);

  console.log('Testing /conversation-greet (English, Digits=1)...');
  res = await postReq('/conversation-greet?patientName=Test&toPhoneNumber=+123', 'Digits=1');
  console.log(`Status: ${res.status}\nBody: ${res.body}\n`);
  
  console.log('Testing /conversation-greet (Malayalam, Digits=4)...');
  res = await postReq('/conversation-greet?patientName=Test&toPhoneNumber=+123', 'Digits=4');
  console.log(`Status: ${res.status}\nBody: ${res.body}\n`);
  
  console.log('Testing /chat (SpeechResult=Hello)...');
  res = await postReq('/chat?patientName=Test&toPhoneNumber=+123&lang=English', 'SpeechResult=Hello');
  console.log(`Status: ${res.status}\nBody: ${res.body}\n`);
}

runTests();
