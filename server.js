const express = require('express');
const path = require('path');
const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.enable('trust proxy');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------
const ADMIN_USER_ID = '1139956195696836701';
const GUILD_ID = '1537842105945165939';
const REQUIRED_ROLE_ID = '1547310077197815888';
const REQUIRED_ROLE_NAME = '・ Hawties ・ ᶻz ・';

// The token MUST come from an environment variable (Render -> Environment).
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const EVENT_DURATION_MS = 48 * 60 * 60 * 1000;
const XP_PER_MESSAGE = 10;
const XP_COOLDOWN_MS = 15 * 1000; // anti-spam: max 1 XP award per user per 15s
const VC_SCORE_PER_HOUR = 100;
const VOTE_SCORE = 50;
const ALLOW_SELF_VOTE = false;

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');

// ---------------------------------------------------------------------------
// EVENT STATE (persisted to disk)
// status: 'idle' | 'running' | 'paused' | 'ended'
// ---------------------------------------------------------------------------
let state = {
  status: 'idle',
  elapsedMs: 0,        // time already used while running (before runStartedAt)
  runStartedAt: null,  // timestamp of the current running stretch
  candidates: [],      // { id, name, avatar, chatXp, vcMs }
  voters: {}           // voterId -> candidateId   (one vote per user)
};

const activeVcSessions = new Map(); // userId -> timestamp when current tracked stretch began
const lastXpAt = new Map();         // userId -> timestamp of last XP award

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    state = { ...state, ...saved };
    console.log(`💾 Loaded saved state (${state.candidates.length} candidates, status ${state.status})`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not load saved state:', e.message);
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(state));
    } catch (e) {
      console.error('Could not save state:', e.message);
    }
  }, 300);
}

loadState();

// ---------------------------------------------------------------------------
// TIME / VC HELPERS
// ---------------------------------------------------------------------------
const isRunning = () => state.status === 'running';
const elapsedNow = () =>
  state.elapsedMs + (isRunning() && state.runStartedAt ? Date.now() - state.runStartedAt : 0);
const remainingNow = () => Math.max(0, EVENT_DURATION_MS - elapsedNow());
const findCandidate = (id) => state.candidates.find((c) => c.id === id);

// Credit the VC time accumulated since the session's last checkpoint.
function settleVc(userId, until = Date.now()) {
  const since = activeVcSessions.get(userId);
  const cand = findCandidate(userId);
  if (since && cand && until > since) cand.vcMs += until - since;
  if (since) activeVcSessions.set(userId, until);
}

function settleAllVc(until = Date.now()) {
  for (const id of activeVcSessions.keys()) settleVc(id, until);
}

// Start tracking candidates who are ALREADY sitting in a voice channel.
async function seedVcSessions() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const now = Date.now();
    for (const c of state.candidates) {
      const vs = guild.voiceStates.cache.get(c.id);
      if (vs && vs.channelId && !activeVcSessions.has(c.id)) activeVcSessions.set(c.id, now);
    }
  } catch (e) {
    console.error('VC seed error:', e.message);
  }
}

// Auto-finish the event when the 48h are used up.
function checkEventEnd() {
  if (!isRunning() || remainingNow() > 0) return;
  const endAt = state.runStartedAt + (EVENT_DURATION_MS - state.elapsedMs);
  settleAllVc(endAt);
  activeVcSessions.clear();
  state.elapsedMs = EVENT_DURATION_MS;
  state.runStartedAt = null;
  state.status = 'ended';
  saveState();
  console.log('🏁 Event ended automatically.');
}
setInterval(checkEventEnd, 5000);
setInterval(() => { if (isRunning()) { settleAllVc(); saveState(); } }, 60 * 1000);

// ---------------------------------------------------------------------------
// DISCORD BOT
// (No privileged intents needed: single-member lookups use REST.)
// ---------------------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once('ready', async () => {
  console.log(`🤖 Unfiltered Event Bot logged in as ${client.user.tag}!`);
  if (isRunning()) await seedVcSessions();
});

// Chat XP
client.on('messageCreate', (message) => {
  if (message.author.bot || message.guildId !== GUILD_ID) return;
  checkEventEnd();
  if (!isRunning()) return;
  const cand = findCandidate(message.author.id);
  if (!cand) return;

  const now = Date.now();
  if (now - (lastXpAt.get(cand.id) || 0) < XP_COOLDOWN_MS) return;
  lastXpAt.set(cand.id, now);
  cand.chatXp += XP_PER_MESSAGE;
  saveState();
});

// VC hours
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.guild.id !== GUILD_ID) return;
  checkEventEnd();
  if (!isRunning()) return;
  const userId = newState.id;
  if (!findCandidate(userId)) return;

  if (!oldState.channelId && newState.channelId) {
    activeVcSessions.set(userId, Date.now());          // joined VC
  } else if (oldState.channelId && !newState.channelId) {
    settleVc(userId);                                   // left VC
    activeVcSessions.delete(userId);
    saveState();
  }
});

if (!BOT_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN env var is not set — bot is offline, role checks will fail.');
} else {
  client.login(BOT_TOKEN).catch((err) => console.error('Bot login error:', err.message));
}

// ---------------------------------------------------------------------------
// DISCORD LOOKUPS
// ---------------------------------------------------------------------------
async function fetchGuildMember(userId) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    return await guild.members.fetch({ user: userId, force: true });
  } catch (err) {
    if (err.code !== 10007 /* Unknown Member */) {
      console.error(`Member lookup error for ${userId}:`, err.message);
    }
    return null;
  }
}

async function hasRequiredRole(userId) {
  if (userId === ADMIN_USER_ID) return true; // admin bypass
  const member = await fetchGuildMember(userId);
  return !!member && member.roles.cache.has(REQUIRED_ROLE_ID);
}

async function isGuildMember(userId) {
  if (userId === ADMIN_USER_ID) return true;
  return !!(await fetchGuildMember(userId));
}

// ---------------------------------------------------------------------------
// AUTH — the browser sends its Discord OAuth access token; we ask Discord who
// it belongs to. The user id can therefore no longer be spoofed.
// ---------------------------------------------------------------------------
const tokenCache = new Map(); // token -> { user, exp }
const TOKEN_TTL_MS = 5 * 60 * 1000;

async function resolveUser(req) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const token = m[1];

  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;

  try {
    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u.id) return null;
    const user = {
      id: u.id,
      username: u.global_name || u.username,
      avatar: u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
        : 'https://cdn.discordapp.com/embed/avatars/0.png'
    };
    if (tokenCache.size > 2000) tokenCache.clear();
    tokenCache.set(token, { user, exp: Date.now() + TOKEN_TTL_MS });
    return user;
  } catch (e) {
    console.error('Token verification error:', e.message);
    return null;
  }
}

async function requireAuth(req, res, next) {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in with Discord again.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.id !== ADMIN_USER_ID) {
    return res.status(403).json({ error: 'Unauthorized: Admin access denied.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// PUBLIC VIEW OF THE STATE
// ---------------------------------------------------------------------------
function voteCounts() {
  const counts = {};
  for (const target of Object.values(state.voters)) counts[target] = (counts[target] || 0) + 1;
  return counts;
}

function publicState(viewerId) {
  const now = Date.now();
  const counts = voteCounts();

  const candidates = state.candidates.map((c) => {
    const live = activeVcSessions.has(c.id) && isRunning() ? now - activeVcSessions.get(c.id) : 0;
    const vcHours = parseFloat(((c.vcMs + live) / 3600000).toFixed(2));
    const votes = counts[c.id] || 0;
    return {
      id: c.id,
      name: c.name,
      avatar: c.avatar,
      chatXp: c.chatXp,
      vcHours,
      votes,
      inVc: live > 0,
      score: Math.round(c.chatXp + vcHours * VC_SCORE_PER_HOUR + votes * VOTE_SCORE)
    };
  });
  candidates.sort((a, b) => b.score - a.score);

  return {
    status: state.status,
    active: isRunning(),
    durationMs: EVENT_DURATION_MS,
    remainingMs: state.status === 'idle' ? EVENT_DURATION_MS : remainingNow(),
    candidates,
    me: viewerId
      ? { registered: !!findCandidate(viewerId), votedFor: state.voters[viewerId] || null }
      : null
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/ping', (req, res) => res.send('OK'));

app.get('/api/status', async (req, res) => {
  checkEventEnd();
  const user = await resolveUser(req); // optional
  res.json(publicState(user && user.id));
});

app.post('/api/register', requireAuth, async (req, res) => {
  if (state.status === 'ended') return res.status(400).json({ error: 'The event has ended.' });

  const name = String(req.body.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  if (!name) return res.status(400).json({ error: 'Please enter a display name.' });
  if (findCandidate(req.user.id)) return res.status(400).json({ error: 'You are already registered!' });

  if (!(await hasRequiredRole(req.user.id))) {
    return res.status(403).json({ error: `You don't have the '${REQUIRED_ROLE_NAME}' role!` });
  }
  if (findCandidate(req.user.id)) return res.status(400).json({ error: 'You are already registered!' }); // re-check after await

  state.candidates.push({
    id: req.user.id,
    name,
    avatar: req.user.avatar, // taken from Discord, not from the client
    chatXp: 0,
    vcMs: 0
  });

  // If they're already in a voice channel while the event is live, start tracking now.
  if (isRunning()) {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const vs = guild.voiceStates.cache.get(req.user.id);
      if (vs && vs.channelId) activeVcSessions.set(req.user.id, Date.now());
    } catch (_) { /* ignore */ }
  }

  saveState();
  res.json({ success: true });
});

function removeCandidate(id) {
  const index = state.candidates.findIndex((c) => c.id === id);
  if (index === -1) return false;
  state.candidates.splice(index, 1);
  activeVcSessions.delete(id);
  lastXpAt.delete(id);
  // Votes FOR the removed candidate are released so those voters can vote again.
  for (const [voter, target] of Object.entries(state.voters)) {
    if (target === id) delete state.voters[voter];
  }
  saveState();
  return true;
}

app.post('/api/leave', requireAuth, (req, res) => {
  if (!removeCandidate(req.user.id)) return res.status(404).json({ error: 'Candidate not found.' });
  res.json({ success: true });
});

app.post('/api/vote', requireAuth, async (req, res) => {
  checkEventEnd();
  if (!isRunning()) return res.status(400).json({ error: 'Event is not active!' });

  const candidateId = String(req.body.candidateId || '');
  if (!findCandidate(candidateId)) return res.status(404).json({ error: 'Candidate not found' });
  if (!ALLOW_SELF_VOTE && candidateId === req.user.id) {
    return res.status(400).json({ error: "You can't vote for yourself." });
  }
  if (state.voters[req.user.id]) return res.status(400).json({ error: 'You have already voted!' });

  if (!(await isGuildMember(req.user.id))) {
    return res.status(403).json({ error: 'Only Unfiltered server members can vote.' });
  }
  // Re-check after the async call so double-clicks can't sneak two votes in.
  if (state.voters[req.user.id]) return res.status(400).json({ error: 'You have already voted!' });
  if (!findCandidate(candidateId)) return res.status(404).json({ error: 'Candidate not found' });

  state.voters[req.user.id] = candidateId;
  saveState();
  res.json({ success: true });
});

// --- ADMIN ---------------------------------------------------------------
app.post('/api/admin/start', requireAuth, requireAdmin, async (req, res) => {
  if (state.status === 'ended') {
    return res.status(400).json({ error: 'Event has ended. Reset it to start a new one.' });
  }
  if (!isRunning()) {
    state.status = 'running';
    state.runStartedAt = Date.now();
    await seedVcSessions();
    saveState();
  }
  res.json({ success: true, ...publicState(req.user.id) });
});

app.post('/api/admin/pause', requireAuth, requireAdmin, (req, res) => {
  if (isRunning()) {
    settleAllVc();
    activeVcSessions.clear();
    state.elapsedMs = elapsedNow();
    state.runStartedAt = null;
    state.status = 'paused';
    saveState();
  }
  res.json({ success: true, ...publicState(req.user.id) });
});

app.post('/api/admin/reset', requireAuth, requireAdmin, (req, res) => {
  state = { status: 'idle', elapsedMs: 0, runStartedAt: null, candidates: [], voters: {} };
  activeVcSessions.clear();
  lastXpAt.clear();
  saveState();
  res.json({ success: true, ...publicState(req.user.id) });
});

app.post('/api/admin/remove-candidate', requireAuth, requireAdmin, (req, res) => {
  if (!removeCandidate(String(req.body.candidateId || ''))) {
    return res.status(404).json({ error: 'Candidate not found.' });
  }
  res.json({ success: true, ...publicState(req.user.id) });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
