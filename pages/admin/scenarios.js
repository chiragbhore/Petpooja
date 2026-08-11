import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

const CATEGORIES = ["Cold Call", "Discovery", "Objection Handling", "Closing", "Upsell", "General"];
const DIFFICULTIES = ["Easy", "Medium", "Hard", "Expert"];
const MODES = [
  { value: "call", label: "Phone Call" },
  { value: "in_person", label: "In-Person Visit" },
  { value: "demo", label: "Full Product Demo" },
];
const RESTAURANT_TYPES = [
  { value: "", label: "None / not specific" },
  { value: "dine_in", label: "Dine In Restaurant" },
  { value: "qsr", label: "QSR Outlet" },
  { value: "cloud_kitchen", label: "Cloud Kitchen" },
];
const VOICES = [
  { group: "Female", options: [
    { value: "Kore", label: "Kore - Firm, professional" },
    { value: "Aoede", label: "Aoede - Breezy, easygoing" },
    { value: "Leda", label: "Leda - Youthful, friendly" },
    { value: "Zephyr", label: "Zephyr - Bright, energetic" },
    { value: "Autonoe", label: "Autonoe - Bright, upbeat" },
    { value: "Despina", label: "Despina - Smooth, calm" },
  ]},
  { group: "Male", options: [
    { value: "Puck", label: "Puck - Upbeat, conversational" },
    { value: "Charon", label: "Charon - Deep, authoritative" },
    { value: "Fenrir", label: "Fenrir - Warm, excitable" },
    { value: "Orus", label: "Orus - Firm, direct" },
    { value: "Iapetus", label: "Iapetus - Clear, measured" },
    { value: "Algieba", label: "Algieba - Smooth, relaxed" },
  ]},
];
const blank = { title: "", difficulty: "Medium", category: "General", mode: "call", voice: "Kore", persona: "", product: "", traits: "", objections: "", goal: "", account_name: "", assigned_to: "", demo_stages: [], restaurant_type: "", selected_services: [] };

export default function AdminScenarios() {
  const { loading, me } = useProfile("admin");
  const [scenarios, setScenarios] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [filterCat, setFilterCat] = useState("all");
  const [filterDiff, setFilterDiff] = useState("all");
  const [filterMode, setFilterMode] = useState("all");

  const load = async () => {
    const { data } = await supabase.from("scenarios").select("*").order("created_at", { ascending: true });
    setScenarios(data || []);
    const { data: emps } = await supabase.from("profiles").select("id, full_name").eq("role", "employee").order("full_name", { ascending: true });
    setEmployees(emps || []);
    const { data: cat } = await supabase.from("vas_catalog").select("*").order("sort_order", { ascending: true });
    setCatalog(cat || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  const add = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!form.title.trim()) return;
    const cleanStages = (form.demo_stages || [])
      .map((s) => ({ title: s.title || "", brief: s.brief || "", checkpoints: (s.checkpoints || []).map((c) => c.trim()).filter(Boolean) }))
      .filter((s) => s.title.trim() || s.brief.trim() || s.checkpoints.length > 0);
    const payload = { ...form, assigned_to: form.assigned_to || null, demo_stages: cleanStages, restaurant_type: form.restaurant_type || null };
    delete payload.id;

    if (editingId) {
      const { error } = await supabase.from("scenarios").update(payload).eq("id", editingId);
      if (error) { setMsg(error.message); return; }
      setMsg("✓ Scenario updated.");
    } else {
      const { error } = await supabase.from("scenarios").insert(payload);
      if (error) { setMsg(error.message); return; }
    }
    setForm(blank);
    setEditingId(null);
    load();
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setForm({
      title: s.title || "", difficulty: s.difficulty || "Medium", category: s.category || "General",
      mode: s.mode || "call", voice: s.voice || "Kore", persona: s.persona || "", product: s.product || "",
      traits: s.traits || "", objections: s.objections || "", goal: s.goal || "",
      account_name: s.account_name || "", assigned_to: s.assigned_to || "",
      demo_stages: Array.isArray(s.demo_stages) ? s.demo_stages : [],
      restaurant_type: s.restaurant_type || "",
      selected_services: Array.isArray(s.selected_services) ? s.selected_services : [],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => { setEditingId(null); setForm(blank); setMsg(null); };
  const del = async (id) => {
    if (!confirm("Delete this scenario?")) return;
    await supabase.from("scenarios").delete().eq("id", id);
    if (editingId === id) cancelEdit();
    load();
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const setRestaurantType = (e) => {
    const value = e.target.value;
    const validNames = new Set(catalog.filter((c) => c.restaurant_type === value).map((c) => c.service_name));
    setForm({ ...form, restaurant_type: value, selected_services: (form.selected_services || []).filter((n) => validNames.has(n)) });
  };
  const toggleService = (name) => {
    const has = (form.selected_services || []).includes(name);
    setForm({ ...form, selected_services: has ? form.selected_services.filter((n) => n !== name) : [...(form.selected_services || []), name] });
  };

  const addStage = () => setForm({ ...form, demo_stages: [...form.demo_stages, { title: `Section ${form.demo_stages.length + 1}`, brief: "", checkpoints: [""] }] });
  const removeStage = (i) => setForm({ ...form, demo_stages: form.demo_stages.filter((_, idx) => idx !== i) });
  const updateStage = (i, key, value) => {
    const next = [...form.demo_stages];
    next[i] = { ...next[i], [key]: value };
    setForm({ ...form, demo_stages: next });
  };
  const addCheckpoint = (i) => {
    const next = [...form.demo_stages];
    next[i] = { ...next[i], checkpoints: [...(next[i].checkpoints || []), ""] };
    setForm({ ...form, demo_stages: next });
  };
  const updateCheckpoint = (i, ci, value) => {
    const next = [...form.demo_stages];
    const cps = [...(next[i].checkpoints || [])];
    cps[ci] = value;
    next[i] = { ...next[i], checkpoints: cps };
    setForm({ ...form, demo_stages: next });
  };
  const removeCheckpoint = (i, ci) => {
    const next = [...form.demo_stages];
    next[i] = { ...next[i], checkpoints: (next[i].checkpoints || []).filter((_, idx) => idx !== ci) };
    setForm({ ...form, demo_stages: next });
  };

  const modeLabel = (m) => (MODES.find((x) => x.value === m) || MODES[0]).label;
  const restaurantLabel = (v) => (RESTAURANT_TYPES.find((x) => x.value === v) || {}).label || "";
  const voiceLabel = (v) => {
    for (const g of VOICES) { const found = g.options.find((o) => o.value === v); if (found) return found.value + " (" + g.group + ")"; }
    return v || "Kore";
  };

  const visible = scenarios.filter((s) =>
    (filterCat === "all" || s.category === filterCat) &&
    (filterDiff === "all" || s.difficulty === filterDiff) &&
    (filterMode === "all" || (s.mode || "call") === filterMode)
  );

  const servicesForType = catalog.filter((c) => c.restaurant_type === form.restaurant_type);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Roleplay scenarios</h1>
        <p className="sub">Design the prospects your team practices against — over the phone, a face-to-face visit, or a full product demo.</p>
        {msg && <div className={`msg ${msg.startsWith("✓") ? "ok" : "err"}`}>{msg}</div>}

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>{editingId ? "Edit scenario" : "New scenario"}</div>
          <form onSubmit={add}>
            <div className="grid2">
              <label className="field"><span>Title</span><input value={form.title} onChange={set("title")} required /></label>
              <label className="field"><span>Mode</span>
                <select value={form.mode} onChange={set("mode")}>
                  {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select></label>
              <label className="field"><span>AI voice / character</span>
                <select value={form.voice} onChange={set("voice")}>
                  {VOICES.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </optgroup>
                  ))}
                </select></label>
              <label className="field"><span>Difficulty</span>
                <select value={form.difficulty} onChange={set("difficulty")}>
                  {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
                </select></label>
              <label className="field"><span>Category (sales skill)</span>
                <select value={form.category} onChange={set("category")}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select></label>
              <label className="field"><span>Restaurant type</span>
                <select value={form.restaurant_type} onChange={setRestaurantType}>
                  {RESTAURANT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select></label>
              <label className="field"><span>Prospect persona</span><input value={form.persona} onChange={set("persona")} placeholder="Vikram, owner of a 30-seat cafe" /></label>
              <label className="field"><span>Product being sold</span><input value={form.product} onChange={set("product")} placeholder="an all-in-one POS system" /></label>
              <label className="field"><span>Personality traits</span><input value={form.traits} onChange={set("traits")} placeholder="friendly but time-poor" /></label>
              <label className="field"><span>Main objections</span><input value={form.objections} onChange={set("objections")} placeholder="doesn't see the need for software" /></label>
              <label className="field"><span>Rep's goal</span><input value={form.goal} onChange={set("goal")} placeholder="Book a live demo" /></label>
              <label className="field"><span>Real account name (optional)</span><input value={form.account_name} onChange={set("account_name")} placeholder="e.g. Spice Route Kitchen — actual upcoming customer" /></label>
              <label className="field"><span>Assign to a specific employee (optional)</span>
                <select value={form.assigned_to} onChange={set("assigned_to")}>
                  <option value="">Open to everyone</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select></label>
            </div>

            {form.restaurant_type && (
              <div style={{ marginTop: 8, marginBottom: 18, background: "var(--input-bg)", borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Value-added services to bring into this pitch</div>
                <p className="mini" style={{ marginBottom: 12 }}>
                  Pick at least 5. The AI will bring up these specific operational pain points during the conversation and judge whether the rep spots the opportunity and pitches the right product — without ever naming the service or feeding the rep the answer.
                </p>
                {servicesForType.length === 0 ? (
                  <div className="mini">No services in the catalog for this restaurant type yet.</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {servicesForType.map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        className={`chipbtn ${(form.selected_services || []).includes(svc.service_name) ? "on" : ""}`}
                        onClick={() => toggleService(svc.service_name)}
                        title={svc.problem_solved}
                      >
                        {(form.selected_services || []).includes(svc.service_name) ? "✓ " : ""}{svc.service_name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mini" style={{ marginTop: 10 }}>
                  {(form.selected_services || []).length} selected{(form.selected_services || []).length < 5 && servicesForType.length >= 5 ? " — aim for at least 5" : ""}
                </div>
              </div>
            )}

            {form.mode === "demo" && (
              <div style={{ marginTop: 8, marginBottom: 18, background: "var(--input-bg)", borderRadius: 12, padding: 16 }}>
                <div className="row-between" style={{ marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Pitch stages</div>
                  <button type="button" className="btn outline" onClick={addStage}>+ Add section</button>
                </div>
                <p className="mini" style={{ marginBottom: 12 }}>
                  Break this demo into sections. The AI stays focused on each section's brief and won't move to the next until the rep has addressed its must-cover points.
                </p>

                {form.demo_stages.length === 0 && <div className="mini">No sections yet — the demo will run as one open-ended conversation. Add a section to structure it.</div>}

                {form.demo_stages.map((stage, i) => (
                  <div key={i} className="card pad" style={{ marginBottom: 12 }}>
                    <div className="row-between" style={{ marginBottom: 10 }}>
                      <input
                        value={stage.title}
                        onChange={(e) => updateStage(i, "title", e.target.value)}
                        placeholder={`Section ${i + 1} title`}
                        style={{ fontWeight: 700, border: "none", background: "transparent", padding: 0, fontSize: 14 }}
                      />
                      <button type="button" className="btn ghost" onClick={() => removeStage(i)}>Remove section</button>
                    </div>
                    <label className="field">
                      <span>What this section is about</span>
                      <input
                        value={stage.brief}
                        onChange={(e) => updateStage(i, "brief", e.target.value)}
                        placeholder="e.g. Introduce the billing dashboard and daily sales reports"
                      />
                    </label>
                    <label className="field" style={{ marginBottom: 6 }}><span>Must-cover points before moving on</span></label>
                    {(stage.checkpoints || []).map((cp, ci) => (
                      <div key={ci} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                        <input
                          value={cp}
                          onChange={(e) => updateCheckpoint(i, ci, e.target.value)}
                          placeholder="e.g. Explain how real-time inventory sync works"
                        />
                        <button type="button" className="btn ghost" onClick={() => removeCheckpoint(i, ci)}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="btn outline sm" onClick={() => addCheckpoint(i)}>+ Add point</button>
                  </div>
                ))}
              </div>
            )}

            <button className="btn primary">{editingId ? "Save changes" : "Create scenario"}</button>
            {editingId && <button type="button" className="btn ghost" style={{ marginLeft: 8 }} onClick={cancelEdit}>Cancel</button>}
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
                <span className={"pill diff-" + s.difficulty}>{s.difficulty}</span>
              </div>
              <div className="mini" style={{ marginTop: 4 }}>{s.category || "General"} · {modeLabel(s.mode)}</div>
              {s.restaurant_type && (
                <div className="mini" style={{ marginTop: 4 }}>
                  🏬 {restaurantLabel(s.restaurant_type)}
                  {Array.isArray(s.selected_services) && s.selected_services.length > 0 ? ` · ${s.selected_services.length} services` : ""}
                </div>
              )}
              {(s.account_name || s.assigned_to) && (
                <div className="mini" style={{ marginTop: 4, color: "var(--brand-700, var(--red-dark))" }}>
                  {s.account_name ? `📋 ${s.account_name}` : ""}
                  {s.assigned_to ? ` · 👤 ${employees.find((e) => e.id === s.assigned_to)?.full_name || "assigned"}` : ""}
                </div>
              )}
              <div className="mini">🎙️ {voiceLabel(s.voice)}</div>
              <div className="course-desc" style={{ marginTop: 8 }}>{s.persona}</div>
              {s.goal && <div className="mini" style={{ marginTop: 8 }}>🎯 {s.goal}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn outline" onClick={() => startEdit(s)}>Edit</button>
                <button className="btn danger" onClick={() => del(s.id)}>Delete</button>
              </div>
            </div>
          ))}
          {visible.length === 0 && <div className="mini">No scenarios match this filter.</div>}
        </div>
      </main>
    </div>
  );
}