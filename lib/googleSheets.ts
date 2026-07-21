import { google } from 'googleapis'

/**
 * Google Sheets client authenticated with a service account.
 * Credentials come from Vercel env vars; the private key stores its newlines
 * escaped as literal "\n", so they're unescaped here before use.
 */
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

/**
 * Append one feedback row to the mirror sheet, landing below the header row and
 * any previously appended rows. Columns map to: Timestamp | Email | Type |
 * Message | Page URL (A–E). Assumes the tab is named "Sheet1"; override via
 * GOOGLE_SHEETS_TAB if the actual tab name differs.
 */
export async function appendFeedbackRow(row: {
  timestamp: string
  email: string
  type: string
  message: string
  pageUrl: string
}) {
  const sheets = getSheetsClient()
  const tab = process.env.GOOGLE_SHEETS_TAB || 'Sheet1'
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${tab}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[row.timestamp, row.email, row.type, row.message, row.pageUrl]],
    },
  })
}
