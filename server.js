const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.enable('trust proxy');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let candidates = [];
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

client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  const candidate = candidates.find(c => c.id === message.author.id);
  if (candidate) candidate.chatXp += 10;
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.member.id;
  const candidate = candidates.find(c => c.id === userId);
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

app.get('/api/candidates', (req, res) => res.json(candidates));

app.post('/api/register', (req, res) => {
  const { id, name, avatar } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Missing details' });

  const existing = candidates.find(c => c.id === id);
  if (existing) return res.status(400).json({ error: 'Already registered!' });

  candidates.push({
    id,
    name,
    avatar: avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
    chatXp: 0,
    vcHours: 0,
    votes: 0
  });

  res.json({ success: true });
});

app.post('/api/vote', (req, res) => {
  const { candidateId } = req.body;
  const candidate = candidates.find(c => c.id === candidateId);
  if (candidate) {
    candidate.votes +=1;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Candidate not found' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
