import { supabaseAdmin } from "../../lib/supabaseAdmin";

async function requireAdmin(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "Not signed in.", status: 401 };
  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return { error: "Session invalid.", status: 401 };
  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", userData.user.id).single();
  if (profile?.role !== "admin") return { error: "Admins only.", status: 403 };
  return { userId: userData.user.id };
}

const VALID_PERMS = ["courses", "scenarios", "quizzes", "knowledge", "classroom", "reports"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const gate = await requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const { userId, role, permissions } = req.body || {};
  if (!userId) return res.status(400).json({ error: "Missing userId." });
  if (role && !["employee", "trainer", "admin"].includes(role)) return res.status(400).json({ error: "Invalid role." });

  const patch = {};
  if (role) patch.role = role;
  if (permissions && typeof permissions === "object") {
    const clean = {};
    VALID_PERMS.forEach((k) => { clean[k] = !!permissions[k]; });
    patch.permissions = clean;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Nothing to update." });

  const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
