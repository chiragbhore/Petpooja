import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";
import ClassroomRoom from "../../components/ClassroomRoom";

export default function AdminClassroom() {
  const { loading, me } = useProfile("admin");
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", scheduled_at: "", duration_minutes: 45 });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inRoom, setInRoom] = useState(null);

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: "Bearer " + session?.access_token, "Content-Type": "application/json" };
  };

  const load = async () => {
    const { data } = await supabase.from("live_sessions").select("*").order("scheduled_at", { ascending: true });
    setSessions(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  const create = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!form.title.trim() || !form.scheduled_at) { setMsg("Title and date/time are required."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/create-classroom-room", {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({
          title: form.title,
          scheduledAt: new Date(form.scheduled_at).toISOString(),
          durationMinutes: form.duration_minutes,
        }),
      });
      const roomData = await res.json();
      if (!res.ok) { setMsg(roomData.error || "Could not create the video room."); setBusy(false); return; }

      const { error } = await supabase.from("live_sessions").insert({
        title: form.title,
        description: form.description,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_minutes: Number(form.duration_minutes) || 45,
        room_name: roomData.name,
        room_url: roomData.url,
        host_name: me.full_name,
        created_by: me.id,
      });
      if (error) { setMsg(error.message); setBusy(false); return; }

      setForm({ title: "", description: "", scheduled_at: "", duration_minutes: 45 });
      load();
    } catch (e) {
      setMsg("Could not create session: " + (e.message || e));
    }
    setBusy(false);
  };

  const del = async (id) => { if (confirm("Cancel this session?")) { await supabase.from("live_sessions").delete().eq("id", id); load(); } };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Live classroom</h1>
        <p className="sub">Schedule live video training sessions for your team. No sign-in required to join.</p>
        {msg && <div className="msg err">{msg}</div>}

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Schedule a session</div>
          <form onSubmit={create}>
            <div className="grid2">
              <label className="field"><span>Title</span><input value={form.title} onChange={set("title")} placeholder="Objection Handling Live Workshop" required /></label>
              <label className="field"><span>Date & time</span><input type="datetime-local" value={form.scheduled_at} onChange={set("scheduled_at")} required /></label>
              <label className="field"><span>Duration (minutes)</span><input type="number" value={form.duration_minutes} onChange={set("duration_minutes")} /></label>
            </div>
            <label className="field"><span>Description</span><input value={form.description} onChange={set("description")} placeholder="What this session covers" /></label>
            <button className="btn primary" disabled={busy}>{busy ? "Creating room…" : "Schedule session"}</button>
          </form>
        </div>

        <div className="card">
          <table className="table">
            <thead><tr><th>Session</th><th>When</th><th>Duration</th><th></th></tr></thead>
            <tbody>
              {sessions.length === 0 && <tr><td colSpan={4} className="mini" style={{ padding: 20 }}>No sessions scheduled yet.</td></tr>}
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.title}</b><div className="mini">{s.description}</div></td>
                  <td className="mini">{new Date(s.scheduled_at).toLocaleString()}</td>
                  <td className="mini">{s.duration_minutes} min</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn primary" onClick={() => setInRoom(s)}>Start</button>
                    <button className="btn danger" onClick={() => del(s.id)}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {inRoom && <ClassroomRoom roomUrl={inRoom.room_url} onClose={() => setInRoom(null)} />}
      </main>
    </div>
  );
}
