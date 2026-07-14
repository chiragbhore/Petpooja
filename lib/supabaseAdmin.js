import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY client. Uses the SECRET key and bypasses Row Level Security,
// so it can create and delete employee accounts. This file must only ever
// be imported from API routes (pages/api/*), never from a page/component.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const secret = process.env.SUPABASE_SECRET_KEY || "placeholder-secret-key";

export const supabaseAdmin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});
