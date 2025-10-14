export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { fetchSheetData } from '../../lib/sheets';

export async function GET() {
  try {
    const data = await fetchSheetData();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const detail = {
      error: 'Failed to fetch data',
      message: err?.message || 'Unknown error',
      code: err?.code,
    };
    console.error('[api/sheets] Error:', detail);
    return new Response(JSON.stringify(detail), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}