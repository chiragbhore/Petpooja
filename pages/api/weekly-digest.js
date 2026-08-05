import { supabaseAdmin } from "../../lib/supabaseAdmin";

// Allows this route to be triggered two ways:
// 1) Vercel Cron, which automatically sends "Authorization: Bearer <CRON_SECRET>"
//    when CRON_SECRET is set as an env var.
// 2) A signed-in admin, for testing on demand from the browser.
async function isAuthorized(req) {
  const auth = req.headers.authorization || "";
  if (process.env.CRON_SECRET && auth === "Bearer " + process.env.CRON_SECRET) return true;

  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) return false;
  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", userData.user.id).single();
  return profile?.role === "admin";
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export default async function handler(req, res) {
  if (!(await isAuthorized(req))) return res.status(401).json({ error: "Not authorized." });
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: "Missing RESEND_API_KEY." });

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: employees }, { data: admins }, { data: results }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name").eq("role", "employee"),
    supabaseAdmin.from("profiles").select("email, full_name").eq("role", "admin"),
    supabaseAdmin.from("roleplay_results").select("user_id, overall, created_at").gte("created_at", weekAgo),
  ]);

  const byUser = {};
  (results || []).forEach((r) => { (byUser[r.user_id] = byUser[r.user_id] || []).push(r.overall || 0); });

  const rows = (employees || []).map((e) => {
    const scores = byUser[e.id] || [];
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    return { name: e.full_name, calls: scores.length, avg };
  });

  const practiced = rows.filter((r) => r.calls > 0).sort((a, b) => b.avg - a.avg);
  const didntPractice = rows.filter((r) => r.calls === 0);
  const top3 = practiced.slice(0, 3);
  const bottom3 = practiced.slice(-3).reverse();

  const rowHtml = (r) => `<tr><td style="padding:6px 10px">${escapeHtml(r.name)}</td><td style="padding:6px 10px">${r.avg}</td></tr>`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:#6d4aff">PitchLab — Weekly Digest</h2>
      <p style="color:#555">Team activity for the past 7 days.</p>

      <h3>Summary</h3>
      <p>${practiced.length} of ${rows.length} employees practiced this week.</p>

      ${top3.length > 0 ? `<h3>Top performers</h3><table style="border-collapse:collapse">${top3.map(rowHtml).join("")}</table>` : ""}
      ${bottom3.length > 0 ? `<h3>Needs attention</h3><table style="border-collapse:collapse">${bottom3.map(rowHtml).join("")}</table>` : ""}

      ${didntPractice.length > 0 ? `
        <h3>Didn't practice this week</h3>
        <p style="color:#b91c1c">${didntPractice.map((r) => escapeHtml(r.name)).join(", ")}</p>
      ` : `<p style="color:#15803d">Everyone practiced at least once this week 🎉</p>`}

      <p style="color:#999;font-size:12px;margin-top:24px">Sent automatically by PitchLab.</p>
    </div>
  `;

  const adminEmails = (admins || []).map((a) => a.email).filter(Boolean);
  if (adminEmails.length === 0) return res.status(200).json({ sent: false, reason: "No admin emails found." });

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "PitchLab <onboarding@resend.dev>",
        to: adminEmails,
        subject: "PitchLab — Weekly Team Digest",
        html,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || "Resend failed to send." });
    return res.status(200).json({ sent: true, to: adminEmails });
  } catch (e) {
    return res.status(500).json({ error: "Could not send email: " + (e.message || e) });
  }
}
