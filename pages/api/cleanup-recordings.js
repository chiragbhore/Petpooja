import { supabaseAdmin } from "../../lib/supabaseAdmin";

// Called by Vercel Cron (see vercel.json) once a day.
// Deletes recording files whose 30-day window has passed, and clears
// the pointer so the report still shows but the download link is gone.
export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const { data: expired, error } = await supabaseAdmin
    .from("roleplay_results")
    .select("id, recording_path")
    .not("recording_path", "is", null)
    .lt("recording_expires_at", new Date().toISOString());

  if (error) return res.status(500).json({ error: error.message });
  if (!expired || expired.length === 0) return res.status(200).json({ deleted: 0 });

  const paths = expired.map((r) => r.recording_path);
  await supabaseAdmin.storage.from("call-recordings").remove(paths);
  await supabaseAdmin
    .from("roleplay_results")
    .update({ recording_path: null, recording_expires_at: null })
    .in("id", expired.map((r) => r.id));

  return res.status(200).json({ deleted: paths.length });
}
