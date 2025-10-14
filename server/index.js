const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const crypto = require('crypto');

// Load env from .env.local if available (Next.js dev file)
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  try {
    dotenv.config({ path: envPath });
  } catch (e) {
    console.warn('Could not parse .env.local with dotenv, will try JSON fallback');
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getGoogleCredentials() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  let credentialsError = null;
  if (raw) {
    const asJson = tryParseJson(raw);
    if (asJson) return asJson;
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      const asJson2 = tryParseJson(decoded);
      if (asJson2) return asJson2;
    } catch {}
    credentialsError = new Error('Invalid GOOGLE_CREDENTIALS: provide valid JSON or base64 JSON');
  }
  // Fallback to separate env vars
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  let private_key = process.env.GOOGLE_PRIVATE_KEY;
  if (private_key) private_key = private_key.replace(/\\n/g, '\n');
  if (client_email && private_key) {
    return { client_email, private_key };
  }
  // Try server/credentials.json if present
  const credPath = path.resolve(__dirname, './credentials.json');
  if (fs.existsSync(credPath)) {
    const txt = fs.readFileSync(credPath, 'utf8');
    const json = tryParseJson(txt);
    if (json) return json;
  }
  // Try parsing .env.local raw as JSON (if user put JSON there)
  if (fs.existsSync(envPath)) {
    const txt = fs.readFileSync(envPath, 'utf8');
    const json = tryParseJson(txt);
    if (json) return json;
  }
  // If we had an invalid GOOGLE_CREDENTIALS value specifically, surface that
  if (credentialsError) throw credentialsError;
  throw new Error('Missing Google credentials: set GOOGLE_CREDENTIALS or GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY, or add server/credentials.json');
}

async function fetchSheetData() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error('Missing GOOGLE_SHEET_ID');

  const auth = new google.auth.GoogleAuth({
    credentials: getGoogleCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const rangeEnv = process.env.GOOGLE_SHEET_RANGE; // e.g., "MySheet!A1:Z1000" or "A1:Z1000"
  const sheetNameEnv = process.env.GOOGLE_SHEET_NAME; // e.g., "My Sheet"

  let range;
  if (rangeEnv) {
    // If user provided a range without a sheet name, we will prefix with sheet title
    let sheetTitle = sheetNameEnv;
    if (!rangeEnv.includes('!')) {
      if (!sheetTitle) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
        sheetTitle = meta.data.sheets?.[0]?.properties?.title;
      }
      if (!sheetTitle) throw new Error('Unable to determine sheet name for range. Set GOOGLE_SHEET_NAME or include sheet in GOOGLE_SHEET_RANGE.');
      const quotedTitle = `'${String(sheetTitle).replace(/'/g, "''")}'`;
      range = `${quotedTitle}!${rangeEnv}`;
    } else {
      // Use the range as provided (assume caller handled quoting if needed)
      range = rangeEnv;
    }
  } else {
    let sheetTitle = sheetNameEnv;
    if (!sheetTitle) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      sheetTitle = meta.data.sheets?.[0]?.properties?.title;
    }
    if (!sheetTitle) throw new Error('Unable to determine sheet name. Set GOOGLE_SHEET_NAME or GOOGLE_SHEET_RANGE.');
    const quotedTitle = `'${String(sheetTitle).replace(/'/g, "''")}'`;
    range = `${quotedTitle}!A1:Z1000`;
  }

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = res.data.values || [];
  if (values.length === 0) return [];
  const [headers, ...rows] = values;
  return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])));
}

const app = express();
app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:3001'] }));

// Health check
app.get('/', (req, res) => {
  res.send('OK');
});

app.get('/sheets', async (req, res) => {
  try {
    const data = await fetchSheetData();
    res.json(data);
  } catch (err) {
    console.error('Server: Error fetching Google Sheets data:', err);
    res.status(500).json({ error: 'Failed to fetch data', message: err?.message || 'Unknown error' });
  }
});

// Server-Sent Events stream that emits updates when sheet data changes
app.get('/sheets/stream', async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // CORS for SSE
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.flushHeaders?.();

  const sendEvent = (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
      try { res.end(); } catch {}
    }
  };

  const hash = (obj) => {
    const json = JSON.stringify(obj);
    return crypto.createHash('sha256').update(json).digest('hex');
  };

  let currentData = [];
  let currentHash = '';

  // Initial fetch and emit
  try {
    currentData = await fetchSheetData();
    currentHash = hash(currentData);
    sendEvent({ type: 'init', data: currentData, ts: Date.now() });
  } catch (err) {
    console.error('SSE init error:', err);
    sendEvent({ type: 'error', message: err?.message || 'Failed to fetch initial data' });
  }

  // Poll for changes and emit updates only when hash changes
  const intervalMs = Number(process.env.SSE_POLL_INTERVAL_MS || 5000);
  const heartbeatMs = Number(process.env.SSE_HEARTBEAT_MS || 15000);
  let lastHeartbeat = Date.now();
  const timer = setInterval(async () => {
    try {
      const fresh = await fetchSheetData();
      const freshHash = hash(fresh);
      if (freshHash !== currentHash) {
        currentData = fresh;
        currentHash = freshHash;
        sendEvent({ type: 'update', data: fresh, ts: Date.now() });
      }
      // Heartbeat to keep connection alive
      const now = Date.now();
      if (now - lastHeartbeat >= heartbeatMs) {
        res.write(`:heartbeat ${now}\n\n`);
        lastHeartbeat = now;
      }
    } catch (err) {
      console.error('SSE polling error:', err);
      sendEvent({ type: 'error', message: err?.message || 'Polling failed' });
    }
  }, intervalMs);

  // Cleanup when client disconnects
  req.on('close', () => {
    clearInterval(timer);
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Node server running on http://localhost:${PORT}`);
});