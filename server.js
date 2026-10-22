const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.enable('trust proxy');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURATION ---
const ADMIN_USER_ID = '1139956195696836701';
const REQUIRED_ROLE_ID = '1547310077197815888';
const BOT_TOKEN = 'MTU2MjczNDQ3NDI0MzA4ODQxNg.Gao1e7.GGpU5j3bEka3Xh_miXkKLYH3sS6sndXDFo-Qlo';

// --- EVENT STATE ---
let eventState = {
  active: false,
  durationHours: 48,
  startTime: null,
  candidates: []
};

const activeVcSessions = new Map();

// --- DISCORD BOT INITIALIZATION ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.on('ready', () => {
  console.log(`🤖 Unfiltered Event Bot logged in as ${client.user.tag}!`);
});

// Track Chat XP (Active when event is running)
client.on('messageCreate', (message) => {
  if (message.author.bot || !eventState.active) return;
  const candidate = eventState.candidates.find(c => c.id === message.author.id);
  if (candidate) {
    candidate.chatXp += 10;
  }
});

// Track VC Hours (Active when event is running)
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

// Strict Role Verification Function across Bot Guilds
async function verifyUserRole(userId) {
  try {
    for (const [guildId, guild] of client.guilds.cache) {
      try {
        const member = await guild.members.fetch(userId);
        if (member && member.roles.cache.has(REQUIRED_ROLE_ID)) {
          return true;
        }
      } catch (e) {
        // Member not found in this guild cache, check next
      }
    }
    return false;
  } catch (err) {
    console.error('Role verification error:', err);
    return false;
  }
}

// --- ADMIN SECURITY MIDDLEWARE ---
function verifyAdmin(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (userId === ADMIN_USER_ID) {
    next();
  } else {
    res.status(403).json({ error: 'Unauthorized: Admin access denied.' });
  }
}

// --- API ENDPOINTS ---
app.get('/ping', (req, res) => res.send('OK'));

app.get('/api/status', (req, res) => {
  res.json(eventState);
});

// Candidate Registration (Strictly checks for role ID 1547310077197815888)
app.post('/api/register', async (req, res) => {
  const { id, name, avatar } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Missing details' });

  const existing = eventState.candidates.find(c => c.id === id);
  if (existing) return res.status(400).json({ error: 'Already registered!' });

  const hasRole = await verifyUserRole(id);
  if (!hasRole) {
    return res.status(403).json({ error: 'Access denied: Only members with the required role can participate in this event!' });
  }

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

// Self-Removal Endpoint
app.post('/api/leave', (req, res) => {
  const { id } = req.body;
  const index = eventState.candidates.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ error: 'Candidate not found.' });

  eventState.candidates.splice(index, 1);
  activeVcSessions.delete(id);
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
app.post('/api/admin/start', verifyAdmin, (req, res) => {
  eventState.active = true;
  eventState.startTime = Date.now();
  res.json({ success: true, eventState });
});

app.post('/api/admin/pause', verifyAdmin, (req, res) => {
  eventState.active = false;
  res.json({ success: true, eventState });
});

app.post('/api/admin/reset', verifyAdmin, (req, res) => {
  eventState.active = false;
  eventState.startTime = null;
  eventState.candidates = [];
  activeVcSessions.clear();
  res.json({ success: true, eventState });
});

// Admin Remove Participant Endpoint
app.post('/api/admin/remove-candidate', verifyAdmin, (req, res) => {
  const { candidateId } = req.body;
  const index = eventState.candidates.findIndex(c => c.id === candidateId);
  if (index === -1) return res.status(404).json({ error: 'Candidate not found.' });

  eventState.candidates.splice(index, 1);
  activeVcSessions.delete(candidateId);
  res.json({ success: true, eventState });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
