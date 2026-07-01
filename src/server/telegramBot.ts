import * as TelegramBot from "node-telegram-bot-api";
import { supabase } from "./supabase.js";
import { Server } from "socket.io";
import * as fs from "fs";
import * as path from "path";
import nodemailer from "nodemailer";

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

interface SetAdminState {
  action: 'idle' | 'awaiting_add_userid' | 'awaiting_add_password' | 'awaiting_del_password' | 'change_pw_old_auth' | 'change_pw_new_input' | 'change_pw_confirm';
  targetUserId?: number;
  deleteTargetId?: number;
  proposedNewPassword?: string;
}
const setAdminStates = new Map<number, SetAdminState>();

const PASSWORD_FILE_PATH = path.join(process.cwd(), "admin_password.json");

function getStoredPassword(): string {
  try {
    if (fs.existsSync(PASSWORD_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(PASSWORD_FILE_PATH, "utf8"));
      if (data && typeof data.password === "string" && data.password.trim() !== "") {
        return data.password;
      }
    }
  } catch (err: any) {
    logBot(`Error reading password file: ${err.message}`);
  }
  // Default fallback
  return process.env.ADMIN_PASSWORD || "AdminSecurePass777";
}

function setStoredPassword(newPassword: string) {
  try {
    fs.writeFileSync(PASSWORD_FILE_PATH, JSON.stringify({ password: newPassword }, null, 2), "utf8");
    logBot("Owner password updated in JSON storage.");
  } catch (err: any) {
    logBot(`Error writing password file: ${err.message}`);
  }
}

async function sendPasswordEmail(password: string): Promise<boolean> {
  try {
    const host = process.env.SMTP_HOST || "smtp.gmail.com";
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      logBot(`SMTP credentials missing (SMTP_USER/SMTP_PASS). Cannot send real email to tamirud8@gmail.com. Password is: ${password}`);
      return false;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    await transporter.sendMail({
      from: `"Telegram Bot Admin" <${user}>`,
      to: "tamirud8@gmail.com",
      subject: "Telegram Bot Admin Password Recovery",
      text: `Hello,\n\nYour Telegram Bot Owner Admin Password is: ${password}\n\nSecurity notice: If you did not request this, please change your password immediately.`,
      html: `<p>Hello,</p><p>Your Telegram Bot Owner Admin Password is: <strong>${password}</strong></p><p><em>Security notice: If you did not request this, please change your password immediately.</em></p>`,
    });

    logBot(`Admin password sent successfully to tamirud8@gmail.com via SMTP.`);
    return true;
  } catch (error: any) {
    logBot(`Error sending password email to tamirud8@gmail.com: ${error.message}`);
    return false;
  }
}

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

// Dynamic Owner configurations to prevent Access Denied for testers
const OWNER_IDS = new Set<number>([336997351, 5115194570]);
const envOwnerId = process.env.TELEGRAM_OWNER_ID;
if (envOwnerId) {
  const parsed = parseInt(envOwnerId, 10);
  if (!isNaN(parsed)) {
    OWNER_IDS.add(parsed);
  }
}

function isOwner(userId: number | undefined): boolean {
  if (!userId) return false;
  return OWNER_IDS.has(userId);
}

function getPrimaryOwnerId(): number {
  if (envOwnerId) {
    const parsed = parseInt(envOwnerId, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 5115194570; // Fallback to current tester/owner ID
}

// Admin Chat IDs (Initialized with all owners/starting admins)
const adminChatIds = new Set<number>(OWNER_IDS);

// Initialize Admin IDs from environment variables if present
const adminEnv = process.env.TELEGRAM_ADMIN_IDS;
if (adminEnv) {
  adminEnv.split(',').forEach(id => {
    const trimmed = id.trim();
    if (trimmed) {
      const parsed = parseInt(trimmed, 10);
      if (!isNaN(parsed) && parsed > 0) {
        adminChatIds.add(parsed);
      }
    }
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
  const TelegramBotClass = typeof TelegramBot === "function"
    ? TelegramBot
    : ((TelegramBot as any).default || TelegramBot);
  const bot = new TelegramBotClass(token, { polling: true });

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
      { command: "setadmin", description: "Manage administrator privileges (Owner Only)" },
      { command: "cancel", description: "Cancel current operation or active flows" }
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

  const getOrCreateUser = async (userId: string, username: string, firstName?: string, lastName?: string): Promise<{ balance: number } | null> => {
    try {
      const { data, error } = await supabase.from('users').select('balance').eq('id', userId);
      if (error) {
        logBot(`supabase error fetching user ID=${userId}: ${error.message}`);
        return null;
      }
      if (data && data.length > 0) {
        return { balance: Number(data[0].balance) };
      }

      logBot(`User ID=${userId} not found. Creating user in database...`);
      const { data: insertedData, error: insertError } = await supabase
        .from('users')
        .insert({
          id: userId,
          username: username || null,
          first_name: firstName || null,
          last_name: lastName || null,
          balance: 100000
        })
        .select('balance')
        .single();

      if (insertError) {
        logBot(`Error inserting user ID=${userId}: ${insertError.message}`);
        return { balance: 100000 };
      }
      return { balance: insertedData ? Number(insertedData.balance) : 100000 };
    } catch (e: any) {
      logBot(`Unexpected error in getOrCreateUser for ID=${userId}: ${e?.message || e}`);
      return { balance: 100000 };
    }
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
      // Fetch user's current balance safely using getOrCreateUser helper
      const user = await getOrCreateUser(userId, "");
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
      const user = await getOrCreateUser(userId, msg.from?.username || "", msg.from?.first_name, msg.from?.last_name);
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

  // Cancel flow command
  bot.onText(/\/cancel/, (msg) => {
    const userId = msg.from?.id;
    if (userId) {
      if (isOwner(userId)) {
        setAdminStates.delete(userId);
      }
      userStates.set(userId.toString(), { step: 'idle' });
      bot.sendMessage(msg.chat.id, "✅ <b>All active flows and setups have been canceled.</b>", { parse_mode: "HTML" });
    }
  });

  // Owner Admin Management control panel
  bot.onText(/\/setadmin/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!isOwner(userId)) {
      bot.sendMessage(chatId, `❌ <b>Access Denied.</b>\n\nThis command is restricted to the Starting Admin/Owner of this bot.`, { parse_mode: "HTML" });
      logBot(`Failed admin control panel access attempt by userId=${userId}`);
      return;
    }

    // Show interactive admin panel
    bot.sendMessage(chatId, `👑 <b>Admin Control Panel</b>\n\nSelect an operation to manage administrator privileges:`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "➕ Add Admin", callback_data: "setadmin_add_start" },
            { text: "➖ Delete Admin", callback_data: "setadmin_del_start" }
          ],
          [
            { text: "🔒 Change Password", callback_data: "setadmin_change_pw_start" },
            { text: "❌ Cancel", callback_data: "setadmin_cancel" }
          ]
        ]
      }
    });
  });

  // --- MESSAGE STEP-BY-STEP HANDLERS ---
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    if (!userId) return;

    const text = msg.text?.trim() || "";
    if (text.startsWith("/")) return; // Ignore commands

    // Process setadmin interactive states for the Owner
    const numUserId = msg.from?.id;
    if (isOwner(numUserId)) {
      const adminState = setAdminStates.get(numUserId);
      if (adminState && adminState.action !== 'idle') {
        // 1. Awaiting User ID to add
        if (adminState.action === 'awaiting_add_userid') {
          const parsedId = parseInt(text, 10);
          if (isNaN(parsedId) || parsedId <= 0) {
            return bot.sendMessage(chatId, "❌ <b>Invalid User ID.</b>\n\nPlease send a valid numeric Telegram User ID directly, or type <code>/cancel</code> to abort.", { parse_mode: "HTML" });
          }

          setAdminStates.set(numUserId, {
            action: 'awaiting_add_password',
            targetUserId: parsedId
          });

          return bot.sendMessage(chatId, `🔑 <b>User ID ${parsedId} entered.</b>\n\nPlease enter your Owner Password to authorize adding this user as an Admin:`, { parse_mode: "HTML" });
        }

        // 2. Awaiting Owner Password for adding admin
        if (adminState.action === 'awaiting_add_password') {
          const ownerPassword = getStoredPassword();
          if (text === ownerPassword) {
            const targetId = adminState.targetUserId;
            if (targetId) {
              adminChatIds.add(targetId);
              bot.sendMessage(chatId, `👑 <b>Success!</b>\n\nUser ID <code>${targetId}</code> has been successfully added to the Admin list.`, { parse_mode: "HTML" });

              // Notify target user
              bot.sendMessage(targetId, `👑 <b>You have been registered as an Admin by the Owner!</b>\n\nYou will now receive all transaction requests for approval/declination in this private chat room.`, { parse_mode: "HTML" })
                .catch(() => logBot(`Could not send welcome message to new admin ${targetId} (must start bot in private first).`));
            } else {
              bot.sendMessage(chatId, `❌ Something went wrong: target ID not found.`);
            }
          } else {
            bot.sendMessage(chatId, `❌ <b>Incorrect password.</b> Admin registration aborted.`, { parse_mode: "HTML" });
          }
          setAdminStates.delete(numUserId);
          return;
        }

        // 3. Awaiting Owner Password for deleting admin
        if (adminState.action === 'awaiting_del_password') {
          const ownerPassword = getStoredPassword();
          if (text === ownerPassword) {
            const deleteTargetId = adminState.deleteTargetId;
            if (deleteTargetId) {
              adminChatIds.delete(deleteTargetId);
              bot.sendMessage(chatId, `❌ <b>Success!</b>\n\nAdmin ID <code>${deleteTargetId}</code> has been successfully removed from the Admin list.`, { parse_mode: "HTML" });

              // Notify the deleted admin
              bot.sendMessage(deleteTargetId, `⚠️ <b>Your Admin privileges have been revoked by the Owner.</b>`, { parse_mode: "HTML" })
                .catch(() => {});
            } else {
              bot.sendMessage(chatId, `❌ Something went wrong: delete target ID not found.`);
            }
          } else {
            bot.sendMessage(chatId, `❌ <b>Incorrect password.</b> Admin deletion aborted.`, { parse_mode: "HTML" });
          }
          setAdminStates.delete(numUserId);
          return;
        }

        // 4. Awaiting current/old password to authorize password change
        if (adminState.action === 'change_pw_old_auth') {
          const currentPassword = getStoredPassword();
          if (text === currentPassword) {
            setAdminStates.set(numUserId, {
              action: 'change_pw_new_input'
            });
            return bot.sendMessage(chatId, `✅ <b>Old password verified.</b>\n\n🔒 Please enter your <b>new password</b>:`, { parse_mode: "HTML" });
          } else {
            bot.sendMessage(chatId, `❌ <b>Incorrect password.</b> Password change aborted.`, { parse_mode: "HTML" });
            setAdminStates.delete(numUserId);
            return;
          }
        }

        // 5. Awaiting new password input
        if (adminState.action === 'change_pw_new_input') {
          const newPw = text;
          if (newPw.length < 4) {
            return bot.sendMessage(chatId, `⚠️ <b>Password is too short.</b> Please enter a new password that is at least 4 characters long:`, { parse_mode: "HTML" });
          }

          setAdminStates.set(numUserId, {
            action: 'change_pw_confirm',
            proposedNewPassword: newPw
          });

          return bot.sendMessage(chatId, `🔒 <b>New password received.</b>\n\nPlease write your <b>new password again</b> to confirm:`, { parse_mode: "HTML" });
        }

        // 6. Awaiting confirmed password input
        if (adminState.action === 'change_pw_confirm') {
          const proposed = adminState.proposedNewPassword;
          if (text === proposed) {
            setStoredPassword(text);
            bot.sendMessage(chatId, `🎉 <b>Congratulations! Your password has been successfully changed.</b>`, { parse_mode: "HTML" });

            // Send security alert notification strictly to @scofiled1 on Telegram
            try {
              supabase
                .from('users')
                .select('id, username')
                .ilike('username', 'scofiled1')
                .then(({ data: dbUsers }) => {
                  if (dbUsers && dbUsers.length > 0) {
                    for (const u of dbUsers) {
                      if (u.id) {
                        bot.sendMessage(u.id, `🔒 <b>Security Alert:</b>\n\nThe Admin control panel password has been successfully changed.`, { parse_mode: "HTML" })
                          .catch(() => {});
                      }
                    }
                  }
                });
            } catch (err: any) {
              logBot(`Error notifying scofiled1 on password change: ${err.message}`);
            }

            logBot(`Owner changed password successfully.`);
          } else {
            bot.sendMessage(chatId, `❌ <b>Passwords do not match.</b> Password change aborted.`, { parse_mode: "HTML" });
          }
          setAdminStates.delete(numUserId);
          return;
        }
      }
    }

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

      // Notify starting admin if admin list is empty (failsafe)
      if (adminChatIds.size === 0) {
        adminChatIds.add(getPrimaryOwnerId());
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
        const user = await getOrCreateUser(userId, msg.from?.username || "", msg.from?.first_name, msg.from?.last_name);
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
        const user = await getOrCreateUser(userId, msg.from?.username || "", msg.from?.first_name, msg.from?.last_name);
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

        // Notify starting admin if admin list is empty (failsafe)
        if (adminChatIds.size === 0) {
          adminChatIds.add(getPrimaryOwnerId());
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

    // Secure administrative callback actions against unauthorized users
    const isAdminAction = data.startsWith("approve_dep_") || 
                          data.startsWith("decline_dep_") || 
                          data.startsWith("approve_wd_") || 
                          data.startsWith("decline_wd_");

    if (isAdminAction) {
      const clickerId = query.from.id;
      if (!adminChatIds.has(clickerId)) {
        logBot(`Unauthorized transaction action attempt by clickerId=${clickerId} on ${data}`);
        try {
          await bot.answerCallbackQuery(query.id, { 
            text: "❌ Access Denied: You are not a registered Admin.",
            show_alert: true 
          });
        } catch (e) {
          // ignore
        }
        return;
      }
    }

    // --- SETADMIN CONTROL PANEL CALLBACKS ---
    if (data === "setadmin_cancel") {
      const clickerId = query.from.id;
      if (isOwner(clickerId)) {
        setAdminStates.delete(clickerId);
        try {
          await bot.answerCallbackQuery(query.id, { text: "Operation Canceled" });
          if (messageId) {
            await bot.editMessageText(`❌ <b>Operation canceled.</b>`, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML"
            });
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_add_start") {
      const clickerId = query.from.id;
      if (isOwner(clickerId)) {
        setAdminStates.set(clickerId, { action: 'awaiting_add_userid' });
        try {
          await bot.answerCallbackQuery(query.id);
          if (messageId) {
            await bot.editMessageText(
              `🆔 <b>Please provide the Telegram User ID of the new admin:</b>\n\n` +
              `<i>Send the numeric User ID directly as a message (e.g., <code>5115194570</code>).</i>\n\n` +
              `You can find a user's ID using bot tools or via their profile info.`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML"
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_del_start") {
      const clickerId = query.from.id;
      if (isOwner(clickerId)) {
        try {
          await bot.answerCallbackQuery(query.id);

          // Get all other registered admins
          const otherAdmins = Array.from(adminChatIds).filter(id => !isOwner(id));

          if (otherAdmins.length === 0) {
            if (messageId) {
              await bot.editMessageText(
                `⚠️ <b>There are no other registered admins in the system.</b>`,
                {
                  chat_id: chatId,
                  message_id: messageId,
                  parse_mode: "HTML",
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "🔙 Back", callback_data: "setadmin_back" }]
                    ]
                  }
                }
              );
            }
            return;
          }

          // Build inline buttons for each admin
          const keyboard = otherAdmins.map(id => [
            { text: `👤 Admin ID: ${id} ❌`, callback_data: `setadmin_del_confirm_${id}` }
          ]);
          keyboard.push([{ text: "🔙 Cancel", callback_data: "setadmin_cancel" }]);

          if (messageId) {
            await bot.editMessageText(
              `➖ <b>Select the Admin you want to delete:</b>`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: keyboard
                }
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_back") {
      const clickerId = query.from.id;
      if (isOwner(clickerId)) {
        setAdminStates.delete(clickerId);
        try {
          await bot.answerCallbackQuery(query.id);
          if (messageId) {
            await bot.editMessageText(
              `👑 <b>Admin Control Panel</b>\n\nSelect an operation to manage administrator privileges:`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "➕ Add Admin", callback_data: "setadmin_add_start" },
                      { text: "➖ Delete Admin", callback_data: "setadmin_del_start" }
                    ],
                    [
                      { text: "🔒 Change Password", callback_data: "setadmin_change_pw_start" },
                      { text: "❌ Cancel", callback_data: "setadmin_cancel" }
                    ]
                  ]
                }
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_change_pw_start") {
      const clickerId = query.from.id;
      if (isOwner(clickerId)) {
        setAdminStates.set(clickerId, { action: 'change_pw_old_auth' });
        try {
          await bot.answerCallbackQuery(query.id);
          if (messageId) {
            await bot.editMessageText(
              `🔒 <b>Change Password</b>\n\n` +
              `🔑 Please enter your <b>old/current password</b> as a message:\n\n` +
              `<i>If you have forgotten your password, click the "Forget Password" button below to receive it on Telegram (via @Scofield1621).</i>`,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "📨 Forget Password ❓", callback_data: "setadmin_forget_pw" }],
                    [{ text: "🔙 Cancel", callback_data: "setadmin_cancel" }]
                  ]
                }
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data === "setadmin_forget_pw") {
      const clickerId = query.from.id;
      if (isOwner(clickerId)) {
        try {
          await bot.answerCallbackQuery(query.id, { text: "Retrieving and sending password to @Scofield1621..." });
          const password = getStoredPassword();

          // Locate the ID of Scofield1621 strictly and send to them
          let telegramSent = false;
          try {
            const { data: dbUsers } = await supabase
              .from('users')
              .select('id, username')
              .ilike('username', 'Scofield1621');

            if (dbUsers && dbUsers.length > 0) {
              for (const u of dbUsers) {
                if (u.id) {
                  await bot.sendMessage(u.id, `🔑 <b>Admin Password Recovery:</b>\n\nYour current admin password is: <code>${password}</code>`, { parse_mode: "HTML" });
                  telegramSent = true;
                }
              }
            } else if (query.from.username && query.from.username.toLowerCase() === 'scofield1621') {
              // Fallback to clicker if clicker is Scofield1621
              await bot.sendMessage(clickerId, `🔑 <b>Admin Password Recovery:</b>\n\nYour current admin password is: <code>${password}</code>`, { parse_mode: "HTML" });
              telegramSent = true;
            }
          } catch (dbErr: any) {
            logBot(`Error searching database for Scofield1621: ${dbErr.message}`);
          }

          if (messageId) {
            let statusText = `📨 <b>Success!</b>\n\n`;
            if (telegramSent) {
              statusText += `✅ Your current password has been sent directly to your Telegram chat (<b>@Scofield1621</b>).\n\n`;
            } else {
              statusText += `⚠️ Could not locate an active Telegram chat session for @Scofield1621. Make sure @Scofield1621 has started/messaged the bot first.\n\n` +
                `<i>For testing fallback: your current password is <code>${password}</code></i>\n\n`;
            }

            statusText += `<i>Please check your messages and enter the current password here to continue:</i>`;

            await bot.editMessageText(
              statusText,
              {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔙 Cancel", callback_data: "setadmin_cancel" }]
                  ]
                }
              }
            );
          }
        } catch (e) {
          // ignore
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
      return;
    }

    if (data.startsWith("setadmin_del_confirm_")) {
      const clickerId = query.from.id;
      if (isOwner(clickerId)) {
        const targetIdStr = data.replace("setadmin_del_confirm_", "");
        const targetId = parseInt(targetIdStr, 10);

        if (!isNaN(targetId)) {
          setAdminStates.set(clickerId, {
            action: 'awaiting_del_password',
            deleteTargetId: targetId
          });

          try {
            await bot.answerCallbackQuery(query.id);
            if (messageId) {
              await bot.editMessageText(
                `⚠️ <b>Security Confirmation</b>\n\nYou are about to remove Admin ID <code>${targetId}</code>.\n\n` +
                `🔑 <b>Please enter your Owner Password as a message to confirm deletion:</b>`,
                {
                  chat_id: chatId,
                  message_id: messageId,
                  parse_mode: "HTML"
                }
              );
            }
          } catch (e) {
            // ignore
          }
        }
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Owner only", show_alert: true });
      }
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
