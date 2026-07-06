import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from "./supabase.js";
import { logBot } from "./telegramBot.js";

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const DEFAULT_SYSTEM_INSTRUCTION = `You are the primary AI Support Assistant for ETB Game Hub (ኢቲቢ ጌም ሀብ), a premier Telegram gaming platform in Ethiopia. 

CORE MISSION:
Provide helpful, polite, and accurate support. You must be able to converse naturally in both Amharic (አማርኛ) and English. If a user speaks in Amharic, always respond in Amharic.

PLATFORM DETAILS:
- Games: Even/Odd (ኢቭን/ኦድ), Jackpot (ጃክፖት), Wheel of Chance (የዕድል መንኮራኩር).
- Currency: ETB (Ethiopian Birr).
- Withdrawals: Processed via Telebirr or Banks.

KEY RESPONSIBILITIES:
1. Greet users warmly and handle general inquiries naturally.
2. Check account status (balance, history) ONLY when relevant to the user's question.
3. Be transparent: if you are using a tool to check data, you can mention it (e.g., "ጥቂት ይጠብቁ፣ ባላንስዎን እየፈተሽኩ ነው...").
4. ESCALATION: Connect the user to human support (@scofiled1) if:
   - They ask for a person/human.
   - You cannot solve their specific issue.
   - There is a payment dispute you cannot verify.

LANGUAGE & CULTURE:
- Use respectful Amharic (e.g., use "እርስዎ" instead of "አንተ/አንቺ" for a professional tone).
- Support common Ethiopian slang or abbreviations if they appear (like "ዲፖዚት", "ዊዝድሮው").

SECURITY:
- Never reveal database IDs or server internals.
- Do not hallucinate data. If a tool fails, tell the user you are having trouble reaching the database.

Tone: Professional, hospitable (Ethiopian hospitality), and efficient.`;

const getUserProfileTool = {
  type: "function",
  name: "get_user_profile",
  description: "Fetches the current user's balance and registration details. You do NOT need to ask for their ID; you can call this tool directly for the current user.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      telegram_id: {
        type: Type.STRING,
        description: "Optional. The Telegram ID of a specific user to check. If omitted, the current user's profile is fetched."
      }
    }
  }
};

const getTransactionSummaryTool = {
  type: "function",
  name: "get_transaction_summary",
  description: "Fetches recent deposits and withdrawals for the user. You can call this directly for the current user without asking for their ID.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      telegram_id: {
        type: Type.STRING,
        description: "Optional. The Telegram ID of a specific user to check."
      }
    }
  }
};

const escalateToHumanTool = {
  type: "function",
  name: "escalate_to_human",
  description: "Triggers a connection to a human support agent.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description: "The reason why the user needs human assistance."
      }
    },
    required: ["reason"]
  }
};

export async function handleSupportChat(telegramId: string, message: string, interactionId?: string, isAdmin?: boolean) {
  try {
    // Fetch dynamic system instruction from database
    const { data: configData } = await supabase
      .from('bot_config')
      .select('value')
      .eq('key', 'ai_system_instruction')
      .single();
    
    let systemInstruction = configData?.value || DEFAULT_SYSTEM_INSTRUCTION;

    if (isAdmin) {
      systemInstruction += "\n\nADMIN PRIVILEGES: You are talking to an admin. You can use tools to check data for ANY user ID they provide.";
    }

    const params: any = {
      model: "gemini-3.5-flash",
      input: message,
      system_instruction: systemInstruction + "\n\nCRITICAL: Do NOT ask the user for their Telegram ID if they ask for their balance or history. You already have it. Just call the tools directly.",
      tools: [
        getUserProfileTool as any, 
        getTransactionSummaryTool as any, 
        escalateToHumanTool as any
      ],
    };

    // Only include interactionId if it's a non-empty string
    if (interactionId && typeof interactionId === 'string' && interactionId.trim().length > 0) {
      params.previous_interaction_id = interactionId;
    }

    async function safeCreateInteraction(p: any) {
      try {
        return await ai.interactions.create(p);
      } catch (err: any) {
        if (err.message?.includes('429') || err.status === 429) {
          console.warn("Quota exceeded for primary model, trying fallback 'gemini-3.1-flash-lite'");
          return await ai.interactions.create({ ...p, model: "gemini-3.1-flash-lite" });
        }
        throw err;
      }
    }

    let interaction = await safeCreateInteraction(params);

    // Turn Loop: Handle potential function calls
    let maxTurns = 5;
    while (maxTurns > 0) {
      const functionCalls = interaction.steps.filter(s => s.type === 'function_call');
      if (functionCalls.length === 0) break;

      const toolResults: any[] = [];
      for (const call of functionCalls) {
        if (call.name === "get_user_profile") {
          const { telegram_id } = call.arguments as any;
          const targetIdentifier = String(telegram_id || telegramId).trim();
          
          let query = supabase.from("users").select("id, username, balance, created_at");
          
          if (targetIdentifier.startsWith('@')) {
            query = query.eq('username', targetIdentifier.replace('@', ''));
          } else {
            query = query.eq('id', targetIdentifier);
          }
          
          const { data, error } = await query.single();
          
          toolResults.push({
            type: 'function_result',
            call_id: call.id,
            name: call.name,
            result: error ? { error: "User not found or database error." } : { data }
          });
        } else if (call.name === "get_transaction_summary") {
          const { telegram_id } = call.arguments as any;
          const targetIdentifier = String(telegram_id || telegramId).trim();
          
          let targetId = targetIdentifier;
          if (targetIdentifier.startsWith('@')) {
            const { data: user } = await supabase.from('users').select('id').eq('username', targetIdentifier.replace('@', '')).single();
            if (user) targetId = user.id;
          }
          
          const { data, error } = await supabase
            .from("transactions")
            .select("amount, type, description, created_at")
            .eq("user_id", targetId)
            .order("created_at", { ascending: false })
            .limit(10);

          toolResults.push({
            type: 'function_result',
            call_id: call.id,
            name: call.name,
            result: error ? { error: "Could not fetch transactions." } : { transactions: data }
          });
        } else if (call.name === "escalate_to_human") {
          return {
            text: "እሺ፣ አሁን ከሰው ድጋፍ ሰጪ (@scofiled1) ጋር እያገናኘሁዎት ነው። እባክዎን ጥቂት ይጠብቁ።",
            escalate: true,
            reason: (call.arguments as any).reason,
            interactionId: interaction.id
          };
        }
      }

      if (toolResults.length > 0) {
        interaction = await safeCreateInteraction({
          model: interaction.model || "gemini-3.5-flash",
          previous_interaction_id: interaction.id,
          input: toolResults as any
        });
      }
      maxTurns--;
    }

    let fullOutput = "";
    for (const step of interaction.steps) {
      if (step.type === 'model_output') {
        const textParts = step.content?.filter(c => c.type === 'text') || [];
        for (const part of textParts) {
          if (part.text) fullOutput += part.text;
        }
      }
    }

    const finalResultText = fullOutput || interaction.output_text || "ይቅርታ፣ አሁን ላይ ምላሽ መስጠት አልቻልኩም። እባክዎን ጥቂት ቆይተው እንደገና ይሞክሩ።";

    return {
      text: finalResultText,
      interactionId: interaction.id
    };
  } catch (error: any) {
    logBot(`AI Support Error: ${error.message}`);
    console.error("Interaction Failed:", error);
    return {
      text: "ይቅርታ፣ አሁን ላይ ትንሽ የቴክኒክ ችግር አጋጥሞኛል። እባክዎን በኋላ እንደገና ይሞክሩ ወይም በቀጥታ @scofiled1 ያነጋግሩ።",
      error: true
    };
  }
}
