import * as TelegramBot from "node-telegram-bot-api";

export function registerCommandHandlers(
  bot: TelegramBot,
  logBot: (msg: string) => void,
  checkRegisteredAndHandle: (msg: TelegramBot.Message, handler: () => void) => Promise<void>,
  sendSupportCard: (chatId: number) => void
) {
  bot.onText(/\/language/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🌐 <b>Select your language / ቋንቋ ይምረጡ:</b>", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🇬🇧 English", callback_data: "lang_en" }],
          [{ text: "🇪🇹 Amharic", callback_data: "lang_am" }]
        ]
      }
    });
  });

  bot.onText(/\/support/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
      sendSupportCard(msg.chat.id);
    });
  });
}
