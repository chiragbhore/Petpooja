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

function slugify(text) {
  return (text || "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) + "-" + Date.now().toString(36);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!process.env.DAILY_API_KEY) return res.status(500).json({ error: "Missing DAILY_API_KEY." });

  const gate = await requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const { title, scheduledAt, durationMinutes } = req.body || {};
  if (!title) return res.status(400).json({ error: "Missing title." });

  // Auto-expire the room a bit after the session should end, so old rooms don't pile up.
  const start = scheduledAt ? new Date(scheduledAt).getTime() : Date.now();
  const durMin = Number(durationMinutes) || 45;
  const exp = Math.floor(start / 1000) + durMin * 60 + 60 * 60; // +1hr buffer past scheduled end

  try {
    const dRes = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.DAILY_API_KEY,
      },
      body: JSON.stringify({
        name: slugify(title),
        privacy: "public",
        properties: {
          exp: exp,
          enable_prejoin_ui: false,
          enable_knocking: false,
          eject_at_room_exp: true,
        },
      }),
    });
    const data = await dRes.json();
    if (!dRes.ok) {
      var apiMsg = (data && data.error) || ("Daily error (" + dRes.status + ")");
      return res.status(500).json({ error: "Could not create video room: " + apiMsg });
    }
    return res.status(200).json({ url: data.url, name: data.name });
  } catch (e) {
    return res.status(500).json({ error: "Could not create video room: " + (e.message || e) });
  }
}
