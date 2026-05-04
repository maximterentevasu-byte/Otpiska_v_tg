import "dotenv/config";
import express from "express";
import { Bot, webhookCallback } from "grammy";
import { QUESTIONS } from "./questions.js";
import {
  appendLeaver,
  ensureHeaders,
  findLeaverRow,
  saveInterviewResult,
  updateLeaverStatusByUserId
} from "./sheets.js";

const requiredEnv = ["TELEGRAM_BOT_TOKEN", "BOT_USERNAME", "GOOGLE_SHEET_ID"];
for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`Missing required env var: ${name}`);
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const sessions = new Map();
const questionKeys = QUESTIONS.map((q) => q.key);
const allowedGroupIds = (process.env.ALLOWED_GROUP_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function isAllowedGroup(chatId) {
  if (allowedGroupIds.length === 0) return true;
  return allowedGroupIds.includes(String(chatId));
}

function makeInterviewLink(userId) {
  return `https://t.me/${process.env.BOT_USERNAME}?start=interview_${userId}`;
}

function isMemberStatus(status) {
  return ["member", "administrator", "creator", "restricted"].includes(status);
}

function isLeftStatus(status) {
  return ["left", "kicked"].includes(status);
}

bot.catch((err) => {
  console.error("Bot error:", err.error || err);
});

bot.command("start", async (ctx) => {
  const payload = ctx.match?.trim();
  const user = ctx.from;

  if (!payload?.startsWith("interview_")) {
    await ctx.reply(
      "Привет! Я бот для коротких интервью после выхода из группы. Открой ссылку, которую тебе прислал админ."
    );
    return;
  }

  const payloadUserId = payload.replace("interview_", "");
  if (String(user.id) !== String(payloadUserId)) {
    await ctx.reply("Эта ссылка предназначена для другого пользователя. Попроси админа отправить твою персональную ссылку.");
    return;
  }

  const found = await findLeaverRow(user.id);
  if (!found) {
    await ctx.reply("Не нашёл твою запись в базе. Попроси админа проверить Google Sheets.");
    return;
  }

  sessions.set(user.id, {
    index: 0,
    answers: {}
  });

  await updateLeaverStatusByUserId(user.id, "interview_started");
  await ctx.reply(QUESTIONS[0].text);
});

bot.on("message:text", async (ctx) => {
  const user = ctx.from;
  const session = sessions.get(user.id);

  if (!session) {
    await ctx.reply("Чтобы начать интервью, открой персональную ссылку от админа.");
    return;
  }

  const currentQuestion = QUESTIONS[session.index];
  session.answers[currentQuestion.key] = ctx.message.text.trim();
  session.index += 1;

  if (session.index < QUESTIONS.length) {
    sessions.set(user.id, session);
    await ctx.reply(QUESTIONS[session.index].text);
    return;
  }

  await saveInterviewResult({
    user,
    answers: session.answers,
    questionKeys
  });
  sessions.delete(user.id);

  await ctx.reply("Спасибо! Ответы записаны. Ты очень помог нам улучшить группу 🙌");
});

bot.on("chat_member", async (ctx) => {
  const update = ctx.chatMember;
  const chat = update.chat;

  if (!isAllowedGroup(chat.id)) return;

  const oldStatus = update.old_chat_member?.status;
  const newStatus = update.new_chat_member?.status;
  const user = update.new_chat_member?.user;

  if (!user || user.is_bot) return;

  if (isMemberStatus(oldStatus) && isLeftStatus(newStatus)) {
    const leftAt = new Date().toISOString();
    const interviewLink = makeInterviewLink(user.id);

    await appendLeaver({ user, chat, leftAt, interviewLink });
    console.log(`User left: ${user.id} ${user.username || ""} from ${chat.id}. Link: ${interviewLink}`);
  }
});

async function main() {
  await ensureHeaders(questionKeys);

  const app = express();
  app.get("/", (_req, res) => res.send("tg-custdev-bot is running"));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  const secretPath = `/telegram/${process.env.WEBHOOK_SECRET || "webhook"}`;
  app.use(secretPath, webhookCallback(bot, "express"));

  const port = Number(process.env.PORT || 3000);
  app.listen(port, async () => {
    console.log(`Server listening on port ${port}`);

    if (process.env.PUBLIC_URL) {
      const webhookUrl = `${process.env.PUBLIC_URL}${secretPath}`;
      await bot.api.setWebhook(webhookUrl, {
        allowed_updates: ["message", "chat_member"]
      });
      console.log(`Webhook set: ${webhookUrl}`);
    } else {
      console.warn("PUBLIC_URL is empty. Webhook was not set automatically.");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
