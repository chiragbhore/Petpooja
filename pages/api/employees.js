import { supabaseAdmin } from "../../lib/supabaseAdmin";

// Verify the caller is a signed-in admin, using their bearer token.
async function requireAdmin(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "Not signed in.", status: 401 };

  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return { error: "Session invalid.", status: 401 };

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "admin") return { error: "Admins only.", status: 403 };
  return { userId: userData.user.id };
}

export default async function handler(req, res) {
  // Guard: secret key must be configured
  if (!process.env.SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: "Server not configured: missing SUPABASE_SECRET_KEY." });
  }

  const gate = await requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  // LIST
  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, team, created_at")
      .eq("role", "employee")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ employees: data });
  }

  // CREATE
  if (req.method === "POST") {
    const { full_name, email, team, password } = req.body || {};
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required." });
    }
    // 1) create the auth login (auto-confirmed so they can sign in immediately)
    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (cErr) return res.status(400).json({ error: cErr.message });

    // 2) create their profile row
    const { error: pErr } = await supabaseAdmin.from("profiles").insert({
      id: created.user.id,
      full_name,
      email,
      team: team || null,
      role: "employee",
    });
    if (pErr) {
      // roll back the auth user if the profile failed
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return res.status(400).json({ error: pErr.message });
    }
    return res.status(200).json({ ok: true });
  }

  // DELETE
  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing employee id." });
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id); // cascades to profile
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed." });
}
