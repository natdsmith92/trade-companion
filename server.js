const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies (for Zapier webhook)
app.use(express.json({ limit: '5mb' }));

// Store the latest ingested email in memory
// In production, you'd use a database — this works for v1
let latestPlan = null;

// ──────────────────────────────────────────────
// WEBHOOK: Zapier POSTs Mancini's email here
// ──────────────────────────────────────────────
app.post('/api/ingest', (req, res) => {
  const { date, subject, body } = req.body;

  if (!body) {
    return res.status(400).json({ error: 'Missing email body' });
  }

  latestPlan = {
    date: date || new Date().toISOString(),
    subject: subject || 'Trade Plan',
    body: body,
    receivedAt: new Date().toISOString()
  };

  console.log(`[${new Date().toISOString()}] Ingested plan: "${subject}" from ${date}`);

  res.json({ status: 'ok', receivedAt: latestPlan.receivedAt });
});

// ──────────────────────────────────────────────
// GET: App fetches the latest plan
// ──────────────────────────────────────────────
app.get('/api/latest-plan', (req, res) => {
  if (!latestPlan) {
    return res.status(404).json({ error: 'No plan loaded yet' });
  }
  res.json(latestPlan);
});

// ──────────────────────────────────────────────
// HEALTH CHECK (Render uses this to verify the service is up)
// ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasPlan: !!latestPlan });
});

// ──────────────────────────────────────────────
// SERVE THE FRONTEND
// ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// All other routes serve the main app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TradeLadder running on port ${PORT}`);
  console.log(`Webhook endpoint: POST /api/ingest`);
  console.log(`Latest plan:      GET  /api/latest-plan`);
});
