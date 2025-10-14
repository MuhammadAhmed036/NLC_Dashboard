export const runtime = 'nodejs';

import { fetchSheetData } from '../../lib/sheets';

export async function GET() {
  try {
    const data = await fetchSheetData();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data', message: err?.message || 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}