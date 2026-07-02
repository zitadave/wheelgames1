import TelegramBot from "node-telegram-bot-api";
const TelegramBotClass = typeof TelegramBot === "function" ? TelegramBot : ((TelegramBot as any).default || TelegramBot);
console.log("constructor is:", typeof TelegramBotClass);
try {
  const bot = new (TelegramBotClass as any)('token', { polling: false });
  console.log("Bot instantiated successfully!", !!bot);
} catch (e) {
  console.error("Failed to instantiate:", e.message);
}
