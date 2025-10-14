import { fetchSheetData } from '../../../app/lib/sheets';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let currentData = [];
  let currentHash = '';
  const intervalMs = Number(process.env.SSE_POLL_INTERVAL_MS || 5000);
  const heartbeatMs = Number(process.env.SSE_HEARTBEAT_MS || 15000);

  const hash = (obj) => {
    try {
      return require('crypto').createHash('sha256').update(JSON.stringify(obj)).digest('hex');
    } catch {
      return '' + Date.now();
    }
  };

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    currentData = await fetchSheetData();
    currentHash = hash(currentData);
    send({ type: 'init', data: currentData, ts: Date.now() });
  } catch (err) {
    send({ type: 'error', message: err?.message || 'Failed to fetch initial data' });
  }

  let lastHeartbeat = Date.now();
  const timer = setInterval(async () => {
    try {
      const fresh = await fetchSheetData();
      const freshHash = hash(fresh);
      if (freshHash !== currentHash) {
        currentData = fresh;
        currentHash = freshHash;
        send({ type: 'update', data: fresh, ts: Date.now() });
      }
      const now = Date.now();
      if (now - lastHeartbeat >= heartbeatMs) {
        res.write(`:heartbeat ${now}\n\n`);
        lastHeartbeat = now;
      }
    } catch (err) {
      send({ type: 'error', message: err?.message || 'Polling failed' });
    }
  }, intervalMs);

  req.on('close', () => {
    clearInterval(timer);
    try { res.end(); } catch {}
  });
}