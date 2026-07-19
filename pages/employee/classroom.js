import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";
import ClassroomRoom from "../../components/ClassroomRoom";

export default function EmployeeClassroom() {
  const { loading, me } = useProfile("employee");
  const [sessions, setSessions] = useState([]);
  const [inRoom, setInRoom] = useState(null);

  useEffect(() => {
    if (loading) return;
    supabase.from("live_sessions").select("*").order("scheduled_at", { ascending: true })
      .then(({ data }) => setSessions(data || []));
  }, [loading]);

  const now = Date.now();
  const isLiveNow = (s) => {
    const start = new Date(s.scheduled_at).getTime();
    const end = start + (s.duration_minutes || 45) * 60000;
    return now >= start - 5 * 60000 && now <= end; // joinable 5 min early
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">Live classroom</h1>
        <p className="sub">Join a live training session with your trainer.</p>

        {sessions.length === 0 ? (
          <div className="card pad mini">No sessions scheduled yet. Check back soon.</div>
        ) : (
          <div className="grid2">
            {sessions.map((s) => {
              const live = isLiveNow(s);
              return (
                <div key={s.id} className="tile">
                  <div className="row-between">
                    <span className="course-title">{s.title}</span>
                    {live ? <span className="pill red">● Live now</span> : <span className="pill gray">Upcoming</span>}
                  </div>
                  <div className="course-desc" style={{ marginTop: 6 }}>{s.description}</div>
                  <div className="mini" style={{ marginTop: 8 }}>{new Date(s.scheduled_at).toLocaleString()} · {s.duration_minutes} min</div>
                  <div className="mini">Host: {s.host_name || "Admin"}</div>
                  <button className="btn primary" style={{ marginTop: 10 }} disabled={!live} onClick={() => setInRoom(s)}>
                    {live ? "Join session" : "Not started yet"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {inRoom && <ClassroomRoom roomName={inRoom.room_name} displayName={me.full_name} onClose={() => setInRoom(null)} />}
      </main>
    </div>
  );
}
