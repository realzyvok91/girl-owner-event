const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.enable('trust proxy');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- EVENT STATE ---
let eventState = {
  active: false,
  durationHours: 48,
  startTime: null,
  candidates: []
};

const activeVcSessions = new Map();

// --- DISCORD CREDENTIALS ---
const BOT_TOKEN = 'MTU2MjczNDQ3NDI0MzA4ODQxNg.Gao1e7.GGpU5j3bEka3Xh_miXkKLYH3sS6sndXDFo-Qlo';

// --- DISCORD BOT INITIALIZATION ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.on('ready', () => {
  console.log(`🤖 Unfiltered Event Bot logged in as ${client.user.tag}!`);
});

// Track Chat XP (Only active when event is running)
client.on('messageCreate', (message) => {
  if (message.author.bot || !eventState.active) return;
  const candidate = eventState.candidates.find(c => c.id === message.author.id);
  if (candidate) {
    candidate.chatXp += 10;
  }
});

// Track VC Hours (Only active when event is running)
client.on('voiceStateUpdate', (oldState, newState) => {
  if (!eventState.active) return;
  const userId = newState.member.id;
  const candidate = eventState.candidates.find(c => c.id === userId);
  if (!candidate) return;

  if (!oldState.channelId && newState.channelId) {
    activeVcSessions.set(userId, Date.now());
  } else if (oldState.channelId && !newState.channelId) {
    const joinTime = activeVcSessions.get(userId);
    if (joinTime) {
      const hoursSpent = (Date.now() - joinTime) / (1000 * 60 * 60);
      candidate.vcHours = parseFloat((candidate.vcHours + hoursSpent).toFixed(2));
      activeVcSessions.delete(userId);
    }
  }
});

client.login(BOT_TOKEN).catch(err => console.error('Bot login error:', err));

// --- API ENDPOINTS ---
app.get('/ping', (req, res) => res.send('OK'));

// Get current event status & candidates
app.get('/api/status', (req, res) => {
  res.json(eventState);
});

// Candidate Registration
app.post('/api/register', (req, res) => {
  const { id, name, avatar } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Missing details' });

  const existing = eventState.candidates.find(c => c.id === id);
  if (existing) return res.status(400).json({ error: 'Already registered!' });

  eventState.candidates.push({
    id,
    name,
    avatar: avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
    chatXp: 0,
    vcHours: 0,
    votes: 0
  });

  res.json({ success: true });
});

// Vote Endpoint
app.post('/api/vote', (req, res) => {
  if (!eventState.active) return res.status(400).json({ error: 'Event is not active!' });

  const { candidateId } = req.body;
  const candidate = eventState.candidates.find(c => c.id === candidateId);
  if (candidate) {
    candidate.votes += 1;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Candidate not found' });
  }
});

// --- ADMIN CONTROL ENDPOINTS ---
app.post('/api/admin/start', (req, res) => {
  eventState.active = true;
  eventState.startTime = Date.now();
  res.json({ success: true, eventState });
});

app.post('/api/admin/pause', (req, res) => {
  eventState.active = false;
  res.json({ success: true, eventState });
});

app.post('/api/admin/reset', (req, res) => {
  eventState.active = false;
  eventState.startTime = null;
  eventState.candidates = [];
  activeVcSessions.clear();
  res.json({ success: true, eventState });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
