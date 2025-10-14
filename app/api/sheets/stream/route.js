export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60; // allow long-lived SSE connections

import crypto from 'crypto';
import { fetchSheetData } from '../../../lib/sheets';

export async function GET(request) {
  const encoder = new TextEncoder();
  const intervalMs = Number(process.env.SSE_POLL_INTERVAL_MS || 5000);
  const heartbeatMs = Number(process.env.SSE_HEARTBEAT_MS || 15000);

  const hash = (obj) => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');

  let currentData = [];
  let currentHash = '';

  const stream = new ReadableStream({
    async start(controller) {
      // Initial payload
      try {
        currentData = await fetchSheetData();
        currentHash = hash(currentData);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'init', data: currentData, ts: Date.now() })}\n\n`));
      } catch (err) {
        console.error('[api/sheets/stream] Initial fetch error:', err?.message || err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: err?.message || 'Failed to fetch initial data' })}\n\n`));
      }

      let lastHeartbeat = Date.now();
      const timer = setInterval(async () => {
        try {
          const fresh = await fetchSheetData();
          const freshHash = hash(fresh);
          if (freshHash !== currentHash) {
            currentData = fresh;
            currentHash = freshHash;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'update', data: fresh, ts: Date.now() })}\n\n`));
          }
          // Heartbeat
          const now = Date.now();
          if (now - lastHeartbeat >= heartbeatMs) {
            controller.enqueue(encoder.encode(`:heartbeat ${now}\n\n`));
            lastHeartbeat = now;
          }
        } catch (err) {
          console.error('[api/sheets/stream] Poll error:', err?.message || err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: err?.message || 'Polling failed' })}\n\n`));
        }
      }, intervalMs);

      // Clean up on client abort
      const signal = request?.signal;
      const abort = () => {
        clearInterval(timer);
        try { controller.close(); } catch {}
      };
      if (signal) {
        signal.addEventListener('abort', abort);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}