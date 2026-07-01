import TelegramBot from "node-telegram-bot-api";
import { supabase } from "./supabase.js";
import { Server } from "socket.io";

let botInfo: any = null;

const botLogs: string[] = [];
export function logBot(msg: string) {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] ${msg}`;
  console.log(formatted);
  botLogs.push(formatted);
  if (botLogs.length > 200) {
    botLogs.shift();
  }
}

export function getBotLogs() {
  return botLogs;
}

// In-memory user states
interface UserState {
  step: 'idle' | 'deposit_amount' | 'deposit_bank' | 'deposit_msg' | 'withdraw_amount' | 'withdraw_bank' | 'withdraw_account';
  amount?: number;
  bank?: string;
}

const userStates = new Map<string, UserState>();

// In-memory pending requests store
interface PendingRequest {
  id: string;
  type: 'deposit' | 'withdraw';
  userId: string;
  username: string;
  fullName: string;
  amount: number;
  bank?: string;
  account?: string;
  receiptText?: string;
  chatId: number;
}

const pendingRequests = new Map<string, PendingRequest>();

// Admin Chat IDs
const adminChatIds = new Set<number>();

// Initialize Admin IDs from environment variables if present
const adminEnv = process.env.TELEGRAM_ADMIN_IDS;
if (adminEnv) {
  adminEnv.split(',').forEach(id => {
    const trimmed = id.trim();
    if (trimmed) adminChatIds.add(parseInt(trimmed, 10));
  });
}

// Generate unique Ref Codes (e.g., C8OM3PUXUX, OTY2A7PFR2)
function generateRef(length = 10): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function initTelegramBot(io: Server): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not found. Telegram bot is disabled.");
    return null;
  }

  const appUrl = process.env.APP_URL || "https://ais-pre-ak5sjlemx7qmzbzccvr2vl-11202815657.europe-west2.run.app";
  const bot = new TelegramBot(token, { polling: true });

  try {
    botInfo = await bot.getMe();
    console.log(`Telegram Bot @${botInfo.username} initialized.`);

    // Set bot commands
    await bot.setMyCommands([
      { command: "start", description: "Launch the game hub and display menu" },
      { command: "play", description: "Launch the Web App immediately" },
      { command: "deposit", description: "Deposit ETB into your balance" },
      { command: "withdraw", description: "Withdraw ETB from your balance" },
      { command: "support", description: "Show contact support details" },
      { command: "setadmin", description: "Set current chat as Admin for approvals" }
    ]);

    // Update main bot menu button to open the Web App
    try {
      await (bot as any).setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "Play Game 🎮",
          web_app: { url: appUrl }
        }
      });
      console.log("Telegram Bot menu button configured.");
    } catch (btnErr) {
      console.warn("Couldn't set Telegram WebApp menu button:", btnErr);
    }
  } catch (err) {
    console.error("Failed to fetch Bot details or setup commands:", err);
  }

  // --- HELPERS FOR FLOW START ---
  const handleSupabaseError = (chatId: number, error: any): boolean => {
    if (!error) return false;
    const errMsg = error.message || String(error);
    if (errMsg.includes("Could not find the table") || errMsg.includes("relation \"users\" does not exist") || errMsg.includes("relation \"public.users\" does not exist")) {
      const errorMsg = `⚠️ *Database Setup Required* ⚠️\n\n` +
        `Your Supabase project is connected, but the required database tables have not been created yet!\n\n` +
        `👉 *How to fix this in 30 seconds:*\n` +
        `1️⃣ In your AI Studio Code Editor, open the file named *supabase-schema.sql* (located in the root folder).\n` +
        `2️⃣ Copy the entire content (the SQL statements) of that file.\n` +
        `3️⃣ Open your *Supabase Dashboard*.\n` +
        `4️⃣ Navigate to the *SQL Editor* tab on the left sidebar.\n` +
        `5️⃣ Click *New Query*, paste the SQL code, and click *Run*.\n\n` +
        `Once executed, your game and bot will instantly work with full database persistence! 🚀`;
      bot.sendMessage(chatId, errorMsg, { parse_mode: "Markdown" });
      return true;
    }
    return false;
  };

  const startDepositFlow = (chatId: number, userId: string) => {
    logBot(`startDepositFlow triggered for userId=${userId}, chatId=${chatId}`);
    try {
      userStates.set(userId, { step: 'deposit_amount' });
      bot.sendMessage(chatId, "💰 *ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።*\n\n_(Please type the amount of ETB you want to deposit, minimum 10 ETB):_", { parse_mode: "Markdown" });
      logBot(`startDepositFlow message sent successfully to chatId=${chatId}`);
    } catch (e: any) {
      logBot(`Error in startDepositFlow for userId=${userId}: ${e?.message || e}`);
    }
  };

  const startWithdrawalFlow = async (chatId: number, userId: string) => {
    logBot(`startWithdrawalFlow triggered for userId=${userId}, chatId=${chatId}`);
    try {
      // Fetch user's current balance
      const { data: user, error } = await supabase.from('users').select('balance').eq('id', userId).single();
      if (error) {
        logBot(`supabase error fetching balance for userId=${userId}: ${error.message}`);
        if (handleSupabaseError(chatId, error)) {
          return;
        }
      }
      const currentBalance = user ? Number(user.balance) : 0;
      logBot(`userId=${userId} current balance is ${currentBalance}`);

      userStates.set(userId, { step: 'withdraw_amount' });
      bot.sendMessage(chatId, `💰 *ማውጣት የሚፈልጉትን የገንዘብ መጠን ያስገቡ ?*\n\n💳 *የእርስዎ ባላንስ:* \`${currentBalance.toLocaleString()} ETB\`\n\n_(Please type the amount you want to withdraw):_`, { parse_mode: "Markdown" });
      logBot(`startWithdrawalFlow message sent successfully to chatId=${chatId}`);
    } catch (e: any) {
      logBot(`Error in startWithdrawalFlow for userId=${userId}: ${e?.message || e}`);
      bot.sendMessage(chatId, "⚠️ An error occurred preparing your withdrawal. Please try again.");
    }
  };

  const sendSupportCard = (chatId: number) => {
    logBot(`sendSupportCard triggered for chatId=${chatId}`);
    try {
      const supportCard = `📞 *Contact Support*\n\n` +
        `📱 *Phone:* \`+251-931-50-35-59\`\n` +
        `📧 *Email:* \`support@wheelgame.et\`\n` +
        `💬 *Telegram:* @wheelgame_support\n\n` +
        `⏰ *Support Hours:*\n` +
        `Monday - Sunday: 9 AM - 9 PM\n\n` +
        `We're here to help!`;

      bot.sendMessage(chatId, supportCard, { parse_mode: "Markdown" });
      logBot(`sendSupportCard message sent successfully to chatId=${chatId}`);
    } catch (e: any) {
      logBot(`Error in sendSupportCard: ${e?.message || e}`);
    }
  };

  // --- BOT COMMANDS HANDLERS ---
  
  // Start Command
  bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const firstName = msg.from?.first_name || "Player";
    const payload = match ? match[1] : '';

    if (!userId) return;

    if (payload === 'deposit') {
      return startDepositFlow(chatId, userId);
    } else if (payload === 'withdraw') {
      return startWithdrawalFlow(chatId, userId);
    }

    // Default main menu greeting
    let userBalanceStr = "100,000 ETB (Demo)";
    try {
      const { data: user, error } = await supabase.from('users').select('balance').eq('id', userId).single();
      if (error) {
        logBot(`supabase error fetching balance for userId=${userId} on /start: ${error.message}`);
        handleSupabaseError(chatId, error);
      }
      if (user) {
        userBalanceStr = `${Number(user.balance).toLocaleString()} ETB`;
      }
    } catch (e) {
      // Ignored
    }

    const welcomeMsg = `👋 *Welcome to ETB Game Hub, ${firstName}!* 🎮\n\n` +
      `Experience the thrill of real-time multiplayer gaming right here in Telegram!\n\n` +
      `💰 *Your current balance:* \`${userBalanceStr}\`\n\n` +
      `🚀 *Available Games:*\n` +
      `• 🟢 *Even/Odd* - High-octane multipliers and double-ups\n` +
      `• 🏆 *Jackpot Arena* - Secure spots and sweep the pool prize\n` +
      `• 🎡 *Wheel of Chance* - High stakes wheel of fortune\n\n` +
      `👇 Click the button below to launch the Mini App and start playing immediately!`;

    bot.sendMessage(chatId, welcomeMsg, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎮 Play Game Hub 🚀",
              web_app: { url: appUrl }
            }
          ],
          [
            { text: "💸 Deposit / ማስገቢያ", callback_data: "menu_deposit" },
            { text: "🏦 Withdraw / ማውጫ", callback_data: "menu_withdraw" }
          ],
          [
            { text: "📞 Contact Support", callback_data: "menu_support" }
          ]
        ]
      }
    });
  });

  // Play Command
  bot.onText(/\/play/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🎮 *ETB Game Hub is ready!* Press the button below to launch the Mini App:", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 Launch Game",
              web_app: { url: appUrl }
            }
          ]
        ]
      }
    });
  });

  // Support Command
  bot.onText(/\/support/, (msg) => {
    sendSupportCard(msg.chat.id);
  });

  // Quick Command triggers for Deposits and Withdrawals
  bot.onText(/\/deposit/, (msg) => {
    if (msg.from?.id) startDepositFlow(msg.chat.id, msg.from.id.toString());
  });

  bot.onText(/\/withdraw/, (msg) => {
    if (msg.from?.id) startWithdrawalFlow(msg.chat.id, msg.from.id.toString());
  });

  // Set current chat as Admin (Self-registration)
  bot.onText(/\/setadmin/, (msg) => {
    const chatId = msg.chat.id;
    adminChatIds.add(chatId);
    bot.sendMessage(chatId, `👑 *Admin Registered Successfully!*\n\nYou will now receive all Deposit and Withdrawal requests for interactive approval/declination in this chat.`, { parse_mode: "Markdown" });
  });

  // --- MESSAGE STEP-BY-STEP HANDLERS ---
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    if (!userId) return;

    const text = msg.text?.trim() || "";
    if (text.startsWith("/")) return; // Ignore commands

    const state = userStates.get(userId) || { step: 'idle' };

    // 1. DEPOSIT: AMOUNT ENTRY
    if (state.step === 'deposit_amount') {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount < 10) {
        return bot.sendMessage(chatId, "❌ *ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።*\n\n_እባክዎን ከ 10 በላይ ቁጥር ብቻ ያስገቡ:_ ", { parse_mode: "Markdown" });
      }

      userStates.set(userId, {
        step: 'deposit_bank',
        amount
      });

      return bot.sendMessage(chatId, "እባክዎት ማስገባት የሚፈልጉበትን ባንክ ይምረጡ።", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📱 Telebirr", callback_data: `dep_bank_Telebirr` },
              { text: "🏦 CBE (የኢትዮጵያ ንግድ ባንክ)", callback_data: `dep_bank_CBE` }
            ],
            [
              { text: "🏦 Abyssinia Bank", callback_data: `dep_bank_Abyssinia` },
              { text: "🏦 Dashen Bank", callback_data: `dep_bank_Dashen` }
            ]
          ]
        }
      });
    }

    // 2. DEPOSIT: SMS RECEIPT COPY PASTE
    if (state.step === 'deposit_msg') {
      const amount = state.amount || 10;
      const bank = state.bank || "Telebirr";
      const username = msg.from?.username || "no_username";
      const fullName = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "Player";

      // Unique request identifier
      const requestId = "DEP_" + generateRef(8);

      // Register pending request
      pendingRequests.set(requestId, {
        id: requestId,
        type: 'deposit',
        userId,
        username,
        fullName,
        amount,
        bank,
        receiptText: text,
        chatId
      });

      // Send Confirmation to User
      bot.sendMessage(chatId, "✅ *Your deposit Request have been sent to admins please wait 1 min.*", { parse_mode: "Markdown" });

      // Clear state
      userStates.set(userId, { step: 'idle' });

      // Fallback Admin chat configuration (Auto register current user if admin pool is empty to avoid lock-outs)
      if (adminChatIds.size === 0) {
        adminChatIds.add(chatId);
      }

      // Notify Admins
      const adminMsg = `📥 *NEW DEPOSIT REQUEST*\n\n` +
        `👤 *User:* @${username} (${fullName})\n` +
        `🆔 *User ID:* \`${userId}\`\n` +
        `💰 *Amount:* *${amount.toLocaleString()} ETB*\n` +
        `🏦 *Bank:* *${bank}*\n\n` +
        `📝 *Receipt SMS text pasted:*\n` +
        `\`\`\`\n${text}\n\`\`\`\n\n` +
        `*Request ID:* \`${requestId}\``;

      adminChatIds.forEach(adminId => {
        bot.sendMessage(adminId, adminMsg, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Approve ✅", callback_data: `approve_dep_${requestId}` },
                { text: "Decline ❌", callback_data: `decline_dep_${requestId}` }
              ]
            ]
          }
        }).catch(e => console.error(`Failed to notify admin ${adminId} of deposit:`, e));
      });
      return;
    }

    // 3. WITHDRAWAL: AMOUNT ENTRY
    if (state.step === 'withdraw_amount') {
      const amount = parseInt(text, 10);
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "❌ *እባክዎን ትክክለኛ የብር መጠን በቁጥር ብቻ ያስገቡ:*");
      }

      const MIN_WITHDRAW = 50;
      const MAX_WITHDRAW = 50000;

      // Min limit check
      if (amount < MIN_WITHDRAW) {
        return bot.sendMessage(chatId, `ዝቅተኛው ማውጣት የምትችሉት መጠን ${MIN_WITHDRAW} ብር ነው።\n\n*እባክዎን ከ${MIN_WITHDRAW} ብር በላይ ያስገቡ:*`, { parse_mode: "Markdown" });
      }

      // Max limit check
      if (amount > MAX_WITHDRAW) {
        return bot.sendMessage(chatId, `ከፍተኛው ማውጣት የምትችሉት መጠን ${MAX_WITHDRAW.toLocaleString()} ብር ነው።\n\n*እባክዎን ያነሰ መጠን ያስገቡ:*`, { parse_mode: "Markdown" });
      }

      // Balance check
      try {
        const { data: user, error } = await supabase.from('users').select('balance').eq('id', userId).single();
        if (error) {
          if (handleSupabaseError(chatId, error)) {
            return;
          }
          throw error;
        }
        const currentBalance = user ? Number(user.balance) : 0;

        if (amount > currentBalance) {
          return bot.sendMessage(chatId, `❌ *በቂ ባላንስ የለዎትም!*\n\n💳 *የእርስዎ ባላንስ:* ${currentBalance.toLocaleString()} ብር\n💰 *የጠየቁት መጠን:* ${amount.toLocaleString()} ብር\n\n_እባክዎን ያነሰ መጠን ያስገቡ:_`, { parse_mode: "Markdown" });
        }

        userStates.set(userId, {
          step: 'withdraw_bank',
          amount
        });

        // Prompt bank selection
        return bot.sendMessage(chatId, "እባክዎን የሚያወጡበትን ባንክ ይምረጡ።", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📱 Telebirr", callback_data: `wd_bank_Telebirr` },
                { text: "🏦 CBE (የኢትዮጵያ ንግድ ባንክ)", callback_data: `wd_bank_CBE` }
              ],
              [
                { text: "🏦 Abyssinia Bank", callback_data: `wd_bank_Abyssinia` },
                { text: "🏦 Dashen Bank", callback_data: `wd_bank_Dashen` }
              ]
            ]
          }
        });

      } catch (err) {
        console.error("Balance lookup failed:", err);
        return bot.sendMessage(chatId, "An error occurred lookup your balance. Try again.");
      }
    }

    // 4. WITHDRAWAL: ACCOUNT / PHONE ENTRY
    if (state.step === 'withdraw_account') {
      const amount = state.amount || 50;
      const bank = state.bank || "Telebirr";
      const username = msg.from?.username || "no_username";
      const fullName = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "Player";

      try {
        // Prevent double spending by deducting balance IMMEDIATELY upon request
        const { data: user, error } = await supabase.from('users').select('balance').eq('id', userId).single();
        if (error) {
          if (handleSupabaseError(chatId, error)) {
            return;
          }
          throw error;
        }
        const currentBalance = user ? Number(user.balance) : 0;

        if (currentBalance < amount) {
          userStates.set(userId, { step: 'idle' });
          return bot.sendMessage(chatId, "❌ *በቂ ባላንስ የለዎትም!* Withdrawal request cancelled.", { parse_mode: "Markdown" });
        }

        const newBalance = currentBalance - amount;
        await supabase.from('users').update({ balance: newBalance }).eq('id', userId);

        // Generate unique request code
        const requestId = "WD_" + generateRef(8);

        pendingRequests.set(requestId, {
          id: requestId,
          type: 'withdraw',
          userId,
          username,
          fullName,
          amount,
          bank,
          account: text,
          chatId
        });

        // Notify User
        bot.sendMessage(chatId, "✅ *Your withdrawal Request have been sent to admins please wait 1 min.*", { parse_mode: "Markdown" });

        // Push real-time balance update to socket clients instantly
        io.emit('balanceUpdated', { userId, balance: newBalance });

        // Clear user active state
        userStates.set(userId, { step: 'idle' });

        // Auto Admin fallback
        if (adminChatIds.size === 0) {
          adminChatIds.add(chatId);
        }

        // Notify Admins
        const adminMsg = `📤 *NEW WITHDRAWAL REQUEST*\n\n` +
          `👤 *User:* @${username} (${fullName})\n` +
          `🆔 *User ID:* \`${userId}\`\n` +
          `💰 *Amount:* *${amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${bank}*\n` +
          `💳 *Account/Phone:* \`${text}\`\n\n` +
          `*Request ID:* \`${requestId}\``;

        adminChatIds.forEach(adminId => {
          bot.sendMessage(adminId, adminMsg, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Approve ✅", callback_data: `approve_wd_${requestId}` },
                  { text: "Decline ❌", callback_data: `decline_wd_${requestId}` }
                ]
              ]
            }
          }).catch(e => console.error(`Failed to notify admin ${adminId} of withdrawal:`, e));
        });

      } catch (err) {
        console.error("Deducting balance for withdrawal request failed:", err);
        bot.sendMessage(chatId, "⚠️ Failed to submit withdrawal request. Please retry.");
      }
    }
  });

  // --- CALLBACK QUERY DISPATCHER ---
  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id || query.from.id;
    const messageId = query.message?.message_id;
    const userId = query.from.id.toString();
    const data = query.data;

    logBot(`callback_query received: userId=${userId}, chatId=${chatId}, data=${data}`);

    if (!chatId || !data) {
      logBot(`callback_query rejected: chatId=${chatId}, data=${data}`);
      return;
    }

    // --- MAIN BOT MENUS (SUPPORTING BOTH NEW AND OLD BUTTON PAYLOADS) ---
    if (data === "menu_deposit" || data === "deposit_info") {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (e) {
        logBot(`Failed to answer callback query: ${e}`);
      }
      return startDepositFlow(chatId, userId);
    }

    if (data === "menu_withdraw" || data === "withdraw_info") {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (e) {
        logBot(`Failed to answer callback query: ${e}`);
      }
      return startWithdrawalFlow(chatId, userId);
    }

    if (data === "menu_support") {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (e) {
        logBot(`Failed to answer callback query: ${e}`);
      }
      return sendSupportCard(chatId);
    }

    // --- DEPOSIT: BANK SELECTED ---
    if (data.startsWith("dep_bank_")) {
      const bank = data.replace("dep_bank_", "");
      const state = userStates.get(userId);

      if (!state || state.step !== 'deposit_bank') {
        bot.answerCallbackQuery(query.id, { text: "❌ Session expired. Please restart deposit." });
        return;
      }

      userStates.set(userId, {
        ...state,
        step: 'deposit_msg',
        bank
      });

      const amount = state.amount || 10;
      const paymentInstructions = `ሚያጋጥማቹ የክፍያ ችግር:\n` +
        `@wheelgamessupport\n` +
        `@wheelgamesupport1 ላይ ፃፉልን።\n\n` +
        `1. ከታች ባለው የ*${bank}* አካውንት *${amount.toLocaleString()} ብር* ያስገቡ\n` +
        `    *Phone:* \`0931503559\`\n` +
        `    *Name:* \`Tadese\`\n\n` +
        `2. የከፈሉበትን አጭር የጹሁፍ መልዕክት(message) copy በማድረግ እዚ ላይ Past አድረገው ያስገቡና ይላኩት👇👇👇\n\n` +
        `_(Please copy and paste the SMS transaction receipt text as response)_`;

      bot.answerCallbackQuery(query.id);
      return bot.sendMessage(chatId, paymentInstructions, { parse_mode: "Markdown" });
    }

    // --- WITHDRAW: BANK SELECTED ---
    if (data.startsWith("wd_bank_")) {
      const bank = data.replace("wd_bank_", "");
      const state = userStates.get(userId);

      if (!state || state.step !== 'withdraw_bank') {
        bot.answerCallbackQuery(query.id, { text: "❌ Session expired. Please restart withdrawal." });
        return;
      }

      userStates.set(userId, {
        ...state,
        step: 'withdraw_account',
        bank
      });

      bot.answerCallbackQuery(query.id);

      if (bank === "Telebirr") {
        return bot.sendMessage(chatId, "📱 *እባክዎን ስልክ ቁጥርን ያስገቡ:*", { parse_mode: "Markdown" });
      } else {
        return bot.sendMessage(chatId, "🏦 *እባክዎን አካውንት ቁጥርን ያስገቡ:*", { parse_mode: "Markdown" });
      }
    }

    // --- ADMIN ACTION: APPROVE DEPOSIT ---
    if (data.startsWith("approve_dep_")) {
      const requestId = data.replace("approve_dep_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." });
        return;
      }

      try {
        // Fetch current user balance
        const { data: user } = await supabase.from('users').select('balance').eq('id', request.userId).single();
        const currentBalance = user ? Number(user.balance) : 0;
        const newBalance = currentBalance + request.amount;

        // Update balance
        await supabase.from('users').update({ balance: newBalance }).eq('id', request.userId);

        // Add transaction ledger entry
        await supabase.from('transactions').insert({
          user_id: request.userId,
          amount: request.amount,
          type: 'reward',
          description: `Deposit Approved (Ref: ${requestId})`
        });

        // Unique verification Ref
        const refCode = "DEP_" + generateRef(10);

        // Send confirmation to User
        const successMsg = `✅ *Your deposit of ${request.amount.toLocaleString()} ETB is confirmed.*\n🧾 *Ref:* \`${refCode}\``;
        await bot.sendMessage(request.chatId, successMsg, { parse_mode: "Markdown" });

        // Update Client App UI Instantly via socket
        io.emit('balanceUpdated', { userId: request.userId, balance: newBalance });

        // Delete from pending store
        pendingRequests.delete(requestId);

        // Acknowledge Admin click
        bot.answerCallbackQuery(query.id, { text: "✅ Deposit approved!" });

        // Update Admin inline message
        const adminUsername = query.from.username || query.from.first_name || "Admin";
        const updatedAdminMsg = `📥 *DEPOSIT APPROVED (Ref: ${refCode})*\n\n` +
          `👤 *User:* @${request.username} (${request.fullName})\n` +
          `🆔 *User ID:* \`${request.userId}\`\n` +
          `💰 *Amount:* *${request.amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${request.bank}*\n` +
          `📝 *Pasted Receipt SMS:*\n\`\`\`\n${request.receiptText}\n\`\`\`\n\n` +
          `✅ *Approved by admin:* @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to approve deposit:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing deposit." });
      }
      return;
    }

    // --- ADMIN ACTION: DECLINE DEPOSIT ---
    if (data.startsWith("decline_dep_")) {
      const requestId = data.replace("decline_dep_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." });
        return;
      }

      try {
        // Send decline notification to User
        const declineMsg = `❌ *Your deposit of ${request.amount.toLocaleString()} ETB is Declined.*`;
        await bot.sendMessage(request.chatId, declineMsg, { parse_mode: "Markdown" });

        // Delete from pending store
        pendingRequests.delete(requestId);

        // Acknowledge Admin click
        bot.answerCallbackQuery(query.id, { text: "❌ Deposit Declined" });

        // Update Admin inline message
        const adminUsername = query.from.username || query.from.first_name || "Admin";
        const updatedAdminMsg = `📥 *DEPOSIT DECLINED*\n\n` +
          `👤 *User:* @${request.username} (${request.fullName})\n` +
          `🆔 *User ID:* \`${request.userId}\`\n` +
          `💰 *Amount:* *${request.amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${request.bank}*\n` +
          `📝 *Pasted Receipt SMS:*\n\`\`\`\n${request.receiptText}\n\`\`\`\n\n` +
          `❌ *Declined by admin:* @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to decline deposit:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing decline." });
      }
      return;
    }

    // --- ADMIN ACTION: APPROVE WITHDRAWAL ---
    if (data.startsWith("approve_wd_")) {
      const requestId = data.replace("approve_wd_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." });
        return;
      }

      try {
        // Funds were already deducted when they submitted. We finalize the withdrawal.
        await supabase.from('transactions').insert({
          user_id: request.userId,
          amount: -request.amount,
          type: 'bet', // Record as debit transaction
          description: `Withdrawal Approved (Ref: ${requestId})`
        });

        // Unique Verification Ref
        const refCode = "WD_" + generateRef(10);

        // Send confirmation to User
        const successMsg = `✅ *Your withdrawal of ${request.amount.toLocaleString()} ETB is confirmed.*\n🧾 *Ref:* \`${refCode}\``;
        await bot.sendMessage(request.chatId, successMsg, { parse_mode: "Markdown" });

        // Delete from pending store
        pendingRequests.delete(requestId);

        bot.answerCallbackQuery(query.id, { text: "✅ Withdrawal Approved!" });

        // Update Admin inline message
        const adminUsername = query.from.username || query.from.first_name || "Admin";
        const updatedAdminMsg = `📤 *WITHDRAWAL APPROVED (Ref: ${refCode})*\n\n` +
          `👤 *User:* @${request.username} (${request.fullName})\n` +
          `🆔 *User ID:* \`${request.userId}\`\n` +
          `💰 *Amount:* *${request.amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${request.bank}*\n` +
          `💳 *Account/Phone:* \`${request.account}\`\n\n` +
          `✅ *Approved by admin:* @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to approve withdrawal:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing approval." });
      }
      return;
    }

    // --- ADMIN ACTION: DECLINE WITHDRAWAL ---
    if (data.startsWith("decline_wd_")) {
      const requestId = data.replace("decline_wd_", "");
      const request = pendingRequests.get(requestId);

      if (!request) {
        bot.answerCallbackQuery(query.id, { text: "❌ Request not found or already processed." });
        return;
      }

      try {
        // Refund back to user's balance because it was deducted upon request
        const { data: user } = await supabase.from('users').select('balance').eq('id', request.userId).single();
        const currentBalance = user ? Number(user.balance) : 0;
        const refundedBalance = currentBalance + request.amount;

        await supabase.from('users').update({ balance: refundedBalance }).eq('id', request.userId);

        // Record a Refund ledger entry
        await supabase.from('transactions').insert({
          user_id: request.userId,
          amount: request.amount,
          type: 'reward',
          description: `Withdrawal Declined & Refunded (Ref: ${requestId})`
        });

        // Send detailed Decline & Refund message to user
        const declineMsg = `❌ *Withdrawal Declined*\n\n` +
          `Your withdrawal of *${request.amount.toLocaleString()} Birr* was declined and refunded.\n\n` +
          `💳 *Current Balance:* *${refundedBalance.toLocaleString()} Birr*\n\n` +
          `Please contact support if you believe this was an error.`;

        await bot.sendMessage(request.chatId, declineMsg, { parse_mode: "Markdown" });

        // Update Client App UI instantly via socket
        io.emit('balanceUpdated', { userId: request.userId, balance: refundedBalance });

        // Delete from pending store
        pendingRequests.delete(requestId);

        bot.answerCallbackQuery(query.id, { text: "❌ Withdrawal Declined" });

        // Update Admin inline message
        const adminUsername = query.from.username || query.from.first_name || "Admin";
        const updatedAdminMsg = `📤 *WITHDRAWAL DECLINED & REFUNDED*\n\n` +
          `👤 *User:* @${request.username} (${request.fullName})\n` +
          `🆔 *User ID:* \`${request.userId}\`\n` +
          `💰 *Amount:* *${request.amount.toLocaleString()} ETB*\n` +
          `🏦 *Bank:* *${request.bank}*\n` +
          `💳 *Account/Phone:* \`${request.account}\`\n\n` +
          `❌ *Declined by admin:* @${adminUsername}`;

        if (messageId) {
          bot.editMessageText(updatedAdminMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown"
          }).catch(e => console.error("Admin msg update failed:", e));
        }

      } catch (err) {
        console.error("Failed to decline and refund withdrawal:", err);
        bot.answerCallbackQuery(query.id, { text: "⚠️ Error processing withdrawal refund." });
      }
      return;
    }
  });

  return botInfo?.username || null;
}

export function getBotUsername() {
  return botInfo?.username || null;
}
