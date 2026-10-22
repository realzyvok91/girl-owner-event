const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
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
const CLIENT_ID = '1562734474243088416';
const CLIENT_SECRET = 'SEiL4-4jv5E36OIhbpNOnf-Bvup8amJ1';

// Helper function for HTTPS POST requests (Works on ALL Node versions)
function httpsPost(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = new URLSearchParams(data).toString();

    const options = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve(body); }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Helper function for HTTPS GET requests
function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);

    const options = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'GET',
      headers: {
        'Authorization': token
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve(body); }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

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

function getRedirectUri(req) {
  const host = req.get('host');
  if (host.includes('localhost')) {
    return `http://${host}/api/auth/discord/callback`;
  }
  return `https://${host}/api/auth/discord/callback`;
}

// 1. Redirect user to Discord
app.get('/api/auth/discord', (req, res) => {
  const redirectUri = getRedirectUri(req);
  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;
  res.redirect(discordAuthUrl);
});

// 2. Callback from Discord
app.get('/api/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  const redirectUri = getRedirectUri(req);

  try {
    const tokenData = await httpsPost('https://discord.com/api/oauth2/token', {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      scope: 'identify'
    });

    if (!tokenData.access_token) {
      console.error('Discord Token Error:', tokenData);
      return res.redirect('/?error=token_failed');
    }

    const userData = await httpsGet('https://discord.com/api/users/@me', `${tokenData.token_type} ${tokenData.access_token}`);

    if (!userData.id) {
      console.error('Discord User Profile Error:', userData);
      return res.redirect('/?error=user_fetch_failed');
    }

    const avatarUrl = userData.avatar 
      ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
      : 'https://cdn.discordapp.com/embed/avatars/0.png';

    const userObj = {
      id: userData.id,
      username: userData.global_name || userData.username,
      avatar: avatarUrl
    };

    const userQuery = encodeURIComponent(JSON.stringify(userObj));
    res.redirect(`/?login_success=${userQuery}`);
  } catch (error) {
    console.error('OAuth Callback Exception:', error);
    res.redirect('/?error=auth_exception');
  }
});

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
