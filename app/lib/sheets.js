import 'server-only';
import { google } from "googleapis";

function getGoogleCredentials() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (raw) {
    // Try direct JSON
    try {
      return JSON.parse(raw);
    } catch {
      // Try base64-encoded JSON
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        return JSON.parse(decoded);
      } catch {
        throw new Error(
          "Invalid GOOGLE_CREDENTIALS: must be valid JSON or base64-encoded JSON of service account credentials"
        );
      }
    }
  }
  // Fallback to separate env vars
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  let private_key = process.env.GOOGLE_PRIVATE_KEY;
  if (private_key) {
    // Replace escaped newlines if present
    private_key = private_key.replace(/\\n/g, "\n");
  }
  if (client_email && private_key) {
    return { client_email, private_key };
  }
  throw new Error(
    "Missing Google credentials: set GOOGLE_CREDENTIALS or GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY"
  );
}

export async function getSheetData() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEET_ID environment variable");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: getGoogleCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Sheet1!A1:Q100",
  });

  const values = res.data.values || [];
  if (values.length === 0) {
    return [];
  }
  const [headers, ...rows] = values;
  return rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] || ""]))
  );
}
