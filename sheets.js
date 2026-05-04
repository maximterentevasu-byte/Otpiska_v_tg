import { google } from "googleapis";

const LEAVERS_SHEET = "leavers";
const ANSWERS_SHEET = "answers";

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!email || !key || !process.env.GOOGLE_SHEET_ID) {
    throw new Error("Missing Google Sheets env vars. Check GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID.");
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

export async function ensureHeaders(questionKeys = []) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureSheetExists(sheets, spreadsheetId, LEAVERS_SHEET);
  await ensureSheetExists(sheets, spreadsheetId, ANSWERS_SHEET);

  await writeHeaderIfEmpty(sheets, spreadsheetId, `${LEAVERS_SHEET}!A1:J1`, [
    "user_id",
    "username",
    "first_name",
    "group_id",
    "group_title",
    "left_at",
    "status",
    "interview_link",
    "answers_json",
    "completed_at"
  ]);

  await writeHeaderIfEmpty(sheets, spreadsheetId, `${ANSWERS_SHEET}!A1:${columnLetter(3 + questionKeys.length)}1`, [
    "user_id",
    "username",
    ...questionKeys,
    "completed_at"
  ]);
}

async function ensureSheetExists(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === title);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }]
    }
  });
}

async function writeHeaderIfEmpty(sheets, spreadsheetId, range, values) {
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range }).catch(() => null);
  if (existing?.data?.values?.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [values] }
  });
}

function columnLetter(index) {
  let letter = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    index = Math.floor((index - mod) / 26);
  }
  return letter;
}

async function getRows(sheetName) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`
  });
  return res.data.values || [];
}

export async function findLeaverRow(userId, groupId = null) {
  const rows = await getRows(LEAVERS_SHEET);
  for (let i = 1; i < rows.length; i += 1) {
    const rowUserId = String(rows[i][0] || "");
    const rowGroupId = String(rows[i][3] || "");
    if (rowUserId === String(userId) && (!groupId || rowGroupId === String(groupId))) {
      return { rowNumber: i + 1, row: rows[i] };
    }
  }
  return null;
}

export async function appendLeaver({ user, chat, leftAt, interviewLink }) {
  const existing = await findLeaverRow(user.id, chat.id);
  if (existing) return existing;

  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${LEAVERS_SHEET}!A:J`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        user.id,
        user.username ? `@${user.username}` : "",
        user.first_name || "",
        chat.id,
        chat.title || "",
        leftAt,
        "left_detected",
        interviewLink,
        "",
        ""
      ]]
    }
  });

  return findLeaverRow(user.id, chat.id);
}

export async function updateLeaverStatusByUserId(userId, status) {
  const found = await findLeaverRow(userId);
  if (!found) return false;

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${LEAVERS_SHEET}!G${found.rowNumber}:G${found.rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status]] }
  });
  return true;
}

export async function saveInterviewResult({ user, answers, questionKeys }) {
  const found = await findLeaverRow(user.id);
  const completedAt = new Date().toISOString();
  const answersJson = JSON.stringify(answers);
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (found) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${LEAVERS_SHEET}!G${found.rowNumber}:J${found.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["completed", found.row[7] || "", answersJson, completedAt]]
      }
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${ANSWERS_SHEET}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        user.id,
        user.username ? `@${user.username}` : "",
        ...questionKeys.map((key) => answers[key] || ""),
        completedAt
      ]]
    }
  });
}
