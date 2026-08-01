import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function CoachingNotes() {
  const { loading, me } = useProfile("admin");
  const [calls, setCalls] = useState([]);
  const [employees, setEmployees] = useState({});
  const [scenarios, setScenarios] = useState({});
  const [filterEmp, setFilterEmp] = useState("all");
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const [{ data: rows }, { data: emps }, { data: scs }] = await Promise.all([
        supabase.from("roleplay_results").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name").eq("role", "employee"),
        supabase.from("scenarios").select("id, title, account_name"),
      ]);
      const empMap = {}; (emps || []).forEach((e) => { empMap[e.id] = e.full_name; });
      const scMap = {}; (scs || []).forEach((s) => { scMap[s.id] = s; });
      setEmployees(empMap);
      setScenarios(scMap);
      setCalls(rows || []);
    })();
  }, [loading]);

  const openCall = async (call) => {
    setOpen(call);
    setDraft("");
    const { data } = await supabase.from("call_notes").select("*").eq("result_id", call.id).order("created_at", { ascending: true });
    setNotes(data || []);
  };

  const addNote = async () => {
    if (!draft.trim() || !open) return;
    setSaving(true);
    const { error } = await supabase.from("call_notes").insert({
      result_id: open.id, author_id: me.id, author_name: me.full_name, note: draft.trim(),
    });
    setSaving(false);
    if (error) { alert(error.message); return; }
    setDraft("");
    const { data } = await supabase.from("call_notes").select("*").eq("result_id", open.id).order("created_at", { ascending: true });
    setNotes(data || []);
  };

  const visible = filterEmp === "all" ? calls : calls.filter((c) => c.user_id === filterEmp);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Coaching notes</h1>
        <p className="sub">Leave written coaching feedback on any employee's practice call — they'll see it alongside their report.</p>

        <label className="field" style={{ maxWidth: 260, marginBottom: 14 }}>
          <span>Filter by employee</span>
          <select value={filterEmp} onChange={(e) => setFilterEmp(e.target.value)}>
            <option value="all">All employees</option>
            {Object.entries(employees).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>

        <div className="card">
          <table className="table">
            <thead><tr><th>Employee</th><th>Scenario</th><th>Date</th><th>Score</th><th></th></tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={5} className="mini" style={{ padding: 20 }}>No calls yet.</td></tr>}
              {visible.map((c) => {
                const sc = scenarios[c.scenario_id];
                return (
                  <tr key={c.id}>
                    <td><b>{employees[c.user_id] || "—"}</b></td>
                    <td>{sc?.title || "Scenario"}{sc?.account_name ? ` · ${sc.account_name}` : ""}</td>
                    <td className="mini">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td><span className={`pill ${c.overall >= 70 ? "red" : "gray"}`}>{c.overall}/100</span></td>
                    <td style={{ textAlign: "right" }}><button className="btn ghost" onClick={() => openCall(c)}>Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {open && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }} onClick={() => setOpen(null)}>
            <div className="card pad" style={{ width: 560, maxWidth: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div className="row-between" style={{ marginBottom: 12 }}>
                <b>{employees[open.user_id]} — {scenarios[open.scenario_id]?.title || "Scenario"}</b>
                <span style={{ cursor: "pointer", color: "#9aa0aa" }} onClick={() => setOpen(null)}>✕</span>
              </div>

              <div className="tile" style={{ marginBottom: 14 }}>
                <div className="kpi-label">Executive Summary</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{open.executive_summary}</div>
              </div>

              <div className="section-label" style={{ margin: "0 0 8px" }}>Coaching notes</div>
              {notes.length === 0 && <div className="mini" style={{ marginBottom: 12 }}>No notes yet — be the first to leave one.</div>}
              {notes.map((n) => (
                <div key={n.id} className="tile" style={{ marginBottom: 8 }}>
                  <div className="row-between mini"><b>{n.author_name || "Admin"}</b><span>{new Date(n.created_at).toLocaleString()}</span></div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{n.note}</div>
                </div>
              ))}

              <label className="field" style={{ marginTop: 14 }}>
                <span>Add a note</span>
                <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Good use of urgency here — try leading with this next time." />
              </label>
              <button className="btn primary" disabled={saving || !draft.trim()} onClick={addNote}>
                {saving ? "Saving…" : "Add note"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
