const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();

// Enable trust proxy so Express correctly detects HTTPS on hostings like Render
app.enable('trust proxy');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let candidates = [];
const activeVcSessions = new Map();

// --- DISCORD APPLICATION CREDENTIALS ---
const BOT_TOKEN = 'MTU2MjczNDQ3NDI0MzA4ODQxNg.Gao1e7.GGpU5j3bEka3Xh_miXkKLYH3sS6sndXDFo-Qlo';
const CLIENT_ID = '1562734474243088416';
const CLIENT_SECRET = 'SEiL4-4jv5E36OIhbpNOnf-Bvup8amJ1';

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

// Automatically track Chat XP when messages are sent in text channels
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const candidate = candidates.find(c => c.id === message.author.id);
  if (candidate) {
    candidate.chatXp += 10; // Earns 10 XP per message
  }
});

// Automatically track Voice Channel Hours when users join/leave VCs
client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.member.id;
  const candidate = candidates.find(c => c.id === userId);

  if (!candidate) return;

  // Joined VC
  if (!oldState.channelId && newState.channelId) {
    activeVcSessions.set(userId, Date.now());
  } 
  // Left VC
  else if (oldState.channelId && !newState.channelId) {
    const joinTime = activeVcSessions.get(userId);
    if (joinTime) {
      const hoursSpent = (Date.now() - joinTime) / (1000 * 60 * 60);
      candidate.vcHours = parseFloat((candidate.vcHours + hoursSpent).toFixed(2));
      activeVcSessions.delete(userId);
    }
  }
});

client.login(BOT_TOKEN).catch(err => console.error('Bot login failed:', err));

// --- REAL DISCORD OAUTH2 LOGIN ROUTES ---

// 1. Redirect to Discord OAuth (Forces HTTPS on Render)
app.get('/api/auth/discord', (req, res) => {
  const host = req.get('host');
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const redirectUri = encodeURIComponent(`${protocol}://${host}/api/auth/discord/callback`);
  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
  res.redirect(discordAuthUrl);
});

// 2. Callback from Discord OAuth
app.get('/api/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const host = req.get('host');
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const redirectUri = `${protocol}://${host}/api/auth/discord/callback`;

    // Exchange OAuth code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        scope: 'identify'
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      console.error('Token Exchange Error:', tokenData);
      return res.redirect('/?error=token_failed');
    }

    // Fetch user profile from Discord
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` }
    });

    const userData = await userResponse.json();
    const avatarUrl = userData.avatar 
      ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
      : 'https://cdn.discordapp.com/embed/avatars/0.png';

    const userQuery = encodeURIComponent(JSON.stringify({
      id: userData.id,
      username: userData.global_name || userData.username,
      avatar: avatarUrl
    }));

    res.redirect(`/?login_success=${userQuery}`);
  } catch (error) {
    console.error('OAuth Callback Error:', error);
    res.redirect('/?error=auth_failed');
  }
});

// --- API ENDPOINTS ---
app.get('/ping', (req, res) => res.send('OK'));

app.get('/api/candidates', (req, res) => {
  res.json(candidates);
});

app.post('/api/register', (req, res) => {
  const { id, name, avatar } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Missing details' });

  const existing = candidates.find(c => c.id === id);
  if (existing) return res.status(400).json({ error: 'Already registered on leaderboard!' });

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
    candidate.votes += 1;
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
