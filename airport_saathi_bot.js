// Airport Saathi Bot: supports both text inputs and voice notes (auto-transcribed)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { Configuration, OpenAIApi } = require('openai');
const { twiml: { MessagingResponse } } = require('twilio');

// Initialize OpenAI
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
// Twilio credentials for media fetch
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => {
  console.log('Incoming request:', req.method, req.url);
  next();
});

const SYSTEM_PROMPT = `You are Airport Saathi, a friendly WhatsApp assistant for non-tech-savvy flyers. Guide users through every airport phase:

A) Arrival & Entry: terminal/gate identification, ticket & ID checks, counter location
B) Check-In & Baggage: queue guidance, allowance rules, kiosk use
C) Security & Immigration: remove items, illustrated/video guides, voice fallback
D) In-Terminal Navigation: interactive indoor maps, find restrooms/lounges/ATMs, signboard images
E) Boarding: gate updates, boarding-group alerts, last-call prompts
F) Disruptions & Special Needs: delay/gate-change alerts, lost-&-found help, wheelchair requests

Respond in simple vernacular or regional language when appropriate, support voice-to-text input, quick replies, images, and videos for clarity.`;

app.post('/whatsapp', async (req, res) => {
  console.log('Received WhatsApp message:', req.body); // Debug log
  let userMsg = req.body.Body || '';

  // If a voice note is sent, transcribe it
  if (parseInt(req.body.NumMedia) > 0 && req.body.MediaContentType0.startsWith('audio/')) {
    try {
      const mediaUrl = req.body.MediaUrl0;
      const audioResp = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        auth: { username: accountSid, password: authToken },
      });
      const formData = new FormData();
      formData.append('file', audioResp.data, { filename: 'voice.ogg' });
      formData.append('model', 'whisper-1');

      const transcriptResp = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        }
      );
      userMsg = transcriptResp.data.text;
    } catch (err) {
      console.error('Transcription error:', err);
    }
  }

  try {
    // Handle both text (Body) and transcribed voice input
    const { data } = await openai.createChatCompletion({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
      ],
      max_tokens: 500
    });
    const botReply = data.choices[0].message.content;

    const twilioResp = new MessagingResponse();
    twilioResp.message(botReply);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twilioResp.toString());

  } catch (err) {
    console.error('Chat error:', err);
    const twilioResp = new MessagingResponse();
    twilioResp.message('Sorry, something went wrong. Please try again later.');
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twilioResp.toString());
  }
});

app.get('/test', (req, res) => {
  res.send('Test endpoint working!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Airport Saathi running on port ${PORT}`));
