import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

const CATEGORIES = ["Cold Call", "Discovery", "Objection Handling", "Closing", "Upsell", "General"];
const DIFFICULTIES = ["Easy", "Medium", "Hard", "Expert"];
const MODES = [
  { value: "call", label: "Phone Call" },
  { value: "in_person", label: "In-Person Visit" },
];
const blank = { title: "", difficulty: "Medium", category: "General", mode: "call", persona: "", product: "", traits: "", objections: "", goal: "" };

export default function AdminScenarios() {
  const { loading, me } = useProfile("admin");
  const [scenarios, setScenarios] = useState([]);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState(null);
  const [filterCat, setFilterCat] = useState("all");
  const [filterDiff, setFilterDiff] = useState("all");
  const [filterMode, setFilterMode] = useState("all");

  const load = async () => {
    const { data } = await supabase.from("scenarios").select("*").order("created_at", { ascending: true });
    setScenarios(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  const add = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!form.title.trim()) return;
    const { error } = await supabase.from("scenarios").insert(form);
    if (error) { setMsg(error.message); return; }
    setForm(blank);
    load();
  };
  const del = async (id) => { if (confirm("Delete this scenario?")) { await supabase.from("scenarios").delete().eq("id", id); load(); } };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const modeLabel = (m) => (MODES.find((x) => x.value === m) || MODES[0]).label;

  const visible = scenarios.filter((s) =>
    (filterCat === "all" || s.category === filterCat) &&
    (filterDiff === "all" || s.difficulty === filterDiff) &&
    (filterMode === "all" || (s.mode || "call") === filterMode)
  );

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Roleplay scenarios</h1>
        <p className="sub">Design the prospects your team practices against — over the phone or a face-to-face visit.</p>
        {msg && <div className="msg err">{msg}</div>}

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>New scenario</div>
          <form onSubmit={add}>
            <div className="grid2">
              <label className="field"><span>Title</span><input value={form.title} onChange={set("title")} required /></label>
              <label className="field"><span>Mode</span>
                <select value={form.mode} onChange={set("mode")}>
                  {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select></label>
              <label className="field"><span>Difficulty</span>
                <select value={form.difficulty} onChange={set("difficulty")}>
                  {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
                </select></label>
              <label className="field"><span>Category (sales skill)</span>
                <select value={form.category} onChange={set("category")}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select></label>
              <label className="field"><span>Prospect persona</span><input value={form.persona} onChange={set("persona")} placeholder="Vikram, owner of a 30-seat cafe" /></label>
              <label className="field"><span>Product being sold</span><input value={form.product} onChange={set("product")} placeholder="an all-in-one POS system" /></label>
              <label className="field"><span>Personality traits</span><input value={form.traits} onChange={set("traits")} placeholder="friendly but time-poor" /></label>
              <label className="field"><span>Main objections</span><input value={form.objections} onChange={set("objections")} placeholder="doesn't see the need for software" /></label>
              <label className="field"><span>Rep's goal</span><input value={form.goal} onChange={set("goal")} placeholder="Book a live demo" /></label>
            </div>
            <button className="btn primary">Create scenario</button>
          </form>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <label className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <span>Filter by mode</span>
            <select value={filterMode} onChange={(e) => setFilterMode(e.target.value)}>
              <option value="all">All modes</option>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <span>Filter by category</span>
            <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <span>Filter by difficulty</span>
            <select value={filterDiff} onChange={(e) => setFilterDiff(e.target.value)}>
              <option value="all">All difficulties</option>
              {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        </div>

        <div className="grid3">
          {visible.map((s) => (
            <div key={s.id} className="tile">
              <div className="row-between">
                <b>{s.title}</b>
                <span className={`pill diff-${s.difficulty}`}>{s.difficulty}</span>
              </div>
              <div className="mini" style={{ marginTop: 4 }}>{s.category || "General"} · {modeLabel(s.mode)}</div>
              <div className="course-desc" style={{ marginTop: 8 }}>{s.persona}</div>
              {s.goal && <div className="mini" style={{ marginTop: 8 }}>🎯 {s.goal}</div>}
              <button className="btn danger" style={{ marginTop: 12 }} onClick={() => del(s.id)}>Delete</button>
            </div>
          ))}
          {visible.length === 0 && <div className="mini">No scenarios match this filter.</div>}
        </div>
      </main>
    </div>
  );
}
