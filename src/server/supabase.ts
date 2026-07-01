import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

let supabaseUrl = process.env.SUPABASE_URL;
if (supabaseUrl && supabaseUrl.includes("/rest/v1")) {
  supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, "");
}
// Use service role key on the backend to bypass RLS and perform admin operations
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase credentials not found in environment variables. Database operations may fail.");
}

export const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseKey || "placeholder_key");
