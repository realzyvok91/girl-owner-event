const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Serve static website files from public directory
app.use(express.static(path.join(__dirname, 'public')));

let candidates = [];

// Health-check route for UptimeRobot keep-alive
app.get('/ping', (req, res) => {
  res.send('OK');
});

// API: Fetch candidates
app.get('/api/candidates', (req, res) => {
  res.json(candidates);
});

// API: Register candidate
app.post('/api/register', (req, res) => {
  const { id, name, avatar } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'Missing candidate details' });
  }

  const existing = candidates.find(c => c.id === id);
  if (existing) {
    return res.status(400).json({ error: 'You are already registered!' });
  }

  const newCandidate = {
    id,
    name,
    avatar: avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
    chatXp: 0,
    vcHours: 0,
    votes: 0
  };

  candidates.push(newCandidate);
  res.json({ success: true, candidate: newCandidate });
});

// API: Cast Vote
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
