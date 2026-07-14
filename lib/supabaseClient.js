import { createClient } from "@supabase/supabase-js";

// Public browser client — uses the publishable (anon) key.
// Safe to ship to the browser; Row Level Security protects the data.
// Fallbacks let the app build even before env vars are set (e.g. during
// Vercel's first build step). Real values are injected at runtime.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});
