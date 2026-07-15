import { supabaseAdmin } from "../../lib/supabaseAdmin";

const RECORDING_DAYS = 30;

async function requireUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "Not signed in.", status: 401 };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { error: "Session invalid.", status: 401 };
  return { userId: data.user.id };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const gate = await requireUser(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const { resultId, recordingPath } = req.body || {};
  if (!resultId || !recordingPath) return res.status(400).json({ error: "Missing resultId or recordingPath." });

  const expiresAt = new Date(Date.now() + RECORDING_DAYS * 86400000).toISOString();
  const { error } = await supabaseAdmin
    .from("roleplay_results")
    .update({ recording_path: recordingPath, recording_expires_at: expiresAt })
    .eq("id", resultId)
    .eq("user_id", gate.userId);
  if (error) return res.status(500).json({ error: error.message });

  const { data: signed } = await supabaseAdmin.storage.from("call-recordings").createSignedUrl(recordingPath, 3600);
  return res.status(200).json({ ok: true, recording_url: signed?.signedUrl || null });
}
