import { google } from "googleapis";
import { PHONE_HEADER, PHONE_KEY } from "./questions.js";

const LEAVERS_SHEET = "Отписавшиеся";
const ANSWERS_SHEET = "Ответы";

const LEAVERS_HEADERS = [
  "ID пользователя",
  "Юзернейм",
  "Имя",
  "Ссылка на пользователя",
  "ID группы",
  "Название группы",
  "Дата отписки",
  "Статус",
  "Ссылка на интервью",
  "Готовое сообщение для админа",
  "Ответы JSON",
  "Дата завершения опроса",
  "Телефон бонусной карты"
];

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

export async function ensureHeaders(questions = []) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureSheetExists(sheets, spreadsheetId, LEAVERS_SHEET);
  await ensureSheetExists(sheets, spreadsheetId, ANSWERS_SHEET);

  await writeHeaderIfEmpty(sheets, spreadsheetId, `${LEAVERS_SHEET}!A1:${columnLetter(LEAVERS_HEADERS.length)}1`, LEAVERS_HEADERS);

  const answerHeaders = [
    "ID пользователя",
    "Юзернейм",
    "Имя",
    ...questions.map((q) => q.header || q.key),
    PHONE_HEADER,
    "Дата завершения опроса"
  ];

  await writeHeaderIfEmpty(sheets, spreadsheetId, `${ANSWERS_SHEET}!A1:${columnLetter(answerHeaders.length)}1`, answerHeaders);
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
    range: `${sheetName}!A:AZ`
  });
  return res.data.values || [];
}

function userDisplayName(user) {
  if (user.username) return `@${user.username}`;
  return user.first_name || String(user.id);
}

function escapeForFormula(value) {
  return String(value || "").replace(/"/g, "'");
}

function makeUserLinkFormula(user) {
  const label = escapeForFormula(userDisplayName(user));

  // Для русской локали Google Sheets разделитель аргументов в формулах — точка с запятой.
  // Если у пользователя есть username, админ сможет открыть публичный Telegram-профиль.
  if (user.username) {
    const cleanUsername = String(user.username).replace(/^@/, "");
    return `=HYPERLINK("https://t.me/${cleanUsername}"; "@${escapeForFormula(cleanUsername)}")`;
  }

  // Fallback для пользователей без username. Ссылка открывает профиль по Telegram ID в приложении.
  return `=HYPERLINK("tg://user?id=${user.id}"; "${label}")`;
}

function makeInterviewLinkFormula(interviewLink) {
  return `=HYPERLINK("${escapeForFormula(interviewLink)}"; "Старт")`;
}

export function makeAdminMessage(interviewLink) {
  return [
    "Привет! 👋",
    "",
    "Недавно ты отписался от нашего канала Pick me. Нам очень важно понять, что можно улучшить.",
    "",
    "Будем благодарны, если пройдёшь короткий опрос — это займёт пару минут.",
    "",
    "🎁 За участие начислим 50 рублей на бонусную карту Pick me.",
    "",
    "Поехали! 🚀",
    interviewLink
  ].join("\n");
}

export async function findLeaverRow(userId, groupId = null) {
  const rows = await getRows(LEAVERS_SHEET);
  for (let i = 1; i < rows.length; i += 1) {
    const rowUserId = String(rows[i][0] || "");
    const rowGroupId = String(rows[i][4] || "");
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
  const adminMessage = makeAdminMessage(interviewLink);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${LEAVERS_SHEET}!A:M`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        user.id,
        user.username ? `@${user.username}` : "",
        user.first_name || "",
        makeUserLinkFormula(user),
        chat.id,
        chat.title || "",
        leftAt,
        "Отписался",
        makeInterviewLinkFormula(interviewLink),
        adminMessage,
        "",
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
    range: `${LEAVERS_SHEET}!H${found.rowNumber}:H${found.rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status]] }
  });
  return true;
}

export async function saveInterviewResult({ user, answers, questions }) {
  const found = await findLeaverRow(user.id);
  const completedAt = new Date().toISOString();
  const answersJson = JSON.stringify(answers, null, 0);
  const phone = answers[PHONE_KEY] || "";
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (found) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${LEAVERS_SHEET}!H${found.rowNumber}:M${found.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          "Опрос пройден",
          found.row[8] || "",
          found.row[9] || "",
          answersJson,
          completedAt,
          phone
        ]]
      }
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${ANSWERS_SHEET}!A:AZ`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        user.id,
        user.username ? `@${user.username}` : "",
        user.first_name || "",
        ...questions.map((q) => answers[q.key] || ""),
        phone,
        completedAt
      ]]
    }
  });
}
