import { google } from 'googleapis';

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizePrivateKey(pk) {
  return pk ? pk.replace(/\\n/g, '\n') : pk;
}

function stripSurroundingQuotes(s) {
  if (typeof s !== 'string') return s;
  // Remove common accidental wrapping quotes from env values
  return s.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
}

export function getGoogleCredentials() {
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
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  let private_key = normalizePrivateKey(stripSurroundingQuotes(process.env.GOOGLE_PRIVATE_KEY));
  if (client_email && private_key) {
    return { client_email, private_key };
  }
  if (credentialsError) throw credentialsError;
  throw new Error('Missing Google credentials: set GOOGLE_CREDENTIALS or GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY');
}

export async function fetchSheetData() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error('Missing GOOGLE_SHEET_ID');

  const auth = new google.auth.GoogleAuth({
    credentials: getGoogleCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const rangeEnv = process.env.GOOGLE_SHEET_RANGE; // e.g., "MySheet!A1:Z1000" or "A1:Z1000"
  const sheetNameEnv = process.env.GOOGLE_SHEET_NAME; // e.g., "My Sheet"

  const quoteTitle = (title) => `'${String(title).replace(/'/g, "''")}'`;

  let range;
  if (rangeEnv) {
    // Always ensure the sheet title is properly quoted, even if provided in rangeEnv
    if (rangeEnv.includes('!')) {
      const [titlePart, cellPart] = rangeEnv.split('!', 2);
      const rawTitle = String(titlePart || '').replace(/^'|'$/g, '');
      const quotedTitle = quoteTitle(rawTitle);
      range = `${quotedTitle}!${cellPart || 'A1:Z1000'}`;
    } else {
      let sheetTitle = sheetNameEnv;
      if (!sheetTitle) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
        sheetTitle = meta.data.sheets?.[0]?.properties?.title;
      }
      if (!sheetTitle) throw new Error('Unable to determine sheet name for range. Set GOOGLE_SHEET_NAME or include sheet in GOOGLE_SHEET_RANGE.');
      const quotedTitle = quoteTitle(sheetTitle);
      range = `${quotedTitle}!${rangeEnv}`;
    }
  } else {
    let sheetTitle = sheetNameEnv;
    if (!sheetTitle) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      sheetTitle = meta.data.sheets?.[0]?.properties?.title;
    }
    if (!sheetTitle) throw new Error('Unable to determine sheet name. Set GOOGLE_SHEET_NAME or GOOGLE_SHEET_RANGE.');
    const quotedTitle = quoteTitle(sheetTitle);
    range = `${quotedTitle}!A1:Z1000`;
  }

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = res.data.values || [];
  if (values.length === 0) return [];
  const [headers, ...rows] = values;
  return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] || ''])));
}
