// Λέξεις: Telegram bot for the Mini App.
// Node 18+, no dependencies.
//
//   BOT_TOKEN=123:abc WEBAPP_URL=https://you.github.io/lexeis/ REMIND_HOUR=19 TZ=Asia/Nicosia node bot.mjs
//
// What it does:
//   - sets the chat menu button "Учить" that opens the Mini App;
//   - /start greets and subscribes the chat to a daily reminder, /stop unsubscribes;
//   - once a day at REMIND_HOUR (local time from TZ) sends a reminder with an "open" button.
// The bot cannot see the user's words: they live in Telegram CloudStorage on the client side,
// so the reminder is generic.

import fs from 'node:fs';

const TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const REMIND_HOUR = Number(process.env.REMIND_HOUR ?? 19);
const DB_FILE = process.env.DB_FILE ?? './lexeis-bot.json';

if (!TOKEN || !WEBAPP_URL) {
  console.error('Set BOT_TOKEN and WEBAPP_URL (https) environment variables.');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}/`;

// ---------- tiny JSON "database" ----------
const db = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  : { subscribers: [], lastReminderDay: '' };
const subscribers = new Set(db.subscribers);
function persist() {
  fs.writeFileSync(DB_FILE, JSON.stringify({ subscribers: [...subscribers], lastReminderDay: db.lastReminderDay }));
}

// ---------- Bot API ----------
async function call(method, params = {}) {
  const res = await fetch(API + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.ok) {
    const err = new Error(`${method}: ${json.description}`);
    err.code = json.error_code;
    throw err;
  }
  return json.result;
}

const openButton = (text = 'Открыть Λέξεις') => ({
  inline_keyboard: [[{ text, web_app: { url: WEBAPP_URL } }]],
});

async function onMessage(msg) {
  if (msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  const text = (msg.text ?? '').trim();

  if (text.startsWith('/start')) {
    subscribers.add(chatId);
    persist();
    await call('sendMessage', {
      chat_id: chatId,
      text:
        'Γεια σου! Здесь ты учишь свои греческие слова.\n\n' +
        `Каждый день в ${REMIND_HOUR}:00 я напомню о повторении. /stop отключает напоминания.`,
      reply_markup: openButton(),
    });
  } else if (text.startsWith('/stop')) {
    subscribers.delete(chatId);
    persist();
    await call('sendMessage', { chat_id: chatId, text: 'Напоминания выключены. /start включит их снова.' });
  } else {
    await call('sendMessage', { chat_id: chatId, text: 'Слова учатся в приложении:', reply_markup: openButton() });
  }
}

// ---------- daily reminder ----------
function localDayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function maybeRemind() {
  const now = new Date();
  const day = localDayKey(now);
  if (now.getHours() !== REMIND_HOUR || db.lastReminderDay === day) return;
  db.lastReminderDay = day;
  persist();
  for (const chatId of [...subscribers]) {
    try {
      await call('sendMessage', {
        chat_id: chatId,
        text: 'Пора повторить греческие слова 🫒',
        reply_markup: openButton('Повторить'),
      });
    } catch (e) {
      // 403: the user blocked the bot or deleted the chat
      if (e.code === 403) { subscribers.delete(chatId); persist(); }
      else console.error(e.message);
    }
    await new Promise(r => setTimeout(r, 50)); // stay well under rate limits
  }
}

// ---------- startup ----------
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Открыть приложение и включить напоминания' },
    { command: 'stop', description: 'Выключить напоминания' },
  ],
});
await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Учить', web_app: { url: WEBAPP_URL } },
});
await call('deleteWebhook'); // long polling below

setInterval(() => maybeRemind().catch(e => console.error(e.message)), 60_000);
console.log(`Bot is running. Reminders at ${REMIND_HOUR}:00 (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);

let offset = 0;
for (;;) {
  try {
    const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message) onMessage(u.message).catch(e => console.error(e.message));
    }
  } catch (e) {
    console.error(e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
}
