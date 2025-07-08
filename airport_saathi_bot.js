// Airport Saathi Bot: supports both text inputs and voice notes (auto-transcribed)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { OpenAI } = require('openai');
const { twiml: { MessagingResponse } } = require('twilio');

// === Embedded Delhi Airport Data (can be moved to JSON later) ===
const delhiAirportData = {
  terminals: {
    T1: {
      description: `Terminal 1 (T1) is Delhi’s upgraded domestic terminal, serving low-cost carriers (IndiGo, SpiceJet, Akasa, etc.). T1D is for departures, T1C for arrivals. Baggage claim is at T1C. Gates are numbered 2–23. Restrooms and a small food court are available airside. Check-in at least 60–75 minutes before your flight.`,
      airlines: ['IndiGo', 'SpiceJet', 'Akasa'],
      facilities: ['Restrooms', 'Food court', 'Lounges', 'Smoking zone', 'Baby care', 'Medical help'],
    },
    T2: {
      description: `Terminal 2 (T2) is currently closed for renovation as of April 2025. All flights have shifted to T1. If your ticket says T2, go to T1 instead.`,
      status: 'closed',
    },
    T3: {
      description: `Terminal 3 (T3) is the large international terminal, also serving many domestic full-service airlines (Air India, Vistara). Arrivals are on the lower level, departures on the upper. All international flights use T3. Domestic gates: 27–62. Facilities include lounges, duty-free, food, shopping, and more.`,
      arrivals: `Follow signs to immigration (for international), then baggage claim, then customs. Domestic arrivals exit directly to the arrivals hall. Info counters and exit doors to car parks, taxis, metro, etc. are at ground level.`,
      departures: `Check-in counters for international flights are on the departures level. After check-in, go through immigration, then security, then to your gate. Domestic passengers skip immigration but use the same departure hall.`,
      facilities: ['Lounges', 'Duty-free', 'Food', 'Shopping', 'Restrooms', 'Prayer rooms', 'Baby care', 'Medical help'],
    },
  },
  procedures: {
    domestic_arrival: `Deplane, follow signs to baggage claim, collect luggage, exit to arrivals hall. Taxis/rideshare and metro are straight ahead.`,
    domestic_departure: `Arrive at terminal, check in or use kiosk, drop luggage, proceed to security, check departure monitors for your gate, board.`,
    international_arrival: `Deplane at T3, follow signs to immigration, show passport and landing card, collect baggage, clear customs, exit to public area.`,
    international_departure: `Arrive at T3, check in, proceed to immigration, then security, then to your gate.`,
  },
  facilities: {
    lounges: `T1: Encalm Lounge (24/7, airside). T3: Air India Maharajah, Centurion, Plaza Premium, Encalm Privé, etc. Walk-in access for a fee or via membership.`,
    food: `Each terminal has cafes, fast food, and dining. T3 has coffee shops, bakeries, bars, and North/South Indian cuisine. T1 has a basic food court.`,
    shopping: `Duty-free in T3 International. All terminals have retail stores, pharmacies, electronics, clothing, and Indian handicrafts.`,
    wifi: `Free Wi-Fi (“GMR FREE WIFI”) throughout the airport. Connect, enter your mobile number, get OTP, set a 4-digit PIN.`,
    atms: `ATMs and currency exchange counters in all terminals, pre- and post-security.`,
    smoking_zones: `Designated smoking rooms airside: T1 food court, T3 arrival halls, boarding corridors, near food courts.`,
    prayer_rooms: `Quiet prayer rooms in each terminal, post-security, near lounges or food court.`,
    baby_care: `Childcare rooms with nursing stations and changing tables in each terminal. Strollers available at info desks.`,
    medical: `24/7 medical centers in each terminal. T1 has a permanent clinic, T3 has three. Call helpdesks or terminal emergency numbers for assistance.`,
    lost_and_found: `Lost & Found desks in each terminal. T3: +91-99580-98651 (24x7). Items older than 5 days: +91-11-42489617. Items kept up to 90 days.`,
    info_counters: `Help desks in each terminal, often near baggage claim or arrivals.`,
    water: `Drinking water refill stations near gates.`,
    charging: `Phone-charging kiosks and mobile charging points throughout.`,
    cloakroom: `Luggage storage available in public area of each terminal.`,
  },
  accessibility: {
    wheelchair: `Wheelchair assistance available on request. Meet-and-assist counters near check-in/info desks. Priority lanes for check-in/security. Accessible restrooms, ramps, elevators. Pre-book with airline or ask at help desk.`,
    buggy: `Free electric buggies for elderly, PRM, pregnant women, or those with difficulty walking. Operate in all terminals and between concourses.`,
    sunflower: `Hidden Disabilities Sunflower program: ask at Help Desk for a lanyard for extra support.`,
    strollers: `Foldable strollers free at info desks for infants/toddlers.`,
    meet_and_greet: `Paid concierge meet-and-assist services (“Atithya”) for fast-track, porter help, and escort.`,
  },
  transport: {
    metro: `Orange Line (Airport Express) links T3 to New Delhi Railway Station/downtown (~23 min). Magenta Line serves T1. Trains every ~15 min. Follow signs from arrivals to metro station.`,
    shuttle: `Free inter-terminal shuttle bus every ~20 min, connects T1, T3 (and T2/Aerocity if running).`,
    city_bus: `DTC air-conditioned buses (BlueLine) between airport and central Delhi 24/7. Stop near Centaur Hotel (2 km from T3, 6.5 km from T1). Head to bus stop outside T3 arrivals.`,
    taxi: `Prepaid taxis and app-based cabs (Ola, Uber) serve IGI. Follow signs to taxi queue in arrivals. For metered taxi, pay at counter and get a slip. App cabs pick up outside.`,
    car_rental: `Rental company desks in arrival halls (T1/T3) or outside.`,
    parking: `Multi-level car parks at all terminals. Pre-book online for discount. Drop-off zones outside each terminal. Pick-up zones after terminal buildings at arrivals.`,
    other: `Auto-rickshaws are not common at IGI. Use metered/authorized cabs.`,
  },
  links: {
    airport_map: 'https://www.airportmaps.com/DEL',
    airindia_info: 'https://www.airindia.com/in/en/travel-information/airport-information/delhi.html',
    lounges: 'https://www.loungepair.com/blog/delhi-indira-gandhi-international-airport-paid-lounges-ultimate-guide',
    babycare: 'https://www.momspumphere.com/places/place/details/3545_delhi-indira-gandhi-international-airport-babycare-room',
    medical: 'https://speciality.medicaldialogues.in/emergency-medical-services-at-igi-airport-an-analysis',
    lost_and_found: 'https://www.globalindiaexpress.com/blog/lost-and-found/',
    prayer_room: 'https://www.halaltrip.com/mosque-details/11247/prayer-room-new-delhi-airport-terminal-1/',
  }
};

// Initialize OpenAI (v4+)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

// === System prompt with embedded Delhi Airport Data summary ===
const SYSTEM_PROMPT = `You are Airport Saathi, a friendly WhatsApp assistant for non-tech-savvy flyers at Delhi Airport. Use the following airport data to answer user questions accurately and helpfully. Respond in simple, clear language, and support voice-to-text input, quick replies, images, and videos for clarity when appropriate.\n\nDELHI AIRPORT DATA (for reference):\n${JSON.stringify(delhiAirportData, null, 2)}\n\nGuide users through every airport phase: arrival, check-in, security, navigation, boarding, disruptions, and special needs. Always use the above data for factual queries.`;

// In-memory user context: { [userId]: [ { role, content, timestamp } ] }
const userContexts = {};
// In-memory user profiles: { [userId]: { language, favoriteAirline, name, ... } }
const userProfiles = {};
// In-memory feedback tracker: { [userId]: { count, awaitingFeedback, feedbackLog: [] } }
const userFeedback = {};

// Helper to extract preferences from user message (simple version)
function updateUserProfile(userId, userMsg) {
  if (!userProfiles[userId]) userProfiles[userId] = {};
  const msg = userMsg.toLowerCase();
  // Language preference
  if (msg.includes('hindi')) userProfiles[userId].language = 'Hindi';
  if (msg.includes('english')) userProfiles[userId].language = 'English';
  // Favorite airline
  if (msg.includes('vistara')) userProfiles[userId].favoriteAirline = 'Vistara';
  if (msg.includes('air india')) userProfiles[userId].favoriteAirline = 'Air India';
  if (msg.includes('indigo')) userProfiles[userId].favoriteAirline = 'IndiGo';
  if (msg.includes('spicejet')) userProfiles[userId].favoriteAirline = 'SpiceJet';
  // Name (if user says "my name is ...")
  const nameMatch = userMsg.match(/my name is ([a-zA-Z]+)/i);
  if (nameMatch) userProfiles[userId].name = nameMatch[1];
}

// === Query classification and data lookup ===
function getDelhiAirportAnswer(userMsg) {
  const msg = userMsg.toLowerCase();
  // Terminal info
  if (msg.includes('terminal 1') || msg.includes('t1')) return delhiAirportData.terminals.T1.description;
  if (msg.includes('terminal 2') || msg.includes('t2')) return delhiAirportData.terminals.T2.description;
  if (msg.includes('terminal 3') || msg.includes('t3')) return delhiAirportData.terminals.T3.description;
  if (msg.match(/which airlines.*t1/)) return `Airlines at T1: ${delhiAirportData.terminals.T1.airlines.join(', ')}`;
  if (msg.match(/which airlines.*t3/)) return `Airlines at T3: Air India, Vistara, and other full-service carriers.`;

  // Arrivals/Departures
  if (msg.includes('domestic arrival')) return delhiAirportData.procedures.domestic_arrival;
  if (msg.includes('domestic departure')) return delhiAirportData.procedures.domestic_departure;
  if (msg.includes('international arrival')) return delhiAirportData.procedures.international_arrival;
  if (msg.includes('international departure')) return delhiAirportData.procedures.international_departure;
  if (msg.includes('arrivals') && msg.includes('t3')) return delhiAirportData.terminals.T3.arrivals;
  if (msg.includes('departures') && msg.includes('t3')) return delhiAirportData.terminals.T3.departures;

  // Facilities
  if (msg.includes('lounge')) return delhiAirportData.facilities.lounges;
  if (msg.includes('food') || msg.includes('eat') || msg.includes('restaurant')) return delhiAirportData.facilities.food;
  if (msg.includes('shopping') || msg.includes('shop')) return delhiAirportData.facilities.shopping;
  if (msg.includes('wifi') || msg.includes('wi-fi')) return delhiAirportData.facilities.wifi;
  if (msg.includes('atm') || msg.includes('bank')) return delhiAirportData.facilities.atms;
  if (msg.includes('smoking')) return delhiAirportData.facilities.smoking_zones;
  if (msg.includes('prayer')) return delhiAirportData.facilities.prayer_rooms;
  if (msg.includes('baby') || msg.includes('childcare') || msg.includes('stroller')) return delhiAirportData.facilities.baby_care;
  if (msg.includes('medical') || msg.includes('clinic') || msg.includes('doctor')) return delhiAirportData.facilities.medical;
  if (msg.includes('lost and found') || msg.includes('lost item')) return delhiAirportData.facilities.lost_and_found;
  if (msg.includes('info counter') || msg.includes('help desk')) return delhiAirportData.facilities.info_counters;
  if (msg.includes('water')) return delhiAirportData.facilities.water;
  if (msg.includes('charging') || msg.includes('charge phone')) return delhiAirportData.facilities.charging;
  if (msg.includes('cloakroom') || msg.includes('luggage storage')) return delhiAirportData.facilities.cloakroom;
  if (msg.includes('restroom') || msg.includes('toilet') || msg.includes('washroom')) return 'Restrooms are available throughout all terminals, both pre- and post-security.';

  // Accessibility & Special Assistance
  if (msg.includes('wheelchair') || msg.includes('reduced mobility')) return delhiAirportData.accessibility.wheelchair;
  if (msg.includes('buggy')) return delhiAirportData.accessibility.buggy;
  if (msg.includes('sunflower')) return delhiAirportData.accessibility.sunflower;
  if (msg.includes('meet and greet') || msg.includes('concierge')) return delhiAirportData.accessibility.meet_and_greet;

  // Transport
  if (msg.includes('metro')) return delhiAirportData.transport.metro;
  if (msg.includes('shuttle')) return delhiAirportData.transport.shuttle;
  if (msg.includes('bus')) return delhiAirportData.transport.city_bus;
  if (msg.includes('taxi') || msg.includes('cab')) return delhiAirportData.transport.taxi;
  if (msg.includes('car rental')) return delhiAirportData.transport.car_rental;
  if (msg.includes('parking')) return delhiAirportData.transport.parking;

  // Links
  if (msg.includes('map')) return `You can view the airport map here: ${delhiAirportData.links.airport_map}`;
  if (msg.includes('air india')) return `Air India airport info: ${delhiAirportData.links.airindia_info}`;
  if (msg.includes('lounge info')) return `Lounge info: ${delhiAirportData.links.lounges}`;
  if (msg.includes('baby care')) return `Baby care info: ${delhiAirportData.links.babycare}`;
  if (msg.includes('medical info')) return `Medical info: ${delhiAirportData.links.medical}`;
  if (msg.includes('lost and found info')) return `Lost & Found info: ${delhiAirportData.links.lost_and_found}`;
  if (msg.includes('prayer room')) return `Prayer room info: ${delhiAirportData.links.prayer_room}`;

  // Fallback
  return null;
}

// Helper: Check if LLM answer is vague or uncertain
function isVagueOrUncertain(answer) {
  if (!answer || answer.trim().length < 10) return true;
  const vaguePhrases = [
    'i am not sure',
    'i\'m not sure',
    'i do not know',
    'i don\'t know',
    'cannot help',
    'no information',
    'sorry',
    'unsure',
    'uncertain',
    'not available',
    'not found',
    'unknown',
    'n/a',
    'no data',
    'no details',
    'no info'
  ];
  const lower = answer.toLowerCase();
  return vaguePhrases.some(phrase => lower.includes(phrase));
}

app.post('/whatsapp', async (req, res) => {
  console.log('Received WhatsApp message:', req.body); // Debug log
  let userMsg = req.body.Body || '';
  const userId = req.body.From || 'unknown_user';
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  // Check for WhatsApp location message (Twilio sends Latitude/Longitude fields)
  let userLocation = null;
  if (req.body.Latitude && req.body.Longitude) {
    userLocation = {
      latitude: req.body.Latitude,
      longitude: req.body.Longitude
    };
    userMsg = `User shared their location: Latitude ${req.body.Latitude}, Longitude ${req.body.Longitude}`;
  }

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

  // Update user profile with new preferences if mentioned
  updateUserProfile(userId, userMsg);

  // Initialize or update user context
  if (!userContexts[userId]) userContexts[userId] = [];
  // Purge messages older than 1 hour
  userContexts[userId] = userContexts[userId].filter(msg => now - msg.timestamp <= ONE_HOUR);
  // Add current user message
  userContexts[userId].push({ role: 'user', content: userMsg, timestamp: now });

  // Feedback loop logic
  if (!userFeedback[userId]) userFeedback[userId] = { count: 0, awaitingFeedback: false, feedbackLog: [] };
  const feedbackState = userFeedback[userId];

  // If awaiting feedback, log it and reset
  if (feedbackState.awaitingFeedback) {
    const feedback = userMsg.trim().toLowerCase();
    if (feedback === 'yes' || feedback === 'no') {
      feedbackState.feedbackLog.push({ feedback, timestamp: now });
      feedbackState.awaitingFeedback = false;
      feedbackState.count = 0; // reset count after feedback
      // Thank the user for feedback
      const twilioResp = new MessagingResponse();
      twilioResp.message('Thank you for your feedback!');
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twilioResp.toString());
      return;
    }
    // If not yes/no, continue as normal
  }

  try {
    // Build personalized system prompt
    let personalizedPrompt = SYSTEM_PROMPT;
    const profile = userProfiles[userId];
    if (profile) {
      let profileSummary = '';
      if (profile.name) profileSummary += `\nUser name: ${profile.name}`;
      if (profile.language) profileSummary += `\nPreferred language: ${profile.language}`;
      if (profile.favoriteAirline) profileSummary += `\nFavorite airline: ${profile.favoriteAirline}`;
      if (profileSummary) {
        personalizedPrompt += `\n\nUSER PROFILE:${profileSummary}`;
        personalizedPrompt += '\nPersonalize your response accordingly.';
      }
    }
    const messages = [
      { role: 'system', content: personalizedPrompt },
      ...userContexts[userId].map(({ role, content }) => ({ role, content }))
    ];
    const data = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 500
    });
    let botReply = data.choices[0].message.content;

    // Error handling/fallback: If answer is vague or uncertain, send fallback
    if (isVagueOrUncertain(botReply)) {
      botReply = "I'm not sure about that, but you can contact the airport help desk at +91-99580-98651 for assistance.";
    }

    // Add assistant reply to context
    userContexts[userId].push({ role: 'assistant', content: botReply, timestamp: Date.now() });

    // After sending the main reply, increment feedback count
    feedbackState.count++;
    // After every 3 user interactions, ask for feedback
    let askedForFeedback = false;
    if (feedbackState.count >= 3 && !feedbackState.awaitingFeedback) {
      const twilioResp = new MessagingResponse();
      twilioResp.message('Was this answer helpful? Reply YES or NO.');
      feedbackState.awaitingFeedback = true;
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twilioResp.toString());
      askedForFeedback = true;
    }
    if (askedForFeedback) return;

    const twilioResp = new MessagingResponse();

    // Multimodal: Send airport map image if LLM requests it
    if (botReply.includes('[SEND_AIRPORT_MAP]')) {
      botReply = botReply.replace('[SEND_AIRPORT_MAP]', '').trim();
      const msg = twilioResp.message(botReply);
      // Example map image (replace with actual image if available)
      msg.media('https://www.airportmaps.com/images/delhi-airport-map.jpg');
    } else if (botReply.match(/\[QUICK_REPLIES:([^\]]+)\]/)) {
      // Multimodal: Send quick replies if LLM requests it
      const match = botReply.match(/\[QUICK_REPLIES:([^\]]+)\]/);
      const options = match[1].split('|').map(opt => opt.trim());
      botReply = botReply.replace(match[0], '').trim();
      const msg = twilioResp.message(botReply + '\n\nQuick replies: ' + options.join(' | '));
      // Note: WhatsApp via Twilio does not support true quick reply buttons, so we show as text
    } else {
      twilioResp.message(botReply);
    }

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

