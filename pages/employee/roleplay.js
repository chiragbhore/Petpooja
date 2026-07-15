import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";
import VoiceRoleplay from "../../components/VoiceRoleplay";

export default function Roleplay() {
  const { loading, me } = useProfile("employee");
  const [scenarios, setScenarios] = useState([]);
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (loading) return;
    supabase.from("scenarios").select("*").order("created_at", { ascending: true })
      .then(({ data }) => setScenarios(data || []));
  }, [loading]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">Roleplay practice</h1>
        <p className="sub">Practice a live sales call against a realistic prospect. You'll be scored at the end.</p>

        {scenarios.length === 0 ? (
          <div className="card pad mini">No roleplay scenarios yet. Your admin will add some soon.</div>
        ) : (
          <div className="grid3">
            {scenarios.map((s) => (
              <div key={s.id} className="tile course-card">
                <div className="row-between">
                  <span className="course-title">{s.title}</span>
                  <span className={`pill diff-${s.difficulty}`}>{s.difficulty}</span>
                </div>
                <div className="course-desc">Prospect: {s.persona}</div>
                {s.goal && <div className="mini" style={{ background: "#f6f7f8", padding: "8px 10px", borderRadius: 8 }}>🎯 {s.goal}</div>}
                <button className="btn primary" style={{ marginTop: 4 }} onClick={() => setActive(s)}>Start practice</button>
              </div>
            ))}
          </div>
        )}

        {active && <VoiceRoleplay scenario={active} onClose={() => setActive(null)} />}
      </main>
    </div>
  );
}
