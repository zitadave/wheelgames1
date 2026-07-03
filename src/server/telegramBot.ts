import { registerCommandHandlers } from "./bot/commands.js";
import TelegramBot from "node-telegram-bot-api";
import { supabase } from "./supabase.js";
import { getAnalysisSummary } from "./analysis.js";
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
  step: string;
  amount?: number;
  bank?: string;
  editingKey?: string;
  row?: number;
  col?: number;
  new_label?: string;
  cmd_name?: string;
  cmd_desc?: string;
  field?: string;
}

const userStates = new Map<string, UserState>();
const userLanguages = new Map<number, string>();

let startDepositFlowRef: ((chatId: number, userId: string) => void) | null = null;
let startWithdrawalFlowRef: ((chatId: number, userId: string) => Promise<void>) | null = null;

function t(key: string, lang: string = 'en', params?: Record<string, string>): string {
  const translations: Record<string, Record<string, string>> = {
    'welcome_desc': {
      'en': `🎮 <b>Welcome to ETB Game Hub!</b> 🚀\n\nExperience the ultimate Telegram gaming destination! Test your prediction skills with 🟢 <b>Even/Odd</b>, enter the 🏆 <b>Jackpot Arena</b>, or spin the 🎡 <b>Wheel of Chance</b> to win incredible rewards.\n\n💎 <i>Play instantly, win with real-time multipliers, and withdraw directly to your favorite wallet!</i>`,
      'am': `🎮 <b>እንኳን ወደ ETB ጌም ሃብ በደህና መጡ!</b> 🚀\n\nበቴሌግራም ላይ ምርጥ የሆነውን የጌም ማዕከል ይለማመዱ! በ🟢 <b>Even/Odd</b> ችሎታዎን ይሞክሩ፣ ወደ 🏆 <b>Jackpot Arena</b> ይግቡ፣ ወይም 🎡 <b>Wheel of Chance</b> በማሽከርከር ትልቅ ሽልማት ያሸንፉ።\n\n💎 <i>አሁኑኑ ይጫወቱ፣ ያሸንፉ እና በቀጥታ ወደ አካውንትዎ ያውጡ!</i>`
    },
    'btn_start_play': {
      'en': "🎮 Start Play 🚀",
      'am': "🎮 ለመጫወት ጀምር 🚀"
    }
  };
  
  let text = translations[key]?.[lang] || translations[key]?.['en'] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

interface SetAdminState {
  action: 'idle' | 'awaiting_add_userid' | 'awaiting_add_password' | 'awaiting_del_password' | 'change_pw_old_auth' | 'change_pw_new_input' | 'change_pw_confirm';
  targetUserId?: number;
  deleteTargetId?: number;
  proposedNewPassword?: string;
}
const setAdminStates = new Map<number, SetAdminState>();

interface BroadcastComposer {
  step: 'choose_target' | 'choose_template' | 'choose_type' | 'awaiting_text' | 'awaiting_photo' | 'awaiting_caption' | 'review' | 'awaiting_custom_header' | 'awaiting_custom_footer' | 'awaiting_btn_text' | 'awaiting_btn_url';
  type?: 'text' | 'photo' | 'photo_button' | 'webapp';
  target?: 'all' | 'active' | 'whales' | 'test';
  template?: 'none' | 'promo' | 'reward' | 'maintenance' | 'invite';
  customHeader?: string;
  customFooter?: string;
  textMessage?: string;
  photoFileId?: string;
  buttons?: { text: string; url: string }[];
  tempButtonText?: string;
}
const broadcastStates = new Map<number, BroadcastComposer>();

interface CampaignMessage {
  chat_id: string | number;
  message_id: number;
}

interface Campaign {
  id: string;
  timestamp: number;
  type: string;
  target: string;
  template: string;
  textSnippet: string;
  sent_messages: CampaignMessage[];
}

const CAMPAIGNS_FILE = path.join(process.cwd(), "broadcast_campaigns.json");

function loadCampaigns(): Campaign[] {
  try {
    if (fs.existsSync(CAMPAIGNS_FILE)) {
      const data = fs.readFileSync(CAMPAIGNS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    logBot(`Failed to load campaigns file: ${e}`);
  }
  return [];
}

function saveCampaign(campaign: Campaign) {
  try {
    const campaigns = loadCampaigns();
    campaigns.unshift(campaign); // Add newest at start
    if (campaigns.length > 15) {
      campaigns.pop();
    }
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaigns, null, 2), "utf-8");
  } catch (e) {
    logBot(`Failed to save campaigns file: ${e}`);
  }
}

function updateCampaignsFile(campaigns: Campaign[]) {
  try {
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaigns, null, 2), "utf-8");
  } catch (e) {
    logBot(`Failed to rewrite campaigns file: ${e}`);
  }
}

function formatMessageWithTemplate(text: string, templateType?: string, customHeader?: string, customFooter?: string): string {
  let header = "";
  let footer = "";

  if (customHeader) {
    header = `${customHeader}\n───────────────────\n\n`;
  } else if (templateType && templateType !== 'none') {
    if (templateType === 'promo') {
      header = `🔥 <b>SPECIAL PROMOTION</b> 🔥\n───────────────────\n\n`;
    } else if (templateType === 'reward') {
      header = `🎁 <b>DAILY BONUS & REWARDS</b> 🎁\n───────────────────\n\n`;
    } else if (templateType === 'maintenance') {
      header = `⚡ <b>SYSTEM UPDATE & MAINTENANCE</b> ⚡\n───────────────────\n\n`;
    } else if (templateType === 'invite') {
      header = `🎮 <b>CHALLENGE INVITATION</b> 🎮\n───────────────────\n\n`;
    }
  }

  if (customFooter) {
    footer = `\n───────────────────\n${customFooter}`;
  } else if (templateType && templateType !== 'none') {
    if (templateType === 'promo') {
      footer = `\n───────────────────\n⚡ <i>Don't miss out, join the action now!</i>`;
    } else if (templateType === 'reward') {
      footer = `\n───────────────────\n👉 <i>Claim your rewards in the app before they expire!</i>`;
    } else if (templateType === 'maintenance') {
      footer = `\n───────────────────\n🔧 <i>We're keeping things running at peak performance!</i>`;
    } else if (templateType === 'invite') {
      footer = `\n───────────────────\n🏆 <i>Show off your skills! Play and win real ETB now!</i>`;
    }
  }

  return `${header}${text}${footer}`;
}

interface RegistrationState {
  payload?: string;
}
const pendingRegistrations = new Map<string, RegistrationState>();

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

interface CustomButton {
  text: string;
  type: 'webapp' | 'url' | 'callback';
  value: string;
}

interface CustomCommand {
  command: string;
  description: string;
  text: string;
  photo?: string;
  buttons: CustomButton[][];
}

interface BankConfig {
  name: string;
  account: string;
  owner_name: string;
}

interface PromptsConfig {
  deposit_start_msg: string;
  deposit_success_msg: string;
  deposit_approved_msg: string;
  deposit_declined_msg: string;
  support_text: string;

  withdraw_start_msg: string;
  withdraw_telebirr_prompt: string;
  withdraw_other_bank_prompt: string;
  withdraw_success_msg: string;
  withdraw_approved_msg: string;
  withdraw_declined_msg: string;

  welcome_msg: string;
  welcome_image?: string;
  welcome_guest_msg: string;
  welcome_guest_image?: string;
  support_card_msg: string;

  welcome_buttons: CustomButton[][];
  referral_msg: string;
  referral_image?: string;
  referral_share_text: string;
  referral_share_image?: string;
  referral_buttons: CustomButton[][];
  custom_commands?: {
    [cmd: string]: CustomCommand;
  };

  banks: {
    [bankId: string]: BankConfig;
  };
}

const DEFAULT_PROMPTS_CONFIG: PromptsConfig = {
  deposit_start_msg: "💰 *ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።*\n\n_(Please type the amount of ETB you want to deposit, minimum 10 ETB):_",
  deposit_success_msg: "✅ *Your deposit Request have been sent to admins please wait 1 min.*",
  deposit_approved_msg: "✅ *Your deposit of {amount} ETB is confirmed.*\n🧾 *Ref:* `{ref}`",
  deposit_declined_msg: "❌ *Your deposit of {amount} ETB is Declined.*",
  support_text: "ሚያጋጥማቹ የክፍያ ችግር:\n@wheelgamessupport\n@wheelgamesupport1 ላይ ፃፉልን።",

  withdraw_start_msg: "💰 *ማውጣት የሚፈልጉትን የገንዘብ መጠን ያስገቡ ?*\n\n💳 *የእርስዎ ባላንስ:* `{balance} ETB`\n\n_(Please type the amount you want to withdraw):_",
  withdraw_telebirr_prompt: "📱 *እባክዎን ስልክ ቁጥርን ያስገቡ:*",
  withdraw_other_bank_prompt: "🏦 *እባክዎን አካውንት ቁጥርን ያስገቡ:*",
  withdraw_success_msg: "✅ *Your withdrawal Request of {amount} ETB have been sent to admins please wait 1 min.*",
  withdraw_approved_msg: "✅ *Your withdrawal of {amount} ETB is confirmed.*\n🧾 *Ref:* `{ref}`",
  withdraw_declined_msg: "❌ *Withdrawal Declined*\n\nYour withdrawal of *{amount} Birr* was declined and refunded.",

  welcome_msg: "👋 *Welcome to ETB Game Hub, {name}!* 🎮\n\nExperience the thrill of real-time multiplayer gaming right here in Telegram!\n\n💰 *Your current balance:* `{balance}`\n\n🚀 *Available Games:*\n• 🟢 *Even/Odd* - High-octane multipliers and double-ups\n• 🏆 *Jackpot Arena* - Secure spots and sweep the pool prize\n• 🎡 *Wheel of Chance* - High stakes wheel of fortune\n\n👇 Click the button below to launch the Mini App and start playing immediately!",
  welcome_image: "",
  welcome_guest_msg: "🎮 <b>Welcome to ETB Game Hub!</b> 🚀\n\nExperience the ultimate Telegram gaming destination! Test your prediction skills with 🟢 <b>Even/Odd</b>, enter the 🏆 <b>Jackpot Arena</b>, or spin the 🎡 <b>Wheel of Chance</b> to win incredible rewards.\n\n💎 <i>Play instantly, win with real-time multipliers, and withdraw directly to your favorite wallet!</i>",
  welcome_guest_image: "",
  support_card_msg: "📞 *Contact Support*\n\n📱 *Phone:* `+251-931-50-35-59`\n📧 *Email:* `support@wheelgame.et`\n💬 *Telegram:* @wheelgame_support\n\n⏰ *Support Hours:*\nMonday - Sunday: 9 AM - 9 PM\n\nWe're here to help!",

  welcome_buttons: [
    [
      { text: "🎮 Play Game Hub 🚀", type: "webapp", value: "appUrl" }
    ],
    [
      { text: "💸 Deposit / ማስገቢያ", type: "callback", value: "menu_deposit" },
      { text: "🏦 Withdraw / ማውጫ", type: "callback", value: "menu_withdraw" }
    ],
    [
      { text: "📞 Contact Support", type: "callback", value: "menu_support" }
    ]
  ],
  referral_msg: "🤝 <b>Invite your friends and families!</b>\n\nShare your unique referral link and earn rewards when they join and play in the ETB Game Hub.\n\n🚀 <i>Let's grow the community together!</i>",
  referral_image: "",
  referral_share_text: "Join me on ETB Game Hub and win big!",
  referral_share_image: "",
  referral_buttons: [
    [
      { text: "📢 Share to Friends", type: "url", value: "https://t.me/share/url?url=https://t.me/{bot_username}?start=ref_{user_id}&text={referral_share_text}" }
    ]
  ],
  custom_commands: {},

  banks: {
    "Telebirr": {
      name: "📱 Telebirr",
      account: "0931503559",
      owner_name: "Tadese"
    },
    "CBE": {
      name: "🏦 CBE (የኢትዮጵያ ንግድ ባንክ)",
      account: "1000123456789",
      owner_name: "Tadese"
    },
    "Abyssinia": {
      name: "🏦 Abyssinia Bank",
      account: "987654321",
      owner_name: "Tadese"
    },
    "Dashen": {
      name: "🏦 Dashen Bank",
      account: "555444332",
      owner_name: "Tadese"
    }
  }
};

const PROMPTS_CONFIG_FILE_PATH = path.join(process.cwd(), "prompts_config.json");
let promptsConfig: PromptsConfig = { ...DEFAULT_PROMPTS_CONFIG };

function loadPromptsConfig(): PromptsConfig {
  try {
    if (fs.existsSync(PROMPTS_CONFIG_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROMPTS_CONFIG_FILE_PATH, "utf8"));
      return {
        ...DEFAULT_PROMPTS_CONFIG,
        ...data,
        banks: {
          ...DEFAULT_PROMPTS_CONFIG.banks,
          ...(data.banks || {})
        },
        custom_commands: {
          ...DEFAULT_PROMPTS_CONFIG.custom_commands,
          ...(data.custom_commands || {})
        }
      };
    }
  } catch (err: any) {
    logBot(`Error reading prompts config file: ${err.message}`);
  }
  return { ...DEFAULT_PROMPTS_CONFIG };
}

function savePromptsConfig(config: PromptsConfig) {
  try {
    fs.writeFileSync(PROMPTS_CONFIG_FILE_PATH, JSON.stringify(config, null, 2), "utf8");
    promptsConfig = config;
    logBot("Prompts configuration saved successfully.");
  } catch (err: any) {
    logBot(`Error writing prompts config file: ${err.message}`);
  }
}

// Load dynamic prompts config
promptsConfig = loadPromptsConfig();

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

// Function to sync admins with Supabase
async function syncAdminsFromDB() {
  try {
    const { data: adminUsers, error } = await supabase
      .from('users')
      .select('id')
      .eq('is_admin', true);
    
    if (error) {
      if (!error.message.includes('schema cache')) {
        logBot(`Error fetching admins from DB: ${error.message}`);
      }
      return;
    }

    if (adminUsers) {
      adminUsers.forEach(u => {
        const id = parseInt(u.id, 10);
        if (!isNaN(id)) adminChatIds.add(id);
      });
    }

    // Ensure all in-memory admins are synced back to DB
    for (const adminId of adminChatIds) {
      await supabase.from('users').update({ is_admin: true }).eq('id', adminId.toString()).then(({ error }) => {
        if (error && !error.message.includes('schema cache')) logBot(`Error syncing admin ${adminId}: ${error.message}`);
      });
    }
  } catch (err: any) {
    logBot(`syncAdminsFromDB error: ${err.message}`);
  }
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

  let appUrl = "https://wheelgames1.onrender.com";
  // Make sure we strip any trailing slash
  appUrl = appUrl.replace(/\/$/, "");
  
  const TelegramBotClass = typeof TelegramBot === "function" 
    ? TelegramBot 
    : ((TelegramBot as any).default || TelegramBot);
  const bot = new (TelegramBotClass as any)(token, { polling: true });

  bot.on("polling_error", (error: any) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
      console.warn("Polling conflict detected. Another instance is likely running.");
    } else {
      console.error("Polling error:", error.message || error);
    }
  });

  try {
    botInfo = await bot.getMe();
    console.log(`Telegram Bot @${botInfo.username} initialized.`);
    await syncAdminsFromDB();

    // Set bot commands including custom dynamic ones
    const systemCommands = [
      { command: "start", description: "Launch the game hub and display menu" },
      { command: "play", description: "Launch the Web App immediately" },
      { command: "balance", description: "Check your current wallet balance" },
      { command: "deposit", description: "Deposit ETB into your balance" },
      { command: "withdraw", description: "Withdraw ETB from your balance" },
      { command: "referral", description: "Invite friends and earn rewards" },
      { command: "support", description: "Show contact support details" },
      { command: "language", description: "Change bot language" },
      { command: "cancel", description: "Cancel current operation or active flows" }
    ];

    const customCommandsList = Object.entries(promptsConfig.custom_commands || {}).map(([cmd, cfg]) => ({
      command: cmd,
      description: cfg.description || "Custom command"
    }));

    await bot.setMyCommands([...systemCommands, ...customCommandsList]);

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
      bot.sendMessage(chatId, promptsConfig.deposit_start_msg, { parse_mode: "Markdown" });
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
      const rawMsg = promptsConfig.withdraw_start_msg;
      const msgText = rawMsg.replace(/{balance}/g, currentBalance.toLocaleString());
      bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
      logBot(`startWithdrawalFlow message sent successfully to chatId=${chatId}`);
    } catch (e: any) {
      logBot(`Error in startWithdrawalFlow for userId=${userId}: ${e?.message || e}`);
      bot.sendMessage(chatId, "⚠️ An error occurred preparing your withdrawal. Please try again.");
    }
  };

  startDepositFlowRef = startDepositFlow;
  startWithdrawalFlowRef = startWithdrawalFlow;

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

  const checkRegisteredAndHandle = async (msg: any, onRegistered: () => void | Promise<void>) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id?.toString();
    if (!userId) return;

    try {
      const { data, error } = await supabase.from('users').select('id').eq('id', userId);
      if (data && data.length > 0) {
        await onRegistered();
      } else {
        const lang = userLanguages.get(parseInt(userId)) || 'en';
        pendingRegistrations.set(userId, { payload: "" });
        const desc = t('welcome_desc', lang);

        bot.sendMessage(chatId, desc, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: t('btn_start_play', lang), callback_data: "register_start" }
              ]
            ]
          }
        });
      }
    } catch (e: any) {
      logBot(`Error checking registration: ${e.message}`);
      await onRegistered();
    }
  };

  registerCommandHandlers(bot, logBot, checkRegisteredAndHandle, sendSupportCard);

  // --- BOT COMMANDS HANDLERS ---
  
  // Start Command
  bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const firstName = msg.from?.first_name || "Player";
    const payload = match ? match[1] : '';

    if (!userId) return;

    let isRegistered = false;
    try {
      const { data, error } = await supabase.from('users').select('id').eq('id', userId);
      if (data && data.length > 0) {
        isRegistered = true;
      }
    } catch (e) {
      logBot(`Error checking registration: ${e}`);
    }

    if (isRegistered) {
      if (payload === 'deposit') {
        return startDepositFlow(chatId, userId);
      } else if (payload === 'withdraw') {
        return startWithdrawalFlow(chatId, userId);
      }

      // Default main menu greeting
      let userBalanceStr = "100,000 ETB (Demo)";
      try {
        const { data } = await supabase.from('users').select('balance').eq('id', userId);
        if (data && data.length > 0) {
          userBalanceStr = `${Number(data[0].balance).toLocaleString()} ETB`;
        }
      } catch (e) {
        // Ignored
      }

      const welcomeMsgPattern = promptsConfig.welcome_msg || 
        `👋 *Welcome to ETB Game Hub, {name}!* 🎮\n\n` +
        `Experience the thrill of real-time multiplayer gaming right here in Telegram!\n\n` +
        `💰 *Your current balance:* \`{balance}\`\n\n` +
        `🚀 *Available Games:*\n` +
        `• 🟢 *Even/Odd* - High-octane multipliers and double-ups\n` +
        `• 🏆 *Jackpot Arena* - Secure spots and sweep the pool prize\n` +
        `• 🎡 *Wheel of Chance* - High stakes wheel of fortune\n\n` +
        `👇 Click the button below to launch the Mini App and start playing immediately!`;
        
      const welcomeMsg = welcomeMsgPattern
        .replace(/{name}/g, firstName)
        .replace(/{balance}/g, userBalanceStr);

      const welcomeButtonsRows = (promptsConfig.welcome_buttons || [
        [
          { text: "🎮 Play Game Hub 🚀", type: "webapp", value: "appUrl" }
        ],
        [
          { text: "💸 Deposit / ማስገቢያ", type: "callback", value: "menu_deposit" },
          { text: "🏦 Withdraw / ማውጫ", type: "callback", value: "menu_withdraw" }
        ],
        [
          { text: "📞 Contact Support", type: "callback", value: "menu_support" }
        ]
      ]).map(row => 
        row.map(btn => {
          const btnVal = btn.value === 'appUrl' ? appUrl : btn.value;
          if (btn.type === 'webapp') {
            return { text: btn.text, web_app: { url: btnVal } };
          } else if (btn.type === 'url') {
            return { text: btn.text, url: btnVal };
          } else {
            return { text: btn.text, callback_data: btnVal };
          }
        })
      );

      const options = {
        parse_mode: "Markdown" as const,
        reply_markup: {
          inline_keyboard: welcomeButtonsRows
        }
      };

      if (promptsConfig.welcome_image) {
        bot.sendPhoto(chatId, promptsConfig.welcome_image, {
          caption: welcomeMsg,
          parse_mode: "Markdown",
          reply_markup: options.reply_markup
        }).catch(() => bot.sendMessage(chatId, welcomeMsg, options));
      } else {
        bot.sendMessage(chatId, welcomeMsg, options);
      }
    } else {
      pendingRegistrations.set(userId, { payload });

      const desc = promptsConfig.welcome_guest_msg || `🎮 <b>Welcome to ETB Game Hub!</b> 🚀\n\n` +
        `Experience the ultimate Telegram gaming destination! Test your prediction skills with 🟢 <b>Even/Odd</b>, enter the 🏆 <b>Jackpot Arena</b>, or spin the 🎡 <b>Wheel of Chance</b> to win incredible rewards.\n\n` +
        `💎 <i>Play instantly, win with real-time multipliers, and withdraw directly to your favorite wallet!</i>`;

      const options = {
        parse_mode: "HTML" as const,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎮 Start Play / ለመጫወት ጀምር 🚀", callback_data: "register_start" }
            ]
          ]
        }
      };

      if (promptsConfig.welcome_guest_image) {
        bot.sendPhoto(chatId, promptsConfig.welcome_guest_image, {
          caption: desc,
          parse_mode: "HTML",
          reply_markup: options.reply_markup
        }).catch(() => bot.sendMessage(chatId, desc, options));
      } else {
        bot.sendMessage(chatId, desc, options);
      }
    }
  });

  // Play Command
  bot.onText(/\/play/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
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
  });

  // Quick Command triggers for Deposits and Withdrawals
  bot.onText(/\/deposit/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
      if (msg.from?.id) startDepositFlow(msg.chat.id, msg.from.id.toString());
    });
  });

  bot.onText(/\/withdraw/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
      if (msg.from?.id) startWithdrawalFlow(msg.chat.id, msg.from.id.toString());
    });
  });

  bot.onText(/\/referral/, async (msg) => {
    await checkRegisteredAndHandle(msg, () => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id.toString();
      if (!userId) return;

      const botUsername = botInfo?.username || "ETBGameHubBot";
      const referralShareText = encodeURIComponent(promptsConfig.referral_share_text || "Join me on ETB Game Hub and win big!");
      
      const referralMsg = (promptsConfig.referral_msg || "🤝 <b>Invite your friends and families!</b>")
        .replace(/{user_id}/g, userId)
        .replace(/{bot_username}/g, botUsername)
        .replace(/{referral_share_text}/g, promptsConfig.referral_share_text);

      const buttons = (promptsConfig.referral_buttons || []).map(row =>
        row.map(btn => {
          const btnVal = btn.value
            .replace(/{user_id}/g, userId)
            .replace(/{bot_username}/g, botUsername)
            .replace(/{referral_share_text}/g, referralShareText);
          return { text: btn.text, url: btnVal };
        })
      );

      const options = {
        parse_mode: "HTML" as const,
        reply_markup: {
          inline_keyboard: buttons
        }
      };

      if (promptsConfig.referral_image) {
        bot.sendPhoto(chatId, promptsConfig.referral_image, {
          caption: referralMsg,
          ...options
        }).catch(() => bot.sendMessage(chatId, referralMsg, options));
      } else {
        bot.sendMessage(chatId, referralMsg, options);
      }
    });
  });

  bot.onText(/\/balance/, async (msg) => {
    await checkRegisteredAndHandle(msg, async () => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id?.toString();
      if (!userId) return;

      try {
        const { data, error } = await supabase.from('users').select('balance').eq('id', userId).single();
        if (error) {
          bot.sendMessage(chatId, "⚠️ *Error retrieving balance.*", { parse_mode: "Markdown" });
          return;
        }

        const balanceVal = data ? Number(data.balance) : 0;
        const msgText = `💵 *Your Current Balance / የሂሳብዎ መጠን:*\n\n` +
          `💰 *${balanceVal.toLocaleString()} ETB*\n\n` +
          `🎮 _Play inside the web app and keep winning!_`;

        bot.sendMessage(chatId, msgText, { parse_mode: "Markdown" });
      } catch (err: any) {
        logBot(`Error in /balance handler: ${err.message}`);
        bot.sendMessage(chatId, "⚠️ *Error retrieving balance.*", { parse_mode: "Markdown" });
      }
    });
  });

  // Cancel flow command
  bot.onText(/\/cancel/, (msg) => {
    const userId = msg.from?.id;
    if (userId) {
      if (isOwner(userId)) {
        setAdminStates.delete(userId);
      }
      if (adminChatIds.has(userId)) {
        broadcastStates.delete(userId);
      }
      userStates.set(userId.toString(), { step: 'idle' });
      bot.sendMessage(msg.chat.id, "✅ <b>All active flows and setups have been canceled.</b>", { parse_mode: "HTML" });
    }
  });

  // Owner Admin Management control panel
  async function renderSetAdminMenu(bot: any, chatId: number) {
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
  }

  bot.onText(/\/setadmin/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!isOwner(userId)) {
      bot.sendMessage(chatId, `❌ <b>Access Denied.</b>\n\nThis command is restricted to the Starting Admin/Owner of this bot.`, { parse_mode: "HTML" });
      logBot(`Failed admin control panel access attempt by userId=${userId}`);
      return;
    }

    renderSetAdminMenu(bot, chatId);
  });

  bot.onText(/\/control/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !adminChatIds.has(userId)) {
      return;
    }

    renderMainControlPanel(chatId);
  });

  function renderMainControlPanel(chatId: number, messageId?: number) {
    const text = "🛠️ <b>Main Control Panel</b>";
    const keyboard = {
      inline_keyboard: [
        [
          { text: "👑 Set Admin", callback_data: "control_setadmin" },
          { text: "📊 Analysis", callback_data: "control_analysis" }
        ],
        [
          { text: "📢 Broadcast", callback_data: "control_broadcast" },
          { text: "📝 Edit Prompts", callback_data: "control_edit" }
        ],
        [
          { text: "🔗 Command Links", callback_data: "control_links" }
        ]
      ]
    };

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  function renderCommandLinks(chatId: number, messageId?: number) {
    const botUsername = botInfo?.username || "ETBGameHubBot";
    let text = "🔗 <b>Direct Command & Deep Links</b>\n\n";
    text += `• <b>Start:</b> <code>https://t.me/${botUsername}?start=1</code>\n`;
    text += `• <b>Deposit:</b> <code>https://t.me/${botUsername}?start=deposit</code>\n`;
    text += `• <b>Withdraw:</b> <code>https://t.me/${botUsername}?start=withdraw</code>\n`;
    text += `• <b>Referral:</b> <code>/referral</code>\n`;
    text += `• <b>Play:</b> <code>/play</code>\n\n`;
    
    text += "🛠️ <b>Admin Commands:</b>\n";
    text += `• <code>/control</code> - Main Panel\n`;
    text += `• <code>/edit</code> - Edit Prompts\n`;
    text += `• <code>/analysis</code> - Game Analysis\n`;
    text += `• <code>/broadcast</code> - Message Broadcast\n`;
    text += `• <code>/setadmin</code> - Manage Admins\n`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: "🔙 Back to Control", callback_data: "control_back" }]
      ]
    };

    if (messageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }));
    } else {
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  bot.onText(/\/edit/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !adminChatIds.has(userId)) {
      return;
    }

    sendEditPanelMenu(chatId);
  });

  function sendEditPanelMenu(chatId: number, messageId?: number) {
    const text = "📝 <b>Edit Panel</b>\n\nSelect the flow or section you want to customize below:";
    const keyboard = {
      inline_keyboard: [
        [
          { text: "👋 Welcome & Support Prompts", callback_data: "edit_section_welcome" }
        ],
        [
          { text: "🔘 Welcome Buttons Menu", callback_data: "edit_section_welcome_buttons" }
        ],
        [
          { text: "📥 Deposit Flow Prompts", callback_data: "edit_section_deposit" }
        ],
        [
          { text: "📤 Withdrawal Flow Prompts", callback_data: "edit_section_withdrawal" }
        ],
        [
          { text: "🤝 Referral Prompt", callback_data: "edit_section_referral" }
        ],
        [
          { text: "🏦 Bank Accounts Detail", callback_data: "edit_section_banks" }
        ],
        [
          { text: "✨ Custom Commands Manager", callback_data: "edit_section_custom_commands" }
        ],
        [
          { text: "🛠️ Main Control Panel", callback_data: "control_back" }
        ]
      ]
    };

    if (messageId) {
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: keyboard
      }).catch(e => console.error("Edit panel update failed:", e));
    } else {
      bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      }).catch(e => console.error("Edit panel send failed:", e));
    }
  }

  async function sendCustomCommandEditMenu(chatId: number, cmdName: string, messageId?: number) {
    const cmd = promptsConfig.custom_commands?.[cmdName];
    if (!cmd) return;
    
    let text = `🛠️ <b>Custom Command Settings: /${cmdName}</b>\n\n` +
      `• <b>Description:</b> <code>${cmd.description || 'None'}</code>\n` +
      `• <b>Response Text:</b>\n<pre>${cmd.text}</pre>\n` +
      `• <b>Photo:</b> <code>${cmd.photo ? 'Enabled (File ID: ' + cmd.photo.slice(0, 15) + '...)' : 'Disabled'}</code>\n` +
      `• <b>Buttons:</b> <code>${cmd.buttons && cmd.buttons.length > 0 ? cmd.buttons.flat().length + ' custom buttons' : 'None'}</code>\n\n` +
      `Select which aspect you want to configure:`;
      
    const keyboard = {
      inline_keyboard: [
        [{ text: "📝 Edit Response Text", callback_data: `ccmd_val_${cmdName}_text` }],
        [{ text: "🏷️ Edit Description", callback_data: `ccmd_val_${cmdName}_desc` }],
        [{ text: "🖼️ Set Photo (File ID/URL)", callback_data: `ccmd_val_${cmdName}_photo` }],
        [{ text: "🚫 Clear Photo", callback_data: `ccmd_val_${cmdName}_photo_clear` }],
        [{ text: "🔘 Manage Command Buttons", callback_data: `ccmd_val_${cmdName}_buttons` }],
        [{ text: "🗑️ Delete Command", callback_data: `ccmd_val_${cmdName}_delete` }],
        [{ text: "🔙 Back to Custom Commands", callback_data: "edit_section_custom_commands" }]
      ]
    };
    
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
    }
  }

  async function sendCustomCommandButtonsPanel(chatId: number, cmdName: string, messageId?: number) {
    const cmd = promptsConfig.custom_commands?.[cmdName];
    if (!cmd) return;
    
    let text = `🔘 <b>Buttons Manager for /${cmdName}</b>\n\n` +
      `Configure custom inline buttons that appear below the message for /${cmdName}.\n\n`;
      
    const inlineKeyboard: any[] = [];
    const buttons = cmd.buttons || [];
    
    if (buttons.length === 0) {
      text += `<i>No buttons configured yet.</i>`;
    } else {
      buttons.forEach((row, rIndex) => {
        const rowButtons: any[] = [];
        row.forEach((btn, cIndex) => {
          text += `• Row ${rIndex + 1}, Col ${cIndex + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
          rowButtons.push({
            text: `✏️ Row ${rIndex + 1} Col ${cIndex + 1}: ${btn.text}`,
            callback_data: `cc_btn_click_${cmdName}_${rIndex}_${cIndex}`
          });
        });
        inlineKeyboard.push(rowButtons);
      });
    }
    
    inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: `cc_btn_add_${cmdName}` }]);
    inlineKeyboard.push([{ text: "🔙 Back to Command", callback_data: `ccmd_edit_${cmdName}` }]);
    
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } }).catch(() => {});
    }
  }

  // Build inline keyboard for campaign messages sent to users
  function buildCampaignReplyMarkup(composer: BroadcastComposer, webAppUrl: string) {
    const keyboardRows: any[] = [];
    
    if (composer.buttons && composer.buttons.length > 0) {
      composer.buttons.forEach(btn => {
        if (btn.url === 'webapp' || btn.url === 'play') {
          keyboardRows.push([{ text: btn.text, web_app: { url: webAppUrl } }]);
        } else {
          keyboardRows.push([{ text: btn.text, url: btn.url }]);
        }
      });
    } else if (composer.type === 'webapp') {
      keyboardRows.push([{ text: "Play Game 🎮", web_app: { url: webAppUrl } }]);
    }
    
    return keyboardRows;
  }

  // Helper function to render the real-time WYSIWYG preview of the admin broadcast
  async function showBroadcastReview(bot: any, chatId: number, userId: number, composer: BroadcastComposer) {
    const rawText = composer.textMessage || "";
    const formattedText = formatMessageWithTemplate(rawText, composer.template, composer.customHeader, composer.customFooter);

    let previewText = `📢 <b>Review & Confirm Your Announcement</b>\n\n`;
    previewText += `📝 <b>Live Preview (as players will see it):</b>\n`;
    previewText += `┌───────────────────┐\n`;
    
    if (formattedText) {
      previewText += ` ${formattedText}\n`;
    } else if (composer.type === 'photo') {
      previewText += ` <i>(No caption text, only photo)</i>\n`;
    }
    
    previewText += `└───────────────────┘\n\n`;
    
    const targetLabel = {
      all: '👥 All Registered Players',
      active: '⚡ Active Players (with Game History)',
      whales: '💰 High Balancers / Whales (>= 150K)',
      test: '🧪 Test Admins Only'
    }[composer.target || 'all'];

    previewText += `⚙️ <b>Details:</b>\n`;
    previewText += `• <b>Audience Target:</b> <code>${targetLabel}</code>\n`;
    const typeLabel = {
      text: '📝 Text-Only',
      photo: '🖼️ Photo + Caption',
      photo_button: '🖼️ Photo + Caption + Button',
      webapp: '🔘 Text + Play Button'
    }[composer.type || 'text'];
    previewText += `• <b>Type:</b> <code>${typeLabel}</code>\n`;
    
    const actionButtons: any[] = [
      [
        { text: "🚀 Confirm & Send", callback_data: "bcast_action_send" },
        { text: "📌 Send & Pin", callback_data: "bcast_action_send_pin" }
      ],
      [
        { text: "✍️ Edit Content", callback_data: "bcast_action_edit" },
        { text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }
      ]
    ];

    const customCampaignRows = buildCampaignReplyMarkup(composer, appUrl);
    const inlineButtons = [...customCampaignRows, ...actionButtons];

    if ((composer.type === 'photo' || composer.type === 'photo_button') && composer.photoFileId) {
      await bot.sendPhoto(chatId, composer.photoFileId, {
        caption: previewText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: inlineButtons
        }
      });
    } else {
      await bot.sendMessage(chatId, previewText, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: inlineButtons
        }
      });
    }
  }

  // Dashboard Renderer
  async function renderBroadcastDashboard(bot: any, chatId: number, userId: number, composer: BroadcastComposer, existingMessageId?: number) {
    const targetLabel = {
      all: '👥 All Registered Players',
      active: '⚡ Active Players (with Game History)',
      whales: '💰 High Balancers / Whales (>= 150K)',
      test: '🧪 Test Admins Only'
    }[composer.target || 'all'];

    const templateLabel = {
      none: 'None (Plain Text)',
      promo: '🔥 Special Promotion Alert',
      reward: '🎁 Daily Reward / Bonus Promo',
      maintenance: '⚡ System Maintenance Update',
      invite: '🎮 Interactive Game Invitation'
    }[composer.template || 'none'];

    const styleLabel = {
      text: '📝 Text-Only Message',
      photo: '🖼️ Photo + Caption Message',
      webapp: '🔘 Text + Play Game Button'
    }[composer.type || 'Not Chosen Yet'];

    const customHeaderLabel = composer.customHeader ? `<code>${composer.customHeader}</code>` : '<i>Not Set (Using Preset Header)</i>';
    const customFooterLabel = composer.customFooter ? `<code>${composer.customFooter}</code>` : '<i>Not Set (Using Preset Footer)</i>';

    let buttonsListLabel = '<i>No custom buttons configured.</i>';
    if (composer.buttons && composer.buttons.length > 0) {
      buttonsListLabel = composer.buttons.map((btn, index) => {
        const typeLabel = (btn.url === 'webapp' || btn.url === 'play') ? '🎮 Play Web App' : '🔗 Link';
        return `  ${index + 1}. <b>${btn.text}</b> (${typeLabel})`;
      }).join('\n');
    }

    const dashboardText = `📢 <b>Broadcast Campaign Studio</b>\n\n` +
      `Welcome to the advanced messaging suite. Build high-conversion player campaigns with rich media, header presets, custom styles, and multiple interactive buttons.\n\n` +
      `⚙️ <b>Current Campaign Settings:</b>\n` +
      `• 🎯 <b>Target Audience:</b> ${targetLabel}\n` +
      `• 🎨 <b>Header Preset:</b> ${templateLabel}\n` +
      `• ✍️ <b>Custom Header:</b> ${customHeaderLabel}\n` +
      `• ✍️ <b>Custom Footer:</b> ${customFooterLabel}\n` +
      `• 📝 <b>Composition Style:</b> <code>${styleLabel}</code>\n` +
      `• 🔘 <b>Custom Buttons:</b>\n${buttonsListLabel}\n\n` +
      `👇 <b>Setup your campaign options:</b>`;

    const keyboard = [
      [
        { text: "🎯 Target Audience", callback_data: "bcast_dash_target" },
        { text: "🎨 Header Preset", callback_data: "bcast_dash_template" }
      ],
      [
        { text: "🏷️ Custom Header/Footer", callback_data: "bcast_dash_custom_decor" },
        { text: "🔘 Manage Buttons (" + (composer.buttons?.length || 0) + ")", callback_data: "bcast_dash_buttons" }
      ],
      [
        { text: "📝 Compose Message & Send", callback_data: "bcast_dash_style" }
      ],
      [
        { text: "📜 Retract / Delete Campaigns", callback_data: "bcast_dash_history" }
      ],
      [
        { text: "❌ Cancel Studio", callback_data: "bcast_cancel" }
      ]
    ];

    if (existingMessageId) {
      await bot.editMessageText(dashboardText, {
        chat_id: chatId,
        message_id: existingMessageId,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, dashboardText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  }

  async function renderCustomDecorSelection(bot: any, chatId: number, messageId: number, composer: BroadcastComposer) {
    const customHeaderVal = composer.customHeader ? `<code>${composer.customHeader}</code>` : '<i>Not configured (using preset/none)</i>';
    const customFooterVal = composer.customFooter ? `<code>${composer.customFooter}</code>` : '<i>Not configured (using preset/none)</i>';

    const text = `🏷️ <b>Custom Header & Footer Decor</b>\n\n` +
      `Override the preset header/footer with your own text, formatting, and emojis.\n\n` +
      `• <b>Current Header:</b> ${customHeaderVal}\n` +
      `• <b>Current Footer:</b> ${customFooterVal}\n\n` +
      `Choose an option below to enter your custom text:`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✍️ Set Custom Header", callback_data: "bcast_custom_decor_header" },
            { text: "✍️ Set Custom Footer", callback_data: "bcast_custom_decor_footer" }
          ],
          [
            { text: "🧹 Clear Custom Decor", callback_data: "bcast_custom_decor_clear" }
          ],
          [
            { text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }
          ]
        ]
      }
    }).catch(() => {});
  }

  async function renderButtonsManager(bot: any, chatId: number, messageId: number, composer: BroadcastComposer) {
    let text = `🔘 <b>Interactive Button Manager</b>\n\n` +
      `Attach multiple custom buttons underneath your broadcast message (either to text or image broadcasts). Players can click them to play the Web App or open custom links.\n\n` +
      `<b>Configure up to 4 custom buttons:</b>\n`;

    if (!composer.buttons || composer.buttons.length === 0) {
      text += `<i>No buttons added yet. By default, 'Play Game' mode attaches a single Web App button. If you add custom buttons here, they will override it.</i>`;
    } else {
      composer.buttons.forEach((btn, index) => {
        const typeLabel = (btn.url === 'webapp' || btn.url === 'play') ? '🎮 Play Web App' : `🔗 Link (<code>${btn.url}</code>)`;
        text += `• <b>Button ${index + 1}:</b> <code>"${btn.text}"</code> → ${typeLabel}\n`;
      });
    }

    const keyboard: any[] = [];
    
    if (!composer.buttons || composer.buttons.length < 4) {
      keyboard.push([{ text: "➕ Add Custom Button", callback_data: "bcast_buttons_add" }]);
    }
    
    if (composer.buttons && composer.buttons.length > 0) {
      keyboard.push([{ text: "🧹 Clear All Buttons", callback_data: "bcast_buttons_clear" }]);
      keyboard.push([{ text: "✅ Done & Review", callback_data: "bcast_buttons_done" }]);
    }

    keyboard.push([{ text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: keyboard
      }
    }).catch(() => {});
  }

  async function renderTargetSelection(bot: any, chatId: number, messageId: number) {
    const text = `🎯 <b>Select Target Audience</b>\n\n` +
      `Filter who will receive this broadcast campaign:\n\n` +
      `• <b>All Registered Players:</b> Deliver to every player in the database.\n` +
      `• <b>Active Players:</b> Target players with active game history logs.\n` +
      `• <b>High Balancers / Whales:</b> Target players with balance >= 150,000 ETB.\n` +
      `• <b>Test Admins Only:</b> Safely send only to active admins to preview live before player blast.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "👥 All Players", callback_data: "bcast_set_target_all" },
            { text: "⚡ Active Players", callback_data: "bcast_set_target_active" }
          ],
          [
            { text: "💰 Whales (>= 150K)", callback_data: "bcast_set_target_whales" },
            { text: "🧪 Test Admins Only", callback_data: "bcast_set_target_test" }
          ],
          [
            { text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }
          ]
        ]
      }
    }).catch(() => {});
  }

  async function renderTemplateSelection(bot: any, chatId: number, messageId: number) {
    const text = `🎨 <b>Select Visual Header Template</b>\n\n` +
      `Add pre-formatted visual styles and alerts to make your message grab player attention immediately:\n\n` +
      `• <b>None:</b> Sends only your raw message text.\n` +
      `• <b>Special Promotion:</b> Custom fire headers and hot-action subtexts.\n` +
      `• <b>Daily Bonus / Reward:</b> Festive gift motifs and reward claim reminders.\n` +
      `• <b>System Maintenance:</b> Professional alert frames for server downtime/updates.\n` +
      `• <b>Interactive Invitation:</b> Exciting gaming call-to-actions.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Plain Text (None)", callback_data: "bcast_set_temp_none" },
            { text: "🔥 Promo Alert", callback_data: "bcast_set_temp_promo" }
          ],
          [
            { text: "🎁 Daily Bonus", callback_data: "bcast_set_temp_reward" },
            { text: "⚡ Maintenance", callback_data: "bcast_set_temp_maintenance" }
          ],
          [
            { text: "🎮 Game Invite", callback_data: "bcast_set_temp_invite" }
          ],
          [
            { text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }
          ]
        ]
      }
    }).catch(() => {});
  }

  async function renderStyleSelection(bot: any, chatId: number, messageId: number) {
    const text = `📝 <b>Select Broadcast Style</b>\n\n` +
      `Choose the message structure for this broadcast:\n\n` +
      `• <b>Text-Only:</b> Fast delivery of formatted HTML rich-text.\n` +
      `• <b>Photo + Caption:</b> Upload an image with styled text below it.\n` +
      `• <b>Photo + Caption + Button:</b> Upload image, add caption & custom buttons.\n` +
      `• <b>Text + Play Button:</b> Add a prominent "Play Game 🎮" Web App button to maximize traffic.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📝 Text Only", callback_data: "bcast_type_text" }
          ],
          [
            { text: "🖼️ Photo + Caption", callback_data: "bcast_type_photo" },
            { text: "🖼️ Photo + Caption + Button", callback_data: "bcast_type_photo_button" }
          ],
          [
            { text: "🔘 Text + Play Button", callback_data: "bcast_type_webapp" }
          ],
          [
            { text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }
          ]
        ]
      }
    }).catch(() => {});
  }

  async function renderBroadcastHistory(bot: any, chatId: number, messageId: number) {
    const campaigns = loadCampaigns();
    let text = `📜 <b>Recent Broadcast Campaigns & Retraction</b>\n\n` +
      `Select a past campaign below to instantly **delete** and retract it from every user's chat. This deletes the message from their inbox.\n\n`;

    if (campaigns.length === 0) {
      text += `<i>No recent broadcast campaigns found.</i>`;
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }]]
        }
      }).catch(() => {});
      return;
    }

    const keyboard: any[] = [];
    campaigns.slice(0, 5).forEach((camp) => {
      const date = new Date(camp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const snippet = camp.textSnippet.length > 20 ? camp.textSnippet.slice(0, 17) + "..." : camp.textSnippet;
      const label = `🗑️ [${date}] ${snippet || 'Media'}`;
      keyboard.push([{ text: label, callback_data: `bcast_hist_retract_${camp.id}` }]);
    });

    keyboard.push([{ text: "🔙 Back to Studio", callback_data: "bcast_back_dash" }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
  }

  async function renderRetractConfirmation(bot: any, chatId: number, messageId: number, campaignId: string) {
    const campaigns = loadCampaigns();
    const camp = campaigns.find(c => c.id === campaignId);
    if (!camp) return;

    const date = new Date(camp.timestamp).toLocaleString();
    const total = camp.sent_messages.length;
    const text = `⚠️ <b>Confirm Campaign Retraction / Deletion</b>\n\n` +
      `You are about to delete this broadcast message from <b>all ${total} players</b> who received it.\n\n` +
      `• <b>Date Sent:</b> <code>${date}</code>\n` +
      `• <b>Snippet:</b> <i>"${camp.textSnippet}"</i>\n\n` +
      `<b>WARNING:</b> This action is irreversible. It will attempt to delete the message from every recipient's private chat.`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔥 YES, Retract & Delete Now", callback_data: `bcast_retract_execute_${campaignId}` }
          ],
          [
            { text: "🔙 Cancel", callback_data: "bcast_dash_history" }
          ]
        ]
      }
    }).catch(() => {});
  }

  // Interactive Broadcast Wizard for Admins
  bot.onText(/\/broadcast/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !adminChatIds.has(userId)) {
      bot.sendMessage(chatId, `❌ <b>Access Denied.</b>\n\nThis command is restricted to administrators only.`, { parse_mode: "HTML" });
      logBot(`Failed broadcast command attempt by userId=${userId}`);
      return;
    }

    // Initialize campaign builder session with premium default values
    const composer: BroadcastComposer = {
      step: 'choose_target',
      target: 'all',
      template: 'none'
    };
    broadcastStates.set(userId, composer);

    await renderBroadcastDashboard(bot, chatId, userId, composer);
  });

  bot.onText(/\/analysis/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    
    if (!userId || !adminChatIds.has(userId)) {
      bot.sendMessage(chatId, `❌ <b>Access Denied.</b>`, { parse_mode: "HTML" });
      return;
    }
    
    bot.sendMessage(chatId, "📊 <b>Select Timeframe:</b>", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📅 Day", callback_data: "analysis_day" },
            { text: "🗓️ Week", callback_data: "analysis_week" }
          ],
          [
            { text: "📆 Month", callback_data: "analysis_month" },
            { text: "📅 Year", callback_data: "analysis_year" }
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
    if (text.startsWith("/")) {
      const commandParts = text.slice(1).split(" ");
      let cmdName = commandParts[0].toLowerCase();
      if (cmdName.includes("@")) {
        cmdName = cmdName.split("@")[0];
      }

      const customCmd = promptsConfig.custom_commands?.[cmdName];
      if (customCmd) {
        try {
          const buttons = (customCmd.buttons || []).map(row => 
            row.map(btn => {
              const btnVal = btn.value === 'appUrl' ? appUrl : btn.value;
              if (btn.type === 'webapp') {
                return { text: btn.text, web_app: { url: btnVal } };
              } else if (btn.type === 'url') {
                return { text: btn.text, url: btnVal };
              } else {
                return { text: btn.text, callback_data: btnVal };
              }
            })
          );

          if (customCmd.photo) {
            await bot.sendPhoto(chatId, customCmd.photo, {
              caption: customCmd.text,
              parse_mode: "HTML",
              reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
            });
          } else {
            await bot.sendMessage(chatId, customCmd.text, {
              parse_mode: "HTML",
              reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
            });
          }
        } catch (e: any) {
          logBot(`Error executing custom command /${cmdName}: ${e.message}`);
          await bot.sendMessage(chatId, `❌ Failed to execute command /${cmdName}.`);
        }
      }
      return;
    }

    const numUserId = msg.from?.id;

    // Process admin prompt-editing interactive states
    const editState = userStates.get(userId);
    if (editState && editState.step === 'edit_prompt_value' && editState.editingKey) {
      if (!numUserId || !adminChatIds.has(numUserId)) {
        userStates.set(userId, { step: 'idle' });
        return;
      }

      const key = editState.editingKey;
      
      // Handle Image/Photo for specific keys
      const imageKeys = ['referral_image', 'referral_share_image', 'welcome_image', 'welcome_guest_image'];
      if (imageKeys.includes(key as string) && msg.photo && msg.photo.length > 0) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        (promptsConfig as any)[key] = fileId;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ <b>Successfully updated the image!</b>`, { parse_mode: "HTML" });
        sendEditPanelMenu(chatId);
        return;
      }

      if (text.toLowerCase() === 'none' && imageKeys.includes(key as string)) {
        (promptsConfig as any)[key] = "";
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ <b>Successfully removed the image!</b>`, { parse_mode: "HTML" });
        sendEditPanelMenu(chatId);
        return;
      }

      try {
        if (key.startsWith("bank_")) {
          // Format: bank_{bankId}_{prop}
          const parts = key.replace("bank_", "").split("_");
          const bankId = parts[0];
          const prop = parts.slice(1).join("_"); // 'name' | 'account' | 'owner_name'
          
          if (!promptsConfig.banks[bankId]) {
            promptsConfig.banks[bankId] = { name: bankId, account: "", owner_name: "" };
          }
          (promptsConfig.banks[bankId] as any)[prop] = text;
          savePromptsConfig(promptsConfig);

          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, `✅ <b>Successfully updated ${bankId} bank property "${prop}"!</b>`, { parse_mode: "HTML" });
          
          // Render bank menu back to admin
          const bank = promptsConfig.banks[bankId];
          const editBankText = `🏦 <b>Bank Settings: ${bankId}</b>\n\n` +
            `🏷️ <b>Display Name:</b> <code>${bank.name}</code>\n` +
            `💳 <b>Account/Phone:</b> <code>${bank.account}</code>\n` +
            `👤 <b>Owner Name:</b> <code>${bank.owner_name}</code>\n\n` +
            `Select which property you want to edit:`;
          const keyboard = {
            inline_keyboard: [
              [{ text: "🏷️ Edit Display Name", callback_data: `edit_bankval_${bankId}_name` }],
              [{ text: "💳 Edit Account/Phone", callback_data: `edit_bankval_${bankId}_account` }],
              [{ text: "👤 Edit Owner Name", callback_data: `edit_bankval_${bankId}_owner_name` }],
              [{ text: "🔙 Back to Banks", callback_data: "edit_section_banks" }]
            ]
          };
          await bot.sendMessage(chatId, editBankText, { parse_mode: "HTML", reply_markup: keyboard });
          return;
        } else {
          // Regular prompt key
          (promptsConfig as any)[key] = text;
          savePromptsConfig(promptsConfig);

          userStates.set(userId, { step: 'idle' });
          await bot.sendMessage(chatId, `✅ <b>Successfully updated prompt for "${key}"!</b>`, { parse_mode: "HTML" });

          // Render corresponding section menu
          let section = "control_edit";
          let sectionTitle = "📝 Edit Panel";
          let sectionButtons: any[] = [];

          if (key.startsWith("withdraw")) {
            section = "edit_section_withdrawal";
            sectionTitle = "📤 Withdrawal Flow Prompts";
            sectionButtons = [
              [{ text: "💰 Start Message", callback_data: "edit_key_withdraw_start_msg" }],
              [{ text: "📱 Telebirr Phone Prompt", callback_data: "edit_key_withdraw_telebirr_prompt" }],
              [{ text: "🏦 Other Bank Account Prompt", callback_data: "edit_key_withdraw_other_bank_prompt" }],
              [{ text: "✅ Success Message", callback_data: "edit_key_withdraw_success_msg" }],
              [{ text: "🎉 Approved Message", callback_data: "edit_key_withdraw_approved_msg" }],
              [{ text: "❌ Declined Message", callback_data: "edit_key_withdraw_declined_msg" }],
              [{ text: "🔙 Back", callback_data: "control_edit" }]
            ];
          } else if (key.startsWith("deposit") || key === "support_text") {
            section = "edit_section_deposit";
            sectionTitle = "📥 Deposit Flow Prompts";
            sectionButtons = [
              [{ text: "💰 Start Message", callback_data: "edit_key_deposit_start_msg" }],
              [{ text: "📞 Support Username/Text", callback_data: "edit_key_support_text" }],
              [{ text: "✅ Success Message", callback_data: "edit_key_deposit_success_msg" }],
              [{ text: "🎉 Approved Message", callback_data: "edit_key_deposit_approved_msg" }],
              [{ text: "❌ Declined Message", callback_data: "edit_key_deposit_declined_msg" }],
              [{ text: "🔙 Back", callback_data: "control_edit" }]
            ];
          } else if (key === "referral_msg" || key === "referral_image" || key === "referral_share_text") {
            section = "edit_section_referral";
            sectionTitle = "🤝 Referral Prompt Settings";
            sectionButtons = [
              [{ text: "📝 Referral Message Text", callback_data: "edit_key_referral_msg" }],
              [{ text: "🖼️ Referral Image", callback_data: "edit_key_referral_image" }],
              [{ text: "📤 Referral Share Text", callback_data: "edit_key_referral_share_text" }],
              [{ text: "🔘 Referral Buttons Menu", callback_data: "edit_section_referral_buttons" }],
              [{ text: "🔙 Back", callback_data: "control_edit" }]
            ];
          } else if (key.startsWith("welcome") || key === "support_card_msg") {
            section = "edit_section_welcome";
            sectionTitle = "👋 Welcome & Support Prompts";
            sectionButtons = [
              [{ text: "👋 Welcome Message (Registered)", callback_data: "edit_key_welcome_msg" }],
              [{ text: "👋 Guest Welcome Message (Unregistered)", callback_data: "edit_key_welcome_guest_msg" }],
              [{ text: "📞 Support Card Message", callback_data: "edit_key_support_card_msg" }],
              [{ text: "🔙 Back", callback_data: "control_edit" }]
            ];
          }

          await bot.sendMessage(chatId, `<b>${sectionTitle}</b>\nSelect which prompt or instruction you want to edit:`, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: sectionButtons
            }
          });
          return;
        }
      } catch (err: any) {
        logBot(`Error updating prompt value: ${err.message}`);
        await bot.sendMessage(chatId, `❌ <b>Failed to save prompt:</b> ${err.message}`, { parse_mode: "HTML" });
        return;
      }
    }

    // Process admin broadcast interactive states
    if (numUserId && adminChatIds.has(numUserId)) {
      const bcastState = broadcastStates.get(numUserId);
      if (bcastState) {
        // Step 1: Awaiting text message
        if (bcastState.step === 'awaiting_text') {
          if (!text) {
            return bot.sendMessage(chatId, "⚠️ <b>Please send a valid text message for the broadcast.</b>", { parse_mode: "HTML" });
          }
          bcastState.textMessage = text;
          bcastState.step = 'review';
          await showBroadcastReview(bot, chatId, numUserId, bcastState);
          return;
        }

        // Step 2: Awaiting photo message
        if (bcastState.step === 'awaiting_photo') {
          if (msg.photo && msg.photo.length > 0) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            bcastState.photoFileId = fileId;
            
            // Determine next step based on type and if caption is present
            if (bcastState.type === 'photo_button') {
              if (msg.caption) bcastState.textMessage = msg.caption;
              
              // Proceed to buttons management, or prompt for caption if none
              if (!msg.caption) {
                bcastState.step = 'awaiting_caption';
                return bot.sendMessage(chatId, `🖼️ <b>Photo received!</b>\n\nNow, please enter the <b>Caption/Text message</b> (or send <code>none</code> for no caption):`, { parse_mode: "HTML" });
              } else {
                bcastState.step = 'choose_target'; // Temporarily set step
                const msgSent = await bot.sendMessage(chatId, `⌛ Loading...`);
                await renderButtonsManager(bot, chatId, msgSent.message_id, bcastState);
                return;
              }
            } else {
              // Standard Photo flow
              if (msg.caption) {
                bcastState.textMessage = msg.caption;
                bcastState.step = 'review';
                await showBroadcastReview(bot, chatId, numUserId, bcastState);
              } else {
                bcastState.step = 'awaiting_caption';
                return bot.sendMessage(chatId, `🖼️ <b>Photo received successfully!</b>\n\nNow, please enter the <b>Caption/Text message</b> to go with this photo, or send <code>none</code> if you don't want a caption:`, { parse_mode: "HTML" });
              }
            }
          } else {
            return bot.sendMessage(chatId, "⚠️ <b>Please upload or send an actual Photo/Image for this broadcast.</b>\n\nIf you want to cancel, please type <code>/cancel</code>.", { parse_mode: "HTML" });
          }
          return;
        }

        // Step 3: Awaiting caption message
        if (bcastState.step === 'awaiting_caption') {
          if (text.toLowerCase() === 'none') {
            bcastState.textMessage = undefined;
          } else {
            if (!text) {
              return bot.sendMessage(chatId, "⚠️ <b>Please send a valid caption or write <code>none</code>.</b>", { parse_mode: "HTML" });
            }
            bcastState.textMessage = text;
          }
          
          if (bcastState.type === 'photo_button') {
            bcastState.step = 'choose_target'; // Temporarily set step
            const msg = await bot.sendMessage(chatId, `⌛ Loading...`);
            await renderButtonsManager(bot, chatId, msg.message_id, bcastState);
          } else {
            bcastState.step = 'review';
            await showBroadcastReview(bot, chatId, numUserId, bcastState);
          }
          return;
        }

        // Step 4: Awaiting custom header
        if (bcastState.step === 'awaiting_custom_header') {
          if (text.toLowerCase() === 'none') {
            bcastState.customHeader = undefined;
          } else {
            bcastState.customHeader = text;
          }
          bcastState.step = 'choose_target';
          await bot.sendMessage(chatId, `✅ <b>Custom Header Updated!</b>`, { parse_mode: "HTML" });
          const msg = await bot.sendMessage(chatId, `⌛ Loading...`);
          await renderCustomDecorSelection(bot, chatId, msg.message_id, bcastState);
          return;
        }

        // Step 5: Awaiting custom footer
        if (bcastState.step === 'awaiting_custom_footer') {
          if (text.toLowerCase() === 'none') {
            bcastState.customFooter = undefined;
          } else {
            bcastState.customFooter = text;
          }
          bcastState.step = 'choose_target';
          await bot.sendMessage(chatId, `✅ <b>Custom Footer Updated!</b>`, { parse_mode: "HTML" });
          const msg = await bot.sendMessage(chatId, `⌛ Loading...`);
          await renderCustomDecorSelection(bot, chatId, msg.message_id, bcastState);
          return;
        }

        // Step 6: Awaiting custom button text
        if (bcastState.step === 'awaiting_btn_text') {
          if (text.length > 40) {
            return bot.sendMessage(chatId, `⚠️ <b>Button label is too long.</b> Please keep it under 40 characters:`, { parse_mode: "HTML" });
          }
          bcastState.tempButtonText = text;
          bcastState.step = 'awaiting_btn_url';
          await bot.sendMessage(chatId, `🎯 <b>Label received:</b> <code>"${text}"</code>\n\nNow, send the destination URL (e.g., <code>https://t.me/EthiopiaPlayChannel</code>). If you want this button to launch the Web App game directly, write <code>webapp</code>:`, { parse_mode: "HTML" });
          return;
        }

        // Step 7: Awaiting custom button URL
        if (bcastState.step === 'awaiting_btn_url') {
          let targetUrl = text.trim();
          
          if (targetUrl.toLowerCase() === 'webapp') {
            targetUrl = 'webapp';
          } else {
            // Basic validation: ensure it's a valid URL
            try {
              // If it doesn't have a protocol, try prepending https
              if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('tg://')) {
                const urlToTest = 'https://' + targetUrl;
                new URL(urlToTest); // Check if valid
                targetUrl = urlToTest;
              } else {
                new URL(targetUrl); // Check if valid
              }
            } catch (e) {
              return bot.sendMessage(chatId, `⚠️ <b>Invalid URL.</b> Please enter a valid URL starting with <code>http://</code>, <code>https://</code>, or <code>tg://</code>.`, { parse_mode: "HTML" });
            }
          }
          
          if (!bcastState.buttons) {
            bcastState.buttons = [];
          }
          bcastState.buttons.push({
            text: bcastState.tempButtonText || "Click Here",
            url: targetUrl
          });
          
          bcastState.tempButtonText = undefined;
          bcastState.step = 'choose_target';
          await bot.sendMessage(chatId, `✅ <b>Button Added Successfully!</b>`, { parse_mode: "HTML" });
          
          const msg = await bot.sendMessage(chatId, `⌛ Loading...`);
          await renderButtonsManager(bot, chatId, msg.message_id, bcastState);
          return;
        }
      }
    }

    // Process setadmin interactive states for the Owner
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
              // Update in DB safely
              supabase.from('users').update({ is_admin: true }).eq('id', targetId.toString()).then(({ error }) => {
                if (error && !error.message.includes('schema cache')) logBot(`Error updating admin status in DB for ${targetId}: ${error.message}`);
              });
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
              // Update in DB safely
              supabase.from('users').update({ is_admin: false }).eq('id', deleteTargetId.toString()).then(({ error }) => {
                if (error && !error.message.includes('schema cache')) logBot(`Error updating admin status in DB for ${deleteTargetId}: ${error.message}`);
              });
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

      const bk = promptsConfig.banks;
      return bot.sendMessage(chatId, "እባክዎት ማስገባት የሚፈልጉበትን ባንክ ይምረጡ።", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: bk["Telebirr"]?.name || "📱 Telebirr", callback_data: `dep_bank_Telebirr` },
              { text: bk["CBE"]?.name || "🏦 CBE (የኢትዮጵያ ንግድ ባንክ)", callback_data: `dep_bank_CBE` }
            ],
            [
              { text: bk["Abyssinia"]?.name || "🏦 Abyssinia Bank", callback_data: `dep_bank_Abyssinia` },
              { text: bk["Dashen"]?.name || "🏦 Dashen Bank", callback_data: `dep_bank_Dashen` }
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
        const bk = promptsConfig.banks;
        return bot.sendMessage(chatId, "እባክዎን የሚያወጡበትን ባንክ ይምረጡ።", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: bk["Telebirr"]?.name || "📱 Telebirr", callback_data: `wd_bank_Telebirr` },
                { text: bk["CBE"]?.name || "🏦 CBE (የኢትዮጵያ ንግድ ባንክ)", callback_data: `wd_bank_CBE` }
              ],
              [
                { text: bk["Abyssinia"]?.name || "🏦 Abyssinia Bank", callback_data: `wd_bank_Abyssinia` },
                { text: bk["Dashen"]?.name || "🏦 Dashen Bank", callback_data: `wd_bank_Dashen` }
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
        const successMsgText = promptsConfig.withdraw_success_msg.replace(/{amount}/g, amount.toLocaleString());
        bot.sendMessage(chatId, successMsgText, { parse_mode: "Markdown" });

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

    // 5. WELCOME BUTTON: EDIT LABEL
    if (state.step === 'awaiting_wbtn_label_change') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const rIndex = state.row;
      const cIndex = state.col;
      if (rIndex !== undefined && cIndex !== undefined && promptsConfig.welcome_buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.welcome_buttons[rIndex][cIndex].text = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ <b>Successfully updated welcome button label to: "${text}"</b>`, { parse_mode: "HTML" });
        
        // Return to welcome buttons panel
        const buttons = promptsConfig.welcome_buttons || [];
        let pText = "🔘 <b>Welcome Buttons Editor</b>\n\nThese are the buttons shown below your Welcome Message for players:\n\n";
        const inlineKeyboard: any[] = [];
        buttons.forEach((row, rIdx) => {
          const rowButtons: any[] = [];
          row.forEach((btn, cIdx) => {
            pText += `• Row ${rIdx + 1}, Col ${cIdx + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
            rowButtons.push({
              text: `✏️ Row ${rIdx + 1} Col ${cIdx + 1}: ${btn.text}`,
              callback_data: `edit_wbtn_click_${rIdx}_${cIdx}`
            });
          });
          inlineKeyboard.push(rowButtons);
        });
        inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_wbtn_add" }]);
        inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
        await bot.sendMessage(chatId, pText, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
      }
      return;
    }

    // 6. WELCOME BUTTON: EDIT URL
    if (state.step === 'awaiting_wbtn_url_change') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const rIndex = state.row;
      const cIndex = state.col;
      if (rIndex !== undefined && cIndex !== undefined && promptsConfig.welcome_buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.welcome_buttons[rIndex][cIndex].type = 'url';
        promptsConfig.welcome_buttons[rIndex][cIndex].value = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ <b>Successfully updated button link URL to: "${text}"</b>`, { parse_mode: "HTML" });
        
        // Return to welcome buttons panel
        const buttons = promptsConfig.welcome_buttons || [];
        let pText = "🔘 <b>Welcome Buttons Editor</b>\n\nThese are the buttons shown below your Welcome Message for players:\n\n";
        const inlineKeyboard: any[] = [];
        buttons.forEach((row, rIdx) => {
          const rowButtons: any[] = [];
          row.forEach((btn, cIdx) => {
            pText += `• Row ${rIdx + 1}, Col ${cIdx + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
            rowButtons.push({
              text: `✏️ Row ${rIdx + 1} Col ${cIdx + 1}: ${btn.text}`,
              callback_data: `edit_wbtn_click_${rIdx}_${cIdx}`
            });
          });
          inlineKeyboard.push(rowButtons);
        });
        inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_wbtn_add" }]);
        inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
        await bot.sendMessage(chatId, pText, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
      }
      return;
    }

    // 7. WELCOME BUTTON: ADD LABEL
    if (state.step === 'awaiting_wbtn_add_label') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      userStates.set(userId, {
        step: 'idle',
        new_label: text
      });
      const choiceText = `🔧 <b>Select Button Type for "${text}":</b>\n\nChoose what this button should do when clicked:`;
      const keyboard = {
        inline_keyboard: [
          [{ text: "🎮 Play WebApp Game", callback_data: `add_wbtn_type_webapp` }],
          [{ text: "💳 Callback Deposit Flow", callback_data: `add_wbtn_type_cb_dep` }],
          [{ text: "🏦 Callback Withdraw Flow", callback_data: `add_wbtn_type_cb_wd` }],
          [{ text: "📞 Callback Support Flow", callback_data: `add_wbtn_type_cb_sup` }],
          [{ text: "🔗 Custom URL Link", callback_data: `add_wbtn_type_url` }],
          [{ text: "🔙 Cancel", callback_data: `edit_section_welcome_buttons` }]
        ]
      };
      await bot.sendMessage(chatId, choiceText, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    }

    // 8. WELCOME BUTTON: ADD URL
    if (state.step === 'awaiting_wbtn_add_url') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const label = state.new_label || "New Button";
      if (!promptsConfig.welcome_buttons) promptsConfig.welcome_buttons = [];
      promptsConfig.welcome_buttons.push([{ text: label, type: 'url', value: text }]);
      savePromptsConfig(promptsConfig);
      userStates.set(userId, { step: 'idle' });
      await bot.sendMessage(chatId, `✅ <b>Successfully added new button with URL!</b>`, { parse_mode: "HTML" });
      
      // Return to welcome buttons panel
      const buttons = promptsConfig.welcome_buttons || [];
      let pText = "🔘 <b>Welcome Buttons Editor</b>\n\nThese are the buttons shown below your Welcome Message for players:\n\n";
      const inlineKeyboard: any[] = [];
      buttons.forEach((row, rIdx) => {
        const rowButtons: any[] = [];
        row.forEach((btn, cIdx) => {
          pText += `• Row ${rIdx + 1}, Col ${cIdx + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
          rowButtons.push({
            text: `✏️ Row ${rIdx + 1} Col ${cIdx + 1}: ${btn.text}`,
            callback_data: `edit_wbtn_click_${rIdx}_${cIdx}`
          });
        });
        inlineKeyboard.push(rowButtons);
      });
      inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_wbtn_add" }]);
      inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
      await bot.sendMessage(chatId, pText, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
      return;
    }

    // 9. CUSTOM COMMAND: REGISTER NAME
    if (state.step === 'awaiting_ccmd_name') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const cmdName = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!cmdName) {
        return bot.sendMessage(chatId, "❌ <b>Invalid command name.</b> Please send a single word with lowercase letters/numbers only:");
      }
      if (promptsConfig.custom_commands?.[cmdName] || ['start', 'play', 'deposit', 'withdraw', 'support', 'language', 'cancel'].includes(cmdName)) {
        return bot.sendMessage(chatId, `❌ Command name <b>/${cmdName}</b> is already taken or reserved. Please enter a different command name:`, { parse_mode: "HTML" });
      }

      if (!promptsConfig.custom_commands) promptsConfig.custom_commands = {};
      promptsConfig.custom_commands[cmdName] = {
        command: cmdName,
        description: "Custom dynamic command",
        text: "Default response text. Please edit this message.",
        buttons: []
      };
      savePromptsConfig(promptsConfig);

      // Register with telegram bot commands menu
      try {
        const systemCommands = [
          { command: "start", description: "Launch the game hub and display menu" },
          { command: "play", description: "Launch the Web App immediately" },
          { command: "deposit", description: "Deposit ETB into your balance" },
          { command: "withdraw", description: "Withdraw ETB from your balance" },
          { command: "support", description: "Show contact support details" },
          { command: "language", description: "Change bot language" },
          { command: "cancel", description: "Cancel current operation or active flows" }
        ];

        const customCommandsList = Object.entries(promptsConfig.custom_commands || {}).map(([cmd, cfg]) => ({
          command: cmd,
          description: cfg.description || "Custom command"
        }));

        await bot.setMyCommands([...systemCommands, ...customCommandsList]);
      } catch (err: any) {
        logBot(`Failed to set Telegram commands: ${err.message}`);
      }

      userStates.set(userId, { step: 'idle' });
      await bot.sendMessage(chatId, `✅ Successfully registered command <b>/${cmdName}</b>!`, { parse_mode: "HTML" });
      await sendCustomCommandEditMenu(chatId, cmdName);
      return;
    }

    // 10. CUSTOM COMMAND: VAL CHANGE
    if (state.step === 'awaiting_ccmd_val_change') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const cmdName = state.cmd_name;
      const field = state.field;
      if (cmdName && field && promptsConfig.custom_commands?.[cmdName]) {
        if (field === 'text') {
          promptsConfig.custom_commands[cmdName].text = text;
        } else if (field === 'desc') {
          promptsConfig.custom_commands[cmdName].description = text;
          
          // Re-sync command menu so description is immediately updated
          try {
            const systemCommands = [
              { command: "start", description: "Launch the game hub and display menu" },
              { command: "play", description: "Launch the Web App immediately" },
              { command: "deposit", description: "Deposit ETB into your balance" },
              { command: "withdraw", description: "Withdraw ETB from your balance" },
              { command: "support", description: "Show contact support details" },
              { command: "language", description: "Change bot language" },
              { command: "cancel", description: "Cancel current operation or active flows" }
            ];

            const customCommandsList = Object.entries(promptsConfig.custom_commands || {}).map(([cmd, cfg]) => ({
              command: cmd,
              description: cfg.description || "Custom command"
            }));

            await bot.setMyCommands([...systemCommands, ...customCommandsList]);
          } catch (err: any) {}
        } else if (field === 'photo') {
          let photoVal = text;
          if (msg.photo && msg.photo.length > 0) {
            photoVal = msg.photo[msg.photo.length - 1].file_id;
          }
          promptsConfig.custom_commands[cmdName].photo = photoVal;
        }
        
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Updated <b>/${cmdName}</b> property <b>"${field}"</b>!`, { parse_mode: "HTML" });
        await sendCustomCommandEditMenu(chatId, cmdName);
      }
      return;
    }

    // 11. CUSTOM COMMAND BUTTON: EDIT LABEL
    if (state.step === 'awaiting_cc_btn_label_change') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const cmdName = state.cmd_name;
      const rIndex = state.row;
      const cIndex = state.col;
      if (cmdName && rIndex !== undefined && cIndex !== undefined && promptsConfig.custom_commands?.[cmdName]?.buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.custom_commands[cmdName].buttons[rIndex][cIndex].text = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully updated button label!`, { parse_mode: "HTML" });
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      }
      return;
    }

    // 12. CUSTOM COMMAND BUTTON: ADD LABEL
    if (state.step === 'awaiting_cc_btn_add_label') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const cmdName = state.cmd_name;
      if (cmdName) {
        userStates.set(userId, {
          step: 'idle',
          cmd_name: cmdName,
          new_label: text
        });
        const choiceText = `🔧 <b>Select Button Type for "${text}":</b>\n\nChoose what this button should do when clicked:`;
        const keyboard = {
          inline_keyboard: [
            [{ text: "🎮 Play WebApp Game", callback_data: `cc_add_type_${cmdName}_webapp` }],
            [{ text: "💳 Callback Deposit Flow", callback_data: `cc_add_type_${cmdName}_cb_dep` }],
            [{ text: "🏦 Callback Withdraw Flow", callback_data: `cc_add_type_${cmdName}_cb_wd` }],
            [{ text: "📞 Callback Support Flow", callback_data: `cc_add_type_${cmdName}_cb_sup` }],
            [{ text: "🔗 Custom URL Link", callback_data: `cc_add_type_${cmdName}_url` }],
            [{ text: "🔙 Cancel", callback_data: `ccmd_val_${cmdName}_buttons` }]
          ]
        };
        await bot.sendMessage(chatId, choiceText, { parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    // 13. CUSTOM COMMAND BUTTON: ADD URL
    if (state.step === 'awaiting_cc_btn_add_url') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const cmdName = state.cmd_name;
      const label = state.new_label || "New Button";
      if (cmdName && promptsConfig.custom_commands?.[cmdName]) {
        if (!promptsConfig.custom_commands[cmdName].buttons) {
          promptsConfig.custom_commands[cmdName].buttons = [];
        }
        promptsConfig.custom_commands[cmdName].buttons.push([{ text: label, type: 'url', value: text }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}" with URL!`, { parse_mode: "HTML" });
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      }
      return;
    }

    // 14. REFERRAL BUTTON: EDIT LABEL
    if (state.step === 'awaiting_refbtn_label_change') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const rIndex = state.row;
      const cIndex = state.col;
      if (rIndex !== undefined && cIndex !== undefined && promptsConfig.referral_buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.referral_buttons[rIndex][cIndex].text = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully updated referral button label to <b>"${text}"</b>!`, { parse_mode: "HTML" });
        await bot.sendMessage(chatId, "🤝 <b>Referral Buttons Editor</b>", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons Panel", callback_data: "edit_section_referral_buttons" }]]
          }
        });
      }
      return;
    }

    // 15. REFERRAL BUTTON: EDIT URL
    if (state.step === 'awaiting_refbtn_url_change') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const rIndex = state.row;
      const cIndex = state.col;
      if (rIndex !== undefined && cIndex !== undefined && promptsConfig.referral_buttons?.[rIndex]?.[cIndex]) {
        promptsConfig.referral_buttons[rIndex][cIndex].value = text;
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully updated referral button share URL to <code>${text}</code>!`, { parse_mode: "HTML" });
        await bot.sendMessage(chatId, "🤝 <b>Referral Buttons Editor</b>", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons Panel", callback_data: "edit_section_referral_buttons" }]]
          }
        });
      }
      return;
    }

    // 16. REFERRAL BUTTON: ADD LABEL
    if (state.step === 'awaiting_refbtn_add_label') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      userStates.set(userId, {
        ...state,
        step: 'awaiting_refbtn_add_url',
        new_label: text
      });
      await bot.sendMessage(chatId, `✍️ <b>Now enter the share URL link for "${text}":</b>\n\nExample: <code>https://t.me/share/url?url=https://t.me/{bot_username}?start={user_id}&text=Join now!</code>`, { parse_mode: "HTML" });
      return;
    }

    // 17. REFERRAL BUTTON: ADD URL
    if (state.step === 'awaiting_refbtn_add_url') {
      if (!numUserId || !adminChatIds.has(numUserId)) return;
      const label = state.new_label || "New Button";
      if (!promptsConfig.referral_buttons) promptsConfig.referral_buttons = [];
      promptsConfig.referral_buttons.push([{ text: label, type: 'url', value: text }]);
      savePromptsConfig(promptsConfig);
      userStates.set(userId, { step: 'idle' });
      await bot.sendMessage(chatId, `✅ Successfully added new referral button <b>"${label}"</b>!`, { parse_mode: "HTML" });
      await bot.sendMessage(chatId, "🤝 <b>Referral Buttons Panel</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_referral_buttons" }]]
        }
      });
      return;
    }
  });

  // --- CONTACT REGISTER HANDLER ---
  bot.on("contact", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const contact = msg.contact;

    if (!userId || !contact) return;

    // Validate that the shared contact is actually their own
    if (contact.user_id && contact.user_id.toString() !== userId) {
      return bot.sendMessage(chatId, "⚠️ <b>Validation Error:</b> Please share your own contact to register.", { parse_mode: "HTML" });
    }

    const username = msg.from?.username || "";
    const firstName = msg.from?.first_name || "";
    const lastName = msg.from?.last_name || "";
    const phoneNumber = contact.phone_number;

    // Fetch profile picture if available
    let photoUrl = "";
    try {
      const photosRes = await bot.getUserProfilePhotos(msg.from.id, { limit: 1 });
      if (photosRes && photosRes.total_count > 0 && photosRes.photos.length > 0) {
        const fileId = photosRes.photos[0][0].file_id;
        const file = await bot.getFile(fileId);
        if (file && file.file_path) {
          photoUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        }
      }
    } catch (photoErr: any) {
      logBot(`Failed to fetch profile photo for user ${msg.from.id}: ${photoErr.message}`);
    }

    try {
      // Create user record in Supabase
      const upsertData: any = {
        id: userId,
        username: username || null,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phoneNumber || null,
        photo_url: photoUrl || null,
        balance: 100000 // Starting balance
      };

      let { data: insertedUser, error: insertError } = await supabase
        .from('users')
        .upsert(upsertData, { onConflict: 'id' })
        .select()
        .single();

      // If the schema cache is missing the 'phone' column, retry without the 'phone' column
      if (insertError && (insertError.message.includes("phone") || insertError.message.includes("schema cache"))) {
        logBot(`User registration: database 'phone' column is not yet activated. Registering user without saving phone number.`);
        delete upsertData.phone;
        const retryRes = await supabase
          .from('users')
          .upsert(upsertData, { onConflict: 'id' })
          .select()
          .single();
        insertedUser = retryRes.data;
        insertError = retryRes.error;
      }

      if (insertError) {
        logBot(`Error inserting new user ${userId}: ${insertError.message}`);
        return bot.sendMessage(chatId, "❌ <b>Database error:</b> Could not complete registration. Please try again or contact support.", { parse_mode: "HTML" });
      }

      // Remove the custom contact keyboard
      await bot.sendMessage(chatId, "✅ <b>Contact verified successfully!</b>", {
        parse_mode: "HTML",
        reply_markup: {
          remove_keyboard: true
        }
      });

      // Show warm greeting and all commands with inline menu buttons
      const welcomeMsgPattern = promptsConfig.welcome_msg || 
        `👋 *Welcome to ETB Game Hub, {name}!* 🎮\n\n` +
        `Experience the thrill of real-time multiplayer gaming right here in Telegram!\n\n` +
        `💰 *Your current balance:* \`{balance}\`\n\n` +
        `🚀 *Available Games:*\n` +
        `• 🟢 *Even/Odd* - High-octane multipliers and double-ups\n` +
        `• 🏆 *Jackpot Arena* - Secure spots and sweep the pool prize\n` +
        `• 🎡 *Wheel of Chance* - High stakes wheel of fortune\n\n` +
        `👇 Click the button below to launch the Mini App and start playing immediately!`;
        
      const greetingMsg = welcomeMsgPattern
        .replace(/{name}/g, firstName)
        .replace(/{balance}/g, "100,000 ETB");

      const welcomeButtonsRows = (promptsConfig.welcome_buttons || [
        [
          { text: "🎮 Play Game Hub 🚀", type: "webapp", value: "appUrl" }
        ],
        [
          { text: "💸 Deposit / ማስገቢያ", type: "callback", value: "menu_deposit" },
          { text: "🏦 Withdraw / ማውጫ", type: "callback", value: "menu_withdraw" }
        ],
        [
          { text: "📞 Contact Support", type: "callback", value: "menu_support" }
        ]
      ]).map(row => 
        row.map(btn => {
          const btnVal = btn.value === 'appUrl' ? appUrl : btn.value;
          if (btn.type === 'webapp') {
            return { text: btn.text, web_app: { url: btnVal } };
          } else if (btn.type === 'url') {
            return { text: btn.text, url: btnVal };
          } else {
            return { text: btn.text, callback_data: btnVal };
          }
        })
      );

      await bot.sendMessage(chatId, greetingMsg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: welcomeButtonsRows
        }
      });

      // Process pending deep link payload if any
      const pendingReg = pendingRegistrations.get(userId);
      if (pendingReg && pendingReg.payload) {
        if (pendingReg.payload === 'deposit') {
          startDepositFlow(chatId, userId);
        } else if (pendingReg.payload === 'withdraw') {
          startWithdrawalFlow(chatId, userId);
        }
      }
      pendingRegistrations.delete(userId);

    } catch (err: any) {
      logBot(`Unexpected error during user registration for ${userId}: ${err.message}`);
      bot.sendMessage(chatId, "❌ An unexpected error occurred. Please try again.", { parse_mode: "HTML" });
    }
  });

  // --- CALLBACK QUERY DISPATCHER ---
  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id || query.from.id;
    const messageId = query.message?.message_id;
    const userId = query.from.id.toString();
    const data = query.data;

    if (data?.startsWith("analysis_")) {
      const timeframe = data.split("_")[1] as 'day' | 'week' | 'month' | 'year';
      try {
        await bot.answerCallbackQuery(query.id);
        const summary = await getAnalysisSummary(timeframe);
        const gamesStats = Object.entries(summary.gamesCount).map(([game, count]) => `${game}: ${count}`).join('\n');
        const text = `📊 <b>Financial Summary (${timeframe.toUpperCase()})</b>\n\n` +
          `💰 Total Deposits: ${summary.totalDeposits}\n` +
          `💸 Total Withdrawals: ${summary.totalWithdrawals}\n` +
          `📈 Total Revenue: ${summary.totalRevenue}\n` +
          `✅ Net Profit: ${summary.netProfit}\n\n` +
          `🎮 <b>Games Played:</b>\n${gamesStats || 'No games played'}`;
        
        if (messageId) {
          await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📅 Day", callback_data: "analysis_day" },
                  { text: "🗓️ Week", callback_data: "analysis_week" }
                ],
                [
                  { text: "📆 Month", callback_data: "analysis_month" },
                  { text: "📅 Year", callback_data: "analysis_year" }
                ]
              ]
            }
          });
        }
      } catch (e) {
        await bot.answerCallbackQuery(query.id, { text: "Error fetching data", show_alert: true });
      }
      return;
    }

    if (data === "control_setadmin") {
      await bot.answerCallbackQuery(query.id);
      renderSetAdminMenu(bot, chatId);
      return;
    }
    if (data === "control_analysis") {
      await bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, "📊 <b>Select Timeframe:</b>", {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📅 Day", callback_data: "analysis_day" },
              { text: "🗓️ Week", callback_data: "analysis_week" }
            ],
            [
              { text: "📆 Month", callback_data: "analysis_month" },
              { text: "📅 Year", callback_data: "analysis_year" }
            ]
          ]
        }
      });
      return;
    }
    if (data === "control_broadcast") {
      await bot.answerCallbackQuery(query.id);
      const composer = { step: 'choose_target' as const };
      await renderBroadcastDashboard(bot, chatId, userId, composer);
      return;
    }

    if (data === "control_edit") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      sendEditPanelMenu(chatId, messageId);
      return;
    }

    if (data === "edit_section_deposit") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "📥 <b>Deposit Flow Prompts</b>\nSelect which prompt or instruction you want to edit:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "💰 Start Message", callback_data: "edit_key_deposit_start_msg" }],
          [{ text: "📞 Support Username/Text", callback_data: "edit_key_support_text" }],
          [{ text: "✅ Success Message", callback_data: "edit_key_deposit_success_msg" }],
          [{ text: "🎉 Approved Message", callback_data: "edit_key_deposit_approved_msg" }],
          [{ text: "❌ Declined Message", callback_data: "edit_key_deposit_declined_msg" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_withdrawal") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "📤 <b>Withdrawal Flow Prompts</b>\nSelect which prompt or notification you want to edit:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "💰 Start Message", callback_data: "edit_key_withdraw_start_msg" }],
          [{ text: "📱 Telebirr Phone Prompt", callback_data: "edit_key_withdraw_telebirr_prompt" }],
          [{ text: "🏦 Other Bank Account Prompt", callback_data: "edit_key_withdraw_other_bank_prompt" }],
          [{ text: "✅ Success Message", callback_data: "edit_key_withdraw_success_msg" }],
          [{ text: "🎉 Approved Message", callback_data: "edit_key_withdraw_approved_msg" }],
          [{ text: "❌ Declined Message", callback_data: "edit_key_withdraw_declined_msg" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_banks") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "🏦 <b>Bank Accounts Detail</b>\nSelect which bank's account details/display name you want to edit:";
      const bk = promptsConfig.banks;
      const keyboard = {
        inline_keyboard: [
          [{ text: bk["Telebirr"]?.name || "📱 Telebirr", callback_data: "edit_bank_Telebirr" }],
          [{ text: bk["CBE"]?.name || "🏦 CBE", callback_data: "edit_bank_CBE" }],
          [{ text: bk["Abyssinia"]?.name || "🏦 Abyssinia Bank", callback_data: "edit_bank_Abyssinia" }],
          [{ text: bk["Dashen"]?.name || "🏦 Dashen Bank", callback_data: "edit_bank_Dashen" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_welcome") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "👋 <b>Welcome & Support Prompts</b>\nSelect which welcome or support prompt you want to edit:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "👋 Welcome Message (Registered)", callback_data: "edit_key_welcome_msg" }],
          [{ text: "🖼️ Welcome Image (Registered)", callback_data: "edit_key_welcome_image" }],
          [{ text: "👋 Guest Welcome Message (Unregistered)", callback_data: "edit_key_welcome_guest_msg" }],
          [{ text: "🖼️ Guest Welcome Image (Unregistered)", callback_data: "edit_key_welcome_guest_image" }],
          [{ text: "📞 Support Card Message", callback_data: "edit_key_support_card_msg" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_welcome_buttons") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const buttons = promptsConfig.welcome_buttons || [];
      let text = "🔘 <b>Welcome Buttons Editor</b>\n\n" +
        "These are the buttons shown below your Welcome Message for players:\n\n";
      
      const inlineKeyboard: any[] = [];
      
      if (buttons.length === 0) {
        text += "<i>No welcome buttons configured currently. Players won't see any buttons.</i>";
      } else {
        buttons.forEach((row, rIndex) => {
          const rowButtons: any[] = [];
          row.forEach((btn, cIndex) => {
            text += `• Row ${rIndex + 1}, Col ${cIndex + 1}: <b>"${btn.text}"</b> (Type: <code>${btn.type}</code>)\n`;
            rowButtons.push({
              text: `✏️ Row ${rIndex + 1} Col ${cIndex + 1}: ${btn.text}`,
              callback_data: `edit_wbtn_click_${rIndex}_${cIndex}`
            });
          });
          inlineKeyboard.push(rowButtons);
        });
      }
      
      inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_wbtn_add" }]);
      inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
      
      if (messageId) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }
      return;
    }

    if (data === "edit_section_referral") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const text = "🤝 <b>Referral Prompt Settings</b>\nSelect which aspect you want to customize:";
      const keyboard = {
        inline_keyboard: [
          [{ text: "📝 Referral Message Text", callback_data: "edit_key_referral_msg" }],
          [{ text: "🖼️ Referral Image", callback_data: "edit_key_referral_image" }],
          [{ text: "📤 Referral Share Text", callback_data: "edit_key_referral_share_text" }],
          [{ text: "🖼️ Referral Share Image", callback_data: "edit_key_referral_share_image" }],
          [{ text: "🔘 Referral Buttons Menu", callback_data: "edit_section_referral_buttons" }],
          [{ text: "🔙 Back", callback_data: "control_edit" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data === "edit_section_referral_buttons") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const buttons = promptsConfig.referral_buttons || [];
      let text = "🔘 <b>Referral Buttons Editor</b>\n\nThese are the buttons shown below your Referral Message for players:\n\n";
      const inlineKeyboard: any[] = [];
      
      buttons.forEach((row, rIndex) => {
        const rowButtons: any[] = [];
        row.forEach((btn, cIndex) => {
          text += `• Row ${rIndex + 1}, Col ${cIndex + 1}: <b>"${btn.text}"</b>\n`;
          rowButtons.push({
            text: `✏️ Row ${rIndex + 1} Col ${cIndex + 1}: ${btn.text}`,
            callback_data: `edit_refbtn_click_${rIndex}_${cIndex}`
          });
        });
        inlineKeyboard.push(rowButtons);
      });
      
      inlineKeyboard.push([{ text: "➕ Add New Button", callback_data: "edit_refbtn_add" }]);
      inlineKeyboard.push([{ text: "🔙 Back to Referral", callback_data: "edit_section_referral" }]);
      
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
      }
      return;
    }

    if (data === "control_back") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderMainControlPanel(chatId, messageId);
      return;
    }
    if (data === "control_links") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      renderCommandLinks(chatId, messageId);
      return;
    }

    if (data.startsWith("edit_wbtn_click_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_wbtn_click_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      
      const btn = promptsConfig.welcome_buttons?.[rIndex]?.[cIndex];
      if (!btn) {
        return bot.sendMessage(chatId, "❌ Button not found.");
      }
      
      const text = `🔘 <b>Editing Welcome Button</b>\n\n` +
        `• <b>Label:</b> <code>${btn.text}</code>\n` +
        `• <b>Type:</b> <code>${btn.type}</code>\n` +
        `• <b>Target Value:</b> <code>${btn.value}</code>\n\n` +
        `Select an action:`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "✏️ Edit Button Label", callback_data: `edit_wbtn_label_${rIndex}_${cIndex}` }],
          [{ text: "🔧 Edit Button Type & Destination", callback_data: `edit_wbtn_dest_${rIndex}_${cIndex}` }],
          [{ text: "❌ Delete Button", callback_data: `edit_wbtn_del_${rIndex}_${cIndex}` }],
          [{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]
        ]
      };
      
      if (messageId) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: keyboard
        });
      }
      return;
    }

    if (data.startsWith("edit_wbtn_label_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_wbtn_label_", "").split("_");
      const rIndex = parts[0];
      const cIndex = parts[1];
      
      userStates.set(userId, {
        step: 'awaiting_wbtn_label_change',
        row: parseInt(rIndex, 10),
        col: parseInt(cIndex, 10)
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter new label/text for the button:</b>\n\nType the text and send it directly.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("edit_wbtn_dest_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_wbtn_dest_", "").split("_");
      const rIndex = parts[0];
      const cIndex = parts[1];
      
      const text = `🔧 <b>Select Button Type:</b>\n\n` +
        `• <b>Play WebApp:</b> Launches your gaming app.\n` +
        `• <b>Callback action:</b> Triggers built-in flows (e.g. <code>menu_deposit</code>, <code>menu_withdraw</code>, <code>menu_support</code>).\n` +
        `• <b>Custom URL:</b> Redirects player to any custom link or channel.`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "🎮 Play WebApp Game", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_webapp` }],
          [{ text: "💳 Callback Deposit Flow", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_cb_dep` }],
          [{ text: "🏦 Callback Withdraw Flow", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_cb_wd` }],
          [{ text: "📞 Callback Support Flow", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_cb_sup` }],
          [{ text: "🔗 Custom URL Link", callback_data: `set_wbtn_type_${rIndex}_${cIndex}_url` }],
          [{ text: "🔙 Cancel", callback_data: `edit_wbtn_click_${rIndex}_${cIndex}` }]
        ]
      };
      
      if (messageId) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: keyboard
        });
      }
      return;
    }

    if (data.startsWith("set_wbtn_type_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("set_wbtn_type_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      const actionType = parts[2];
      
      if (!promptsConfig.welcome_buttons) promptsConfig.welcome_buttons = [];
      const btn = promptsConfig.welcome_buttons?.[rIndex]?.[cIndex];
      if (!btn) return;
      
      if (actionType === 'webapp') {
        btn.type = 'webapp';
        btn.value = 'appUrl';
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Welcome button updated to launch WebApp Game!`);
        await bot.sendMessage(chatId, `🔘 <b>Welcome Button Editor</b>\nUpdated!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (actionType === 'cb_dep') {
        btn.type = 'callback';
        btn.value = 'menu_deposit';
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Welcome button updated to trigger Deposit Flow!`);
        await bot.sendMessage(chatId, `🔘 <b>Welcome Button Editor</b>\nUpdated!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (actionType === 'cb_wd') {
        btn.type = 'callback';
        btn.value = 'menu_withdraw';
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Welcome button updated to trigger Withdraw Flow!`);
        await bot.sendMessage(chatId, `🔘 <b>Welcome Button Editor</b>\nUpdated!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (actionType === 'cb_sup') {
        btn.type = 'callback';
        btn.value = 'menu_support';
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Welcome button updated to trigger Support Flow!`);
        await bot.sendMessage(chatId, `🔘 <b>Welcome Button Editor</b>\nUpdated!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (actionType === 'url') {
        userStates.set(userId, {
          step: 'awaiting_wbtn_url_change',
          row: rIndex,
          col: cIndex
        });
        await bot.sendMessage(chatId, `✍️ <b>Please send the destination URL link:</b>\n\nExample: <code>https://t.me/EthiopiaPlayChannel</code>`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data.startsWith("edit_wbtn_del_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_wbtn_del_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      
      if (promptsConfig.welcome_buttons?.[rIndex]) {
        promptsConfig.welcome_buttons[rIndex].splice(cIndex, 1);
        if (promptsConfig.welcome_buttons[rIndex].length === 0) {
          promptsConfig.welcome_buttons.splice(rIndex, 1);
        }
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, "✅ Welcome button deleted successfully!");
      }
      
      const text = "👋 <b>Welcome Buttons Main Editor</b>";
      await bot.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Buttons Panel", callback_data: "edit_section_welcome_buttons" }]]
        }
      });
      return;
    }

    if (data === "edit_wbtn_add") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      userStates.set(userId, {
        step: 'awaiting_wbtn_add_label'
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter label/text for the new button:</b>\n\nType the text (e.g. <code>🎁 Free Bonus</code>) and send it directly.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("add_wbtn_type_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const type = data.replace("add_wbtn_type_", "");
      const state = userStates.get(userId);
      const label = state?.new_label || "New Button";
      
      if (!promptsConfig.welcome_buttons) promptsConfig.welcome_buttons = [];
      
      if (type === 'webapp') {
        promptsConfig.welcome_buttons.push([{ text: label, type: 'webapp', value: 'appUrl' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await bot.sendMessage(chatId, "🔘 Welcome Buttons Menu", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (type === 'cb_dep') {
        promptsConfig.welcome_buttons.push([{ text: label, type: 'callback', value: 'menu_deposit' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await bot.sendMessage(chatId, "🔘 Welcome Buttons Menu", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (type === 'cb_wd') {
        promptsConfig.welcome_buttons.push([{ text: label, type: 'callback', value: 'menu_withdraw' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await bot.sendMessage(chatId, "🔘 Welcome Buttons Menu", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (type === 'cb_sup') {
        promptsConfig.welcome_buttons.push([{ text: label, type: 'callback', value: 'menu_support' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await bot.sendMessage(chatId, "🔘 Welcome Buttons Menu", {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Buttons", callback_data: "edit_section_welcome_buttons" }]]
          }
        });
      } else if (type === 'url') {
        userStates.set(userId, {
          ...state,
          step: 'awaiting_wbtn_add_url'
        });
        await bot.sendMessage(chatId, `✍️ <b>Please send the destination URL link:</b>\n\nExample: <code>https://t.me/EthiopiaPlayChannel</code>`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data === "edit_section_custom_commands") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const cmds = promptsConfig.custom_commands || {};
      let text = "✨ <b>Custom Commands Manager</b>\n\n" +
        "You can define your own Telegram bot commands dynamically! These will appear in player suggestions and triggers custom texts, photos, or buttons.\n\n" +
        "<b>Current Custom Commands:</b>\n";
      
      const inlineKeyboard: any[] = [];
      const keys = Object.keys(cmds);
      
      if (keys.length === 0) {
        text += "<i>No custom commands registered yet.</i>";
      } else {
        keys.forEach((cmd) => {
          text += `• <b>/${cmd}</b> - <i>${cmds[cmd].description || 'No description'}</i>\n`;
          inlineKeyboard.push([{
            text: `🛠️ /${cmd}`,
            callback_data: `ccmd_edit_${cmd}`
          }]);
        });
      }
      
      inlineKeyboard.push([{ text: "➕ Create Dynamic Command", callback_data: "ccmd_create_start" }]);
      inlineKeyboard.push([{ text: "🔙 Back", callback_data: "control_edit" }]);
      
      if (messageId) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }
      return;
    }

    if (data === "ccmd_create_start") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      userStates.set(userId, {
        step: 'awaiting_ccmd_name'
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter your new command name</b> (lowercase, no space, no slash):\n\nExample: <code>rules</code>`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("ccmd_edit_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const cmdName = data.replace("ccmd_edit_", "");
      await sendCustomCommandEditMenu(chatId, cmdName, messageId);
      return;
    }

    if (data.startsWith("ccmd_val_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const clean = data.replace("ccmd_val_", "");
      const parts = clean.split("_");
      const cmdName = parts[0];
      const action = parts.slice(1).join("_");
      
      if (action === "text" || action === "desc" || action === "photo") {
        userStates.set(userId, {
          step: 'awaiting_ccmd_val_change',
          cmd_name: cmdName,
          field: action
        });
        
        const label = action === "text" ? "response message text" : (action === "desc" ? "menu helper description" : "photo File ID or direct image URL");
        await bot.sendMessage(chatId, `✍️ <b>Please send the new ${label} for /${cmdName}:</b>`, { parse_mode: "HTML" });
      } else if (action === "photo_clear") {
        if (promptsConfig.custom_commands?.[cmdName]) {
          promptsConfig.custom_commands[cmdName].photo = undefined;
          savePromptsConfig(promptsConfig);
          await bot.sendMessage(chatId, `✅ Cleared photo for /${cmdName}!`);
          await sendCustomCommandEditMenu(chatId, cmdName);
        }
      } else if (action === "delete") {
        if (promptsConfig.custom_commands) {
          delete promptsConfig.custom_commands[cmdName];
          savePromptsConfig(promptsConfig);
          await bot.sendMessage(chatId, `✅ Deleted custom command /${cmdName}!`);
          
          try {
            const systemCommands = [
              { command: "start", description: "Launch the game hub and display menu" },
              { command: "play", description: "Launch the Web App immediately" },
              { command: "balance", description: "Check your current wallet balance" },
              { command: "deposit", description: "Deposit ETB into your balance" },
              { command: "withdraw", description: "Withdraw ETB from your balance" },
              { command: "support", description: "Show contact support details" },
              { command: "language", description: "Change bot language" },
              { command: "cancel", description: "Cancel current operation or active flows" }
            ];

            const customCommandsList = Object.entries(promptsConfig.custom_commands || {}).map(([cmd, cfg]) => ({
              command: cmd,
              description: cfg.description || "Custom command"
            }));

            await bot.setMyCommands([...systemCommands, ...customCommandsList]);
          } catch (err) {}
        }
        const text = "✨ <b>Custom Commands Main Panel</b>";
        await bot.sendMessage(chatId, text, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Commands Panel", callback_data: "edit_section_custom_commands" }]]
          }
        });
      } else if (action === "buttons") {
        await sendCustomCommandButtonsPanel(chatId, cmdName, messageId);
      }
      return;
    }

    if (data.startsWith("cc_btn_click_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("cc_btn_click_", "").split("_");
      const cmdName = parts[0];
      const rIndex = parseInt(parts[1], 10);
      const cIndex = parseInt(parts[2], 10);
      
      const cmd = promptsConfig.custom_commands?.[cmdName];
      const btn = cmd?.buttons?.[rIndex]?.[cIndex];
      if (!btn) return;
      
      const text = `🔘 <b>Editing Custom Command Button</b>\n\n` +
        `• <b>Command:</b> /${cmdName}\n` +
        `• <b>Label:</b> <code>${btn.text}</code>\n` +
        `• <b>Type:</b> <code>${btn.type}</code>\n` +
        `• <b>Target Value:</b> <code>${btn.value}</code>\n\n` +
        `Select an action:`;
        
      const keyboard = {
        inline_keyboard: [
          [{ text: "✏️ Edit Button Label", callback_data: `cc_btn_label_${cmdName}_${rIndex}_${cIndex}` }],
          [{ text: "❌ Delete Button", callback_data: `cc_btn_del_${cmdName}_${rIndex}_${cIndex}` }],
          [{ text: "🔙 Back to Buttons", callback_data: `ccmd_val_${cmdName}_buttons` }]
        ]
      };
      
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("cc_btn_label_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("cc_btn_label_", "").split("_");
      const cmdName = parts[0];
      const rIndex = parseInt(parts[1], 10);
      const cIndex = parseInt(parts[2], 10);
      
      userStates.set(userId, {
        step: 'awaiting_cc_btn_label_change',
        cmd_name: cmdName,
        row: rIndex,
        col: cIndex
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter new label for this /${cmdName} button:</b>`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("cc_btn_del_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("cc_btn_del_", "").split("_");
      const cmdName = parts[0];
      const rIndex = parseInt(parts[1], 10);
      const cIndex = parseInt(parts[2], 10);
      
      const cmd = promptsConfig.custom_commands?.[cmdName];
      if (cmd?.buttons?.[rIndex]) {
        cmd.buttons[rIndex].splice(cIndex, 1);
        if (cmd.buttons[rIndex].length === 0) {
          cmd.buttons.splice(rIndex, 1);
        }
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, `✅ Button deleted successfully!`);
      }
      
      await sendCustomCommandButtonsPanel(chatId, cmdName);
      return;
    }

    if (data.startsWith("cc_btn_add_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const cmdName = data.replace("cc_btn_add_", "");
      userStates.set(userId, {
        step: 'awaiting_cc_btn_add_label',
        cmd_name: cmdName
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter label/text for the new button on /${cmdName}:</b>\n\nType the text and send it directly.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("cc_add_type_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("cc_add_type_", "").split("_");
      const cmdName = parts[0];
      const type = parts.slice(1).join("_");
      
      const state = userStates.get(userId);
      const label = state?.new_label || "New Button";
      const cmd = promptsConfig.custom_commands?.[cmdName];
      if (!cmd) return;
      if (!cmd.buttons) cmd.buttons = [];
      
      if (type === 'webapp') {
        cmd.buttons.push([{ text: label, type: 'webapp', value: 'appUrl' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      } else if (type === 'cb_dep') {
        cmd.buttons.push([{ text: label, type: 'callback', value: 'menu_deposit' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      } else if (type === 'cb_wd') {
        cmd.buttons.push([{ text: label, type: 'callback', value: 'menu_withdraw' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      } else if (type === 'cb_sup') {
        cmd.buttons.push([{ text: label, type: 'callback', value: 'menu_support' }]);
        savePromptsConfig(promptsConfig);
        userStates.set(userId, { step: 'idle' });
        await bot.sendMessage(chatId, `✅ Successfully added button "${label}"!`);
        await sendCustomCommandButtonsPanel(chatId, cmdName);
      } else if (type === 'url') {
        userStates.set(userId, {
          ...state,
          step: 'awaiting_cc_btn_add_url'
        });
        await bot.sendMessage(chatId, `✍️ <b>Please send the destination URL link:</b>\n\nExample: <code>https://t.me/EthiopiaPlayChannel</code>`, { parse_mode: "HTML" });
      }
      return;
    }

    if (data.startsWith("edit_refbtn_click_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_refbtn_click_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      
      const btn = promptsConfig.referral_buttons?.[rIndex]?.[cIndex];
      if (!btn) {
        return bot.sendMessage(chatId, "❌ Button not found.");
      }
      
      const text = `🤝 <b>Editing Referral Button</b>\n\n` +
        `• <b>Label:</b> <code>${btn.text}</code>\n` +
        `• <b>Type:</b> <code>${btn.type}</code>\n` +
        `• <b>Target Value:</b> <code>${btn.value}</code>\n\n` +
        `Select an action:`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "✏️ Edit Button Label", callback_data: `edit_refbtn_label_${rIndex}_${cIndex}` }],
          [{ text: "🔗 Edit Share URL", callback_data: `edit_refbtn_url_${rIndex}_${cIndex}` }],
          [{ text: "❌ Delete Button", callback_data: `edit_refbtn_del_${rIndex}_${cIndex}` }],
          [{ text: "🔙 Back to Buttons", callback_data: "edit_section_referral_buttons" }]
        ]
      };
      
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("edit_refbtn_label_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_refbtn_label_", "").split("_");
      const rIndex = parts[0];
      const cIndex = parts[1];
      
      userStates.set(userId, {
        step: 'awaiting_refbtn_label_change',
        row: parseInt(rIndex, 10),
        col: parseInt(cIndex, 10)
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter new label/text for the referral button:</b>\n\nType the text and send it directly.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("edit_refbtn_url_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_refbtn_url_", "").split("_");
      const rIndex = parts[0];
      const cIndex = parts[1];
      
      userStates.set(userId, {
        step: 'awaiting_refbtn_url_change',
        row: parseInt(rIndex, 10),
        col: parseInt(cIndex, 10)
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter the new share URL link:</b>\n\nUse <code>{user_id}</code> and <code>{bot_username}</code> as placeholders if needed.`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("edit_refbtn_del_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      const parts = data.replace("edit_refbtn_del_", "").split("_");
      const rIndex = parseInt(parts[0], 10);
      const cIndex = parseInt(parts[1], 10);
      
      if (promptsConfig.referral_buttons?.[rIndex]) {
        promptsConfig.referral_buttons[rIndex].splice(cIndex, 1);
        if (promptsConfig.referral_buttons[rIndex].length === 0) {
          promptsConfig.referral_buttons.splice(rIndex, 1);
        }
        savePromptsConfig(promptsConfig);
        await bot.sendMessage(chatId, "✅ Referral button deleted successfully!");
      }
      
      await bot.sendMessage(chatId, "🤝 <b>Referral Buttons Main Editor</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Buttons Panel", callback_data: "edit_section_referral_buttons" }]]
        }
      });
      return;
    }

    if (data === "edit_refbtn_add") {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      
      userStates.set(userId, {
        step: 'awaiting_refbtn_add_label'
      });
      
      await bot.sendMessage(chatId, `✍️ <b>Enter label/text for the new referral button:</b>\n\nExample: <code>🎁 Invite & Earn</code>`, { parse_mode: "HTML" });
      return;
    }

    if (data.startsWith("edit_bank_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const bankId = data.replace("edit_bank_", "");
      const bank = promptsConfig.banks[bankId] || { name: bankId, account: "", owner_name: "" };
      const text = `🏦 <b>Bank Settings: ${bankId}</b>\n\n` +
        `🏷️ <b>Display Name:</b> <code>${bank.name}</code>\n` +
        `💳 <b>Account/Phone:</b> <code>${bank.account}</code>\n` +
        `👤 <b>Owner Name:</b> <code>${bank.owner_name}</code>\n\n` +
        `Select which property you want to edit:`;
      const keyboard = {
        inline_keyboard: [
          [{ text: "🏷️ Edit Display Name", callback_data: `edit_bankval_${bankId}_name` }],
          [{ text: "💳 Edit Account/Phone", callback_data: `edit_bankval_${bankId}_account` }],
          [{ text: "👤 Edit Owner Name", callback_data: `edit_bankval_${bankId}_owner_name` }],
          [{ text: "🔙 Back to Banks", callback_data: "edit_section_banks" }]
        ]
      };
      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("edit_key_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const key = data.replace("edit_key_", "") as keyof PromptsConfig;
      const currentVal = promptsConfig[key] || "";
      userStates.set(userId, {
        step: 'edit_prompt_value',
        editingKey: key
      });

      let section = "control_edit";
      if (key.startsWith("withdraw")) section = "edit_section_withdrawal";
      else if (key.startsWith("deposit") || key === "support_text") section = "edit_section_deposit";
      else if (key === "referral_msg" || key === "referral_image" || key === "referral_share_text" || key === "referral_share_image") section = "edit_section_referral";
      else if (key.startsWith("welcome") || key === "support_card_msg") section = "edit_section_welcome";

      if (key === 'referral_image' || key === 'referral_share_image' || key === 'welcome_image' || key === 'welcome_guest_image') {
        let title = "Editing Image";
        if (key === 'referral_image') title = "Referral Image";
        else if (key === 'referral_share_image') title = "Referral Share Image";
        else if (key === 'welcome_image') title = "Welcome Image (Registered)";
        else if (key === 'welcome_guest_image') title = "Welcome Image (Guest)";

        const text = `🖼️ <b>Editing ${title}</b>\n\n` +
          `<b>Current File ID:</b> <code>${currentVal || 'None'}</code>\n\n` +
          `<i>Please send a PHOTO to update the image, or send <code>none</code> to remove it.</i>`;
        const keyboard = {
          inline_keyboard: [
            [{ text: "❌ Cancel", callback_data: section }]
          ]
        };
        if (messageId) {
          await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
        }
        return;
      }

      const text = `✍️ <b>Editing Prompt Key:</b> <code>${key}</code>\n\n` +
        `<b>Current Value:</b>\n` +
        `<pre>${currentVal}</pre>\n\n` +
        `<i>Please send the new text message in response to this message to update it. Markdown formatting is supported.</i>`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "❌ Cancel", callback_data: section }]
        ]
      };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("edit_bankval_")) {
      if (!adminChatIds.has(parseInt(userId, 10))) {
        bot.answerCallbackQuery(query.id, { text: "❌ Access Denied" });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const parts = data.replace("edit_bankval_", "").split("_");
      const bankId = parts[0];
      const prop = parts.slice(1).join("_"); // 'name' | 'account' | 'owner_name'
      const bank = promptsConfig.banks[bankId] || { name: bankId, account: "", owner_name: "" };
      const currentVal = (bank as any)[prop] || "";

      userStates.set(userId, {
        step: 'edit_prompt_value',
        editingKey: `bank_${bankId}_${prop}`
      });

      const text = `✍️ <b>Editing ${bankId} Bank Property:</b> <code>${prop}</code>\n\n` +
        `<b>Current Value:</b>\n` +
        `<pre>${currentVal}</pre>\n\n` +
        `<i>Please send the new value text message to update.</i>`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: "❌ Cancel", callback_data: `edit_bank_${bankId}` }]
        ]
      };

      if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("lang_")) {
      const lang = data === "lang_en" ? "en" : "am";
      userLanguages.set(userId, lang);
      await bot.answerCallbackQuery(query.id, { text: `Language changed to ${lang === 'en' ? 'English' : 'Amharic'}` });
      bot.sendMessage(chatId, lang === 'en' ? "Language set to English." : "ቋንቋ ወደ አማርኛ ተቀይሯል።");
      return;
    }

    logBot(`callback_query received: userId=${userId}, chatId=${chatId}, data=${data}`);

    if (!chatId || !data) {
      logBot(`callback_query rejected: chatId=${chatId}, data=${data}`);
      return;
    }

    if (data === "register_start") {
      try {
        await bot.answerCallbackQuery(query.id);
        const contactPrompt = `📱 <b>Registration Required / ምዝገባ ያስፈልጋል</b>\n\n` +
          `To ensure a secure environment, protect your funds, and prevent bots, please share your contact details below to finalize your registration.\n\n` +
          `ደህንነቱ የተጠበቀ የጨዋታ ሁኔታ ለመፍጠር እና ቦቶችን ለመከላከል እባክዎ ከታች ያለውን <b>"📱 Share Contact / ስልክ ቁጥር ያጋሩ"</b> የሚለውን ቁልፍ ተጭነው ስልክ ቁጥርዎን ያጋሩ።`;
        
        await bot.sendMessage(chatId, contactPrompt, {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [
              [{ text: "📱 Share Contact / ስልክ ቁጥር ያጋሩ", request_contact: true }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        });
      } catch (e: any) {
        logBot(`Error in register_start callback: ${e.message}`);
      }
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

    // --- ADMIN BROADCAST CAMPAIGN CALLBACK HANDLERS ---
    const isBroadcastAction = data.startsWith("bcast_");
    if (isBroadcastAction) {
      const clickerId = query.from.id;
      if (!adminChatIds.has(clickerId)) {
        logBot(`Unauthorized broadcast action attempt by clickerId=${clickerId} on ${data}`);
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

    if (data === "bcast_cancel") {
      const clickerId = query.from.id;
      broadcastStates.delete(clickerId);
      try {
        await bot.answerCallbackQuery(query.id, { text: "Studio Canceled" });
        if (messageId) {
          await bot.editMessageText(`❌ <b>Broadcast campaign studio closed.</b>`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
          });
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_back_dash") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (!state) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }
      try {
        await bot.answerCallbackQuery(query.id);
        await renderBroadcastDashboard(bot, chatId, clickerId, state, messageId);
      } catch (e) {
        // ignore
      }
      return;
    }

    // Navigation sub-panels
    if (data === "bcast_dash_target") {
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderTargetSelection(bot, chatId, messageId);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_template") {
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderTemplateSelection(bot, chatId, messageId);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_style") {
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderStyleSelection(bot, chatId, messageId);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_history") {
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderBroadcastHistory(bot, chatId, messageId);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_custom_decor") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (!state) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderCustomDecorSelection(bot, chatId, messageId, state);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_dash_buttons") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (!state) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderButtonsManager(bot, chatId, messageId, state);
        }
      } catch (e) {}
      return;
    }

    if (data === "bcast_custom_decor_header") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_custom_header';
        try {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatId, `✍️ <b>Enter Custom Header Template</b>\n\nType the custom text you want to use as your visual header (e.g., <code>🔥 Ethiopian New Year Tournament 🔥</code>).\n\n💡 <i>You can use standard HTML markup (like <b>bold</b> or <i>italic</i>) and emojis. Type <code>none</code> to remove/clear completely.</i>`, { parse_mode: "HTML" });
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_custom_decor_footer") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_custom_footer';
        try {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatId, `✍️ <b>Enter Custom Footer Subtext</b>\n\nType the custom subtext you want to append as your visual footer (e.g., <code>⚡ Offers expire in 2 hours!</code>).\n\n💡 <i>You can use standard HTML markup and emojis. Type <code>none</code> to remove/clear completely.</i>`, { parse_mode: "HTML" });
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_custom_decor_clear") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.customHeader = undefined;
        state.customFooter = undefined;
        try {
          await bot.answerCallbackQuery(query.id, { text: "🧹 Custom decor cleared" });
          if (messageId) {
            await renderCustomDecorSelection(bot, chatId, messageId, state);
          }
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_buttons_add") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_btn_text';
        try {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatId, `✍️ <b>Add Custom Button</b>\n\nPlease enter the label text for this button (e.g., <code>Play Now 🎮</code> or <code>Join Group 👥</code>):`, { parse_mode: "HTML" });
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_buttons_clear") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.buttons = [];
        try {
          await bot.answerCallbackQuery(query.id, { text: "🧹 All custom buttons cleared" });
          if (messageId) {
            await renderButtonsManager(bot, chatId, messageId, state);
          }
        } catch (e) {}
      }
      return;
    }

    if (data === "bcast_buttons_done") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      logBot(`bcast_buttons_done clicked, state exists: ${!!state}`);
      if (state) {
        state.step = 'review';
        try {
          await bot.answerCallbackQuery(query.id);
          // Try to delete the button manager message
          if (messageId) {
            await bot.deleteMessage(chatId, messageId).catch(() => {});
          }
          logBot(`Calling showBroadcastReview...`);
          await showBroadcastReview(bot, chatId, clickerId, state);
          logBot(`showBroadcastReview called successfully`);
        } catch (e: any) {
          logBot(`Error in bcast_buttons_done: ${e.message}`);
        }
      }
      return;
    }

    // Set Targets
    if (data.startsWith("bcast_set_target_")) {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        const selectedTarget = data.replace("bcast_set_target_", "") as any;
        state.target = selectedTarget;
        try {
          await bot.answerCallbackQuery(query.id, { text: `🎯 Target updated!` });
          await renderBroadcastDashboard(bot, chatId, clickerId, state, messageId);
        } catch (e) {}
      }
      return;
    }

    // Set Templates
    if (data.startsWith("bcast_set_temp_")) {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        const selectedTemplate = data.replace("bcast_set_temp_", "") as any;
        state.template = selectedTemplate;
        try {
          await bot.answerCallbackQuery(query.id, { text: `🎨 Template preset updated!` });
          await renderBroadcastDashboard(bot, chatId, clickerId, state, messageId);
        } catch (e) {}
      }
      return;
    }

    // Past Campaign Retraction confirmation/execution
    if (data.startsWith("bcast_hist_retract_")) {
      const campaignId = data.replace("bcast_hist_retract_", "");
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await renderRetractConfirmation(bot, chatId, messageId, campaignId);
        }
      } catch (e) {}
      return;
    }

    if (data.startsWith("bcast_retract_execute_")) {
      const clickerId = query.from.id;
      const campaignId = data.replace("bcast_retract_execute_", "");
      const campaigns = loadCampaigns();
      const campIndex = campaigns.findIndex(c => c.id === campaignId);
      if (campIndex === -1) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Campaign not found.", show_alert: true });
        return;
      }
      
      const camp = campaigns[campIndex];
      try {
        await bot.answerCallbackQuery(query.id, { text: "Retracting..." });
        
        let statusMsg: any = null;
        if (messageId) {
          statusMsg = await bot.editMessageText(`⏳ <b>Retracting message from ${camp.sent_messages.length} player chats...</b>`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
          });
        } else {
          statusMsg = await bot.sendMessage(chatId, `⏳ <b>Retracting message from ${camp.sent_messages.length} player chats...</b>`, { parse_mode: "HTML" });
        }

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < camp.sent_messages.length; i++) {
          const item = camp.sent_messages[i];
          try {
            await bot.deleteMessage(item.chat_id, item.message_id);
            successCount++;
          } catch (e) {
            failCount++;
          }
          
          if (i % 20 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }

        // Remove from campaigns
        campaigns.splice(campIndex, 1);
        updateCampaignsFile(campaigns);

        const resultText = `🎉 <b>Campaign Retracted Successfully!</b>\n\n` +
          `The message has been removed from recipients' Telegram inboxes.\n\n` +
          `• ✅ Deleted from: <code>${successCount}</code> player chats\n` +
          `• ❌ Failed (already deleted/old): <code>${failCount}</code> chats\n\n` +
          `<i>Campaign record removed from history.</i>`;

        await bot.sendMessage(chatId, resultText, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to History", callback_data: "bcast_dash_history" }]]
          }
        });

      } catch (err: any) {
        logBot(`Retraction error: ${err.message}`);
        await bot.sendMessage(chatId, `❌ <b>Retraction failed:</b> ${err.message}`);
      }
      return;
    }

    if (data === "bcast_type_text") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_text';
        state.type = 'text';
      } else {
        broadcastStates.set(clickerId, { step: 'awaiting_text', type: 'text', target: 'all', template: 'none' });
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await bot.editMessageText(
            `📝 <b>Text-Only Announcement</b>\n\n` +
            `Please type and send the text message you want to broadcast.\n\n` +
            `💡 <i>HTML tags are supported:</i>\n` +
            `• <code>&lt;b&gt;bold&lt;/b&gt;</code>\n` +
            `• <code>&lt;i&gt;italics&lt;/i&gt;</code>\n` +
            `• <code>&lt;a href="LINK"&gt;text&lt;/a&gt;</code>\n\n` +
            `Send your message now, or type <code>/cancel</code> to abort.`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }]
                ]
              }
            }
          );
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_type_photo") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_photo';
        state.type = 'photo';
      } else {
        broadcastStates.set(clickerId, { step: 'awaiting_photo', type: 'photo', target: 'all', template: 'none' });
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await bot.editMessageText(
            `🖼️ <b>Photo + Caption Announcement</b>\n\n` +
            `Please upload/send the <b>Photo</b> you want to broadcast.\n\n` +
            `💡 <i>Tip: You can add the styled caption directly on the photo before sending, or write it in the next step.</i>`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }]
                ]
              }
            }
          );
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_type_photo_button") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_photo';
        state.type = 'photo_button';
      } else {
        broadcastStates.set(clickerId, { step: 'awaiting_photo', type: 'photo_button', target: 'all', template: 'none' });
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await bot.editMessageText(
            `🖼️ <b>Photo + Caption + Button Announcement</b>\n\n` +
            `Please upload/send the <b>Photo</b> you want to broadcast.\n\n` +
            `💡 <i>After uploading, you will be prompted to add caption and custom buttons.</i>`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }]
                ]
              }
            }
          );
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_type_webapp") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (state) {
        state.step = 'awaiting_text';
        state.type = 'webapp';
      } else {
        broadcastStates.set(clickerId, { step: 'awaiting_text', type: 'webapp', target: 'all', template: 'none' });
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (messageId) {
          await bot.editMessageText(
            `🔘 <b>Play Button Announcement</b>\n\n` +
            `Please type and send the text message you want to broadcast.\n\n` +
            `💡 We will automatically append an interactive <b>"Play Game 🎮"</b> button linking straight to the Web App underneath your message.\n\n` +
            `Send your message now, or type <code>/cancel</code> to abort.`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Studio Dashboard", callback_data: "bcast_back_dash" }]
                ]
              }
            }
          );
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_action_edit") {
      const clickerId = query.from.id;
      const state = broadcastStates.get(clickerId);
      if (!state) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }
      try {
        await bot.answerCallbackQuery(query.id);
        if (state.type === 'photo') {
          state.step = 'awaiting_photo';
          await bot.sendMessage(chatId, `🖼️ <b>Please send the new Photo:</b>`, { parse_mode: "HTML" });
        } else {
          state.step = 'awaiting_text';
          await bot.sendMessage(chatId, `✍️ <b>Please send the new text message:</b>`, { parse_mode: "HTML" });
        }
      } catch (e) {
        // ignore
      }
      return;
    }

    if (data === "bcast_action_send" || data === "bcast_action_send_pin") {
      const clickerId = query.from.id;
      const composer = broadcastStates.get(clickerId);
      if (!composer) {
        await bot.answerCallbackQuery(query.id, { text: "❌ Session expired.", show_alert: true });
        return;
      }

      const shouldPin = (data === "bcast_action_send_pin");
      try {
        await bot.answerCallbackQuery(query.id, { text: "🚀 Sending..." });
        
        // Notify of start
        const statusMsg = await bot.sendMessage(chatId, `⏳ <b>Filtering players from database...</b>`, { parse_mode: "HTML" });

        let realPlayers: any[] = [];
        const targetType = composer.target || 'all';

        if (targetType === 'test') {
          // Admin test run only
          realPlayers = Array.from(adminChatIds).map(id => ({ id: id.toString() }));
        } else if (targetType === 'whales') {
          // Users with balance >= 150000
          const { data: dbUsers, error: dbError } = await supabase
            .from('users')
            .select('id')
            .gte('balance', 150000);
          if (dbError) throw new Error(`Database fetch failed: ${dbError.message}`);
          realPlayers = (dbUsers || []).filter(u => u.id && /^-?\d+$/.test(u.id));
        } else if (targetType === 'active') {
          // Distinct players from game_logs
          const { data: logUsers, error: logError } = await supabase
            .from('game_logs')
            .select('user_id');
          if (logError) {
            const { data: dbUsers } = await supabase.from('users').select('id');
            realPlayers = (dbUsers || []).filter(u => u.id && /^-?\d+$/.test(u.id));
          } else {
            const activeIds = Array.from(new Set((logUsers || []).map(l => l.user_id).filter(Boolean)));
            realPlayers = activeIds.map(id => ({ id })).filter(u => u.id && /^-?\d+$/.test(u.id));
          }
        } else {
          // All Players
          const { data: dbUsers, error: dbError } = await supabase.from('users').select('id');
          if (dbError) throw new Error(`Database fetch failed: ${dbError.message}`);
          realPlayers = (dbUsers || []).filter(u => u.id && /^-?\d+$/.test(u.id));
        }

        if (realPlayers.length === 0) {
          await bot.editMessageText(`⚠️ <b>Aborted:</b> No players match the chosen audience filter.`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: "HTML"
          });
          broadcastStates.delete(clickerId);
          return;
        }

        const totalPlayers = realPlayers.length;
        await bot.editMessageText(`📢 <b>Starting Campaign Delivery...</b>\n\n⚡ <i>Progress: 0% (0/${totalPlayers} sent)</i>`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "HTML"
        });

        const campaignId = "camp_" + Date.now();
        const sentMessagesList: CampaignMessage[] = [];
        let successCount = 0;
        let failCount = 0;
        const startTime = Date.now();

        const campaignRawText = composer.textMessage || "";
        const campaignFormattedText = formatMessageWithTemplate(campaignRawText, composer.template, composer.customHeader, composer.customFooter);
        const playerButtons = buildCampaignReplyMarkup(composer, appUrl);
        const playerReplyMarkup = playerButtons.length > 0 ? { inline_keyboard: playerButtons } : undefined;

        for (let i = 0; i < totalPlayers; i++) {
          const playerId = realPlayers[i].id;
          if (!playerId) continue;

          try {
            let sentMsg: any = null;

            if ((composer.type === 'photo' || composer.type === 'photo_button') && composer.photoFileId) {
              sentMsg = await bot.sendPhoto(playerId, composer.photoFileId, {
                caption: campaignFormattedText,
                parse_mode: "HTML",
                reply_markup: playerReplyMarkup
              });
            } else {
              sentMsg = await bot.sendMessage(playerId, campaignFormattedText, {
                parse_mode: "HTML",
                reply_markup: playerReplyMarkup
              });
            }

            if (sentMsg) {
              sentMessagesList.push({
                chat_id: playerId,
                message_id: sentMsg.message_id
              });

              if (shouldPin) {
                await bot.pinChatMessage(playerId, sentMsg.message_id, { disable_notification: true })
                  .catch(() => {}); // catch if not supported
              }
            }

            successCount++;
          } catch (sendErr: any) {
            failCount++;
            logBot(`Broadcast delivery failed for player ${playerId}: ${sendErr.message}`);
          }

          // Throttle update
          if ((i + 1) % 10 === 0 || i === totalPlayers - 1) {
            const percent = Math.round(((i + 1) / totalPlayers) * 100);
            await bot.editMessageText(
              `📢 <b>Sending Broadcast Announcement...</b>\n\n` +
              `📊 <b>Progress:</b> <code>${percent}%</code> (${i + 1}/${totalPlayers})\n` +
              `✅ Delivered: <code>${successCount}</code>\n` +
              `❌ Failed: <code>${failCount}</code>`,
              {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: "HTML"
              }
            ).catch(() => {});
          }

          // Rate limit protection sleep (100ms)
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Save successfully sent message IDs to our persistent local campaign tracker
        if (sentMessagesList.length > 0) {
          saveCampaign({
            id: campaignId,
            timestamp: Date.now(),
            type: composer.type || 'text',
            target: targetType,
            template: composer.template || 'none',
            textSnippet: campaignRawText.slice(0, 50) || "Image-Only Broadcast",
            sent_messages: sentMessagesList
          });
        }

        await bot.sendMessage(
          chatId,
          `🎉 <b>Broadcast Campaign Completed!</b>\n\n` +
          `📊 <b>Results:</b>\n` +
          `• 👥 Total Target: <code>${totalPlayers} players</code>\n` +
          `• ✅ Successfully Sent: <code>${successCount}</code>\n` +
          `• ❌ Failed/Blocked: <code>${failCount}</code>\n` +
          `• 📌 Pinned: <code>${shouldPin ? 'Yes' : 'No'}</code>\n` +
          `• ⏱️ Delivery Time: <code>${elapsed} seconds</code>\n\n` +
          `💡 <i>Need to retract? You can instantly retract this campaign from the "Retract / Delete Campaigns" list!</i>`,
          { parse_mode: "HTML" }
        );

      } catch (err: any) {
        logBot(`Broadcast Campaign Error: ${err.message}`);
        await bot.sendMessage(chatId, `❌ <b>Campaign failed with error:</b>\n\n<code>${err.message}</code>`, { parse_mode: "HTML" });
      } finally {
        broadcastStates.delete(clickerId);
      }
      return;
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
      const bankConfig = promptsConfig.banks[bank] || { name: bank, account: "0931503559", owner_name: "Tadese" };
      const supportTxt = promptsConfig.support_text;

      const paymentInstructions = `${supportTxt}\n\n` +
        `1. ከታች ባለው የ*${bankConfig.name || bank}* አካውንት *${amount.toLocaleString()} ብር* ያስገቡ\n` +
        `    *Account/Phone:* \`${bankConfig.account}\`\n` +
        `    *Name:* \`${bankConfig.owner_name}\`\n\n` +
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
        return bot.sendMessage(chatId, promptsConfig.withdraw_telebirr_prompt, { parse_mode: "Markdown" });
      } else {
        return bot.sendMessage(chatId, promptsConfig.withdraw_other_bank_prompt, { parse_mode: "Markdown" });
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
        const successMsg = promptsConfig.deposit_approved_msg
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{ref}/g, refCode);
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
        const declineMsg = promptsConfig.deposit_declined_msg
          .replace(/{amount}/g, request.amount.toLocaleString());
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
        const successMsg = promptsConfig.withdraw_approved_msg
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{ref}/g, refCode);
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
        const declineMsg = promptsConfig.withdraw_declined_msg
          .replace(/{amount}/g, request.amount.toLocaleString())
          .replace(/{balance}/g, refundedBalance.toLocaleString());
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

export async function triggerBotFlow(userId: string, flowType: 'deposit' | 'withdraw'): Promise<boolean> {
  logBot(`triggerBotFlow called for userId=${userId}, flowType=${flowType}`);
  const chatId = parseInt(userId, 10);
  if (isNaN(chatId)) {
    logBot(`Invalid userId for triggerBotFlow: ${userId}`);
    return false;
  }

  if (flowType === 'deposit') {
    if (startDepositFlowRef) {
      startDepositFlowRef(chatId, userId);
      return true;
    }
  } else if (flowType === 'withdraw') {
    if (startWithdrawalFlowRef) {
      await startWithdrawalFlowRef(chatId, userId);
      return true;
    }
  }
  return false;
}
