import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

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
        <p className="sub">Practice a live sales call against a realistic prospect.</p>

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

        {active && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }} onClick={() => setActive(null)}>
            <div className="card pad" style={{ width: 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <b>{active.title}</b>
                <span className="btn ghost" style={{ cursor: "pointer" }} onClick={() => setActive(null)}>✕</span>
              </div>
              <div style={{ border: "2px dashed var(--line)", borderRadius: 12, padding: 26, textAlign: "center" }}>
                <div style={{ fontSize: 34 }}>🎙️</div>
                <div style={{ fontWeight: 700, marginTop: 8 }}>Voice roleplay connects here</div>
                <p className="mini" style={{ marginTop: 6 }}>
                  Your Petpooja voice agent will run this call and score it. We'll wire it in as the final step.
                </p>
              </div>
              <div className="mini" style={{ marginTop: 14 }}>
                <b>Scenario brief</b><br />
                Persona: {active.persona}<br />
                {active.traits && <>Traits: {active.traits}<br /></>}
                {active.objections && <>Objections: {active.objections}<br /></>}
                {active.goal && <>Goal: {active.goal}</>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
