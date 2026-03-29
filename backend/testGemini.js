require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
async function test() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-1.5-flash' });
    const prompt = `Translate this to Hindi: Hello`;
    const aiRes = await model.generateContent(prompt);
    console.log(aiRes.response.text());
  } catch (err) {
    console.error('ERROR_MESSAGE:', err.message);
  }
}
test();
