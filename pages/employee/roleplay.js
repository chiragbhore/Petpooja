import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";
import VoiceRoleplay from "../../components/VoiceRoleplay";

const CATEGORIES = ["Cold Call", "Discovery", "Objection Handling", "Closing", "Upsell", "General"];
const DIFFICULTIES = ["Easy", "Medium", "Hard", "Expert"];
const MODES = [
  { value: "call", label: "Phone Call", icon: "📞" },
  { value: "in_person", label: "In-Person Visit", icon: "🚪" },
];

export default function Roleplay() {
  const { loading, me } = useProfile("employee");
  const [scenarios, setScenarios] = useState([]);
  const [active, setActive] = useState(null);
  const [filterCat, setFilterCat] = useState("all");
  const [filterDiff, setFilterDiff] = useState("all");
  const [filterMode, setFilterMode] = useState("all");

  useEffect(() => {
    if (loading) return;
    supabase.from("scenarios").select("*").order("created_at", { ascending: true })
      .then(({ data }) => setScenarios(data || []));
  }, [loading]);

  const modeInfo = (m) => MODES.find((x) => x.value === m) || MODES[0];

  const visible = scenarios.filter((s) =>
    (filterCat === "all" || s.category === filterCat) &&
    (filterDiff === "all" || s.difficulty === filterDiff) &&
    (filterMode === "all" || (s.mode || "call") === filterMode)
  );

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">Roleplay practice</h1>
        <p className="sub">Practice a live sales conversation — by phone or a face-to-face visit. You'll be scored at the end.</p>

        {scenarios.length === 0 ? (
          <div className="card pad mini">No roleplay scenarios yet. Your admin will add some soon.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <label className="field" style={{ marginBottom: 0, minWidth: 180 }}>
                <span>Mode</span>
                <select value={filterMode} onChange={(e) => setFilterMode(e.target.value)}>
                  <option value="all">All modes</option>
                  {MODES.map((m) => <option key={m.value} value={m.value}>{m.icon} {m.label}</option>)}
                </select>
              </label>
              <label className="field" style={{ marginBottom: 0, minWidth: 180 }}>
                <span>Skill / category</span>
                <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
                  <option value="all">All categories</option>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="field" style={{ marginBottom: 0, minWidth: 180 }}>
                <span>Difficulty</span>
                <select value={filterDiff} onChange={(e) => setFilterDiff(e.target.value)}>
                  <option value="all">All difficulties</option>
                  {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
            </div>

            {visible.length === 0 ? (
              <div className="card pad mini">No scenarios match this filter — try widening it.</div>
            ) : (
              <div className="grid3">
                {visible.map((s) => {
                  const mi = modeInfo(s.mode);
                  return (
                    <div key={s.id} className="tile course-card">
                      <div className="row-between">
                        <span className="course-title">{s.title}</span>
                        <span className={`pill diff-${s.difficulty}`}>{s.difficulty}</span>
                      </div>
                      <div className="mini">{mi.icon} {mi.label} · {s.category || "General"}</div>
                      <div className="course-desc">Prospect: {s.persona}</div>
                      {s.goal && <div className="mini" style={{ background: "#f6f7f8", padding: "8px 10px", borderRadius: 8 }}>🎯 {s.goal}</div>}
                      <button className="btn primary" style={{ marginTop: 4 }} onClick={() => setActive(s)}>Start practice</button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {active && <VoiceRoleplay scenario={active} onClose={() => setActive(null)} />}
      </main>
    </div>
  );
}
