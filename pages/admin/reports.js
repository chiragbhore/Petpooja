import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function AdminReports() {
  const { loading, me } = useProfile("admin");
  const [calls, setCalls] = useState([]);
  const [employees, setEmployees] = useState({});
  const [scenarios, setScenarios] = useState({});
  const [filterEmp, setFilterEmp] = useState("all");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const [{ data: rows }, { data: emps }, { data: scs }] = await Promise.all([
        supabase.from("roleplay_results").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name").eq("role", "employee"),
        supabase.from("scenarios").select("id, title"),
      ]);
      const empMap = {}; (emps || []).forEach((e) => { empMap[e.id] = e.full_name; });
      const scMap = {}; (scs || []).forEach((s) => { scMap[s.id] = s.title; });
      setEmployees(empMap);
      setScenarios(scMap);
      setCalls(rows || []);
    })();
  }, [loading]);

  const openReport = async (call) => {
    let url = null;
    if (call.recording_path) {
      const { data } = await supabase.storage.from("call-recordings").createSignedUrl(call.recording_path, 3600);
      url = data?.signedUrl || null;
    }
    setOpen({ ...call, recording_url: url });
  };

  const visible = filterEmp === "all" ? calls : calls.filter((c) => c.user_id === filterEmp);
  const avg = visible.length ? Math.round(visible.reduce((a, c) => a + (c.overall || 0), 0) / visible.length) : 0;

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Call reports</h1>
        <p className="sub">Every roleplay call across your team, with the full AI pitch report.</p>

        <div className="grid3" style={{ marginBottom: 16 }}>
          <div className="tile"><div className="kpi">{visible.length}</div><div className="kpi-label">Calls</div></div>
          <div className="tile"><div className="kpi">{avg}</div><div className="kpi-label">Average score</div></div>
          <div className="tile"><div className="kpi">{visible.filter((c) => c.recording_path).length}</div><div className="kpi-label">Recordings available</div></div>
        </div>

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
              {visible.map((c) => (
                <tr key={c.id}>
                  <td><b>{employees[c.user_id] || "—"}</b></td>
                  <td>{scenarios[c.scenario_id] || "Scenario"}</td>
                  <td className="mini">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td><span className={`pill ${c.overall >= 70 ? "red" : "gray"}`}>{c.overall}/100</span></td>
                  <td style={{ textAlign: "right" }}><button className="btn ghost" onClick={() => openReport(c)}>View report</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {open && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }} onClick={() => setOpen(null)}>
            <div id="printable-report" className="card pad scroll" style={{ width: 620, maxWidth: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div className="row-between no-print" style={{ marginBottom: 10 }}>
                <b>{employees[open.user_id]} — {scenarios[open.scenario_id] || "Scenario"}</b>
                <span style={{ cursor: "pointer", color: "#9aa0aa" }} onClick={() => setOpen(null)}>✕</span>
              </div>
              <div className="grid2" style={{ marginBottom: 12 }}>
                <div className="tile"><div className="kpi-label">Overall Score</div><div className="kpi">{open.overall}/100</div></div>
                <div className="tile"><div className="kpi-label">Priority Action</div><div style={{ fontSize: 13 }}>{open.priority_action}</div></div>
              </div>
              <div className="tile" style={{ marginBottom: 12 }}>
                <div className="kpi-label">Executive Summary</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{open.executive_summary}</div>
              </div>
              {open.progress_note && (
                <div className="tile" style={{ marginBottom: 12 }}>
                  <div className="kpi-label">Progress Note</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{open.progress_note}</div>
                </div>
              )}
              {open.strengths?.length > 0 && (
                <div className="tile" style={{ marginBottom: 12, background: "#e8f6ee", borderColor: "#cdead9" }}>
                  <div className="kpi-label" style={{ color: "#15803d" }}>Strengths</div>
                  {open.strengths.map((s, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}>✓ {s}</div>)}
                </div>
              )}
              {open.improvements?.length > 0 && (
                <div className="tile" style={{ marginBottom: 12, background: "#fdeaec", borderColor: "#f0c9cd" }}>
                  <div className="kpi-label" style={{ color: "var(--red-dark)" }}>Areas of Improvement</div>
                  {open.improvements.map((s, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}>✕ {s}</div>)}
                </div>
              )}
              <div className="kpi-label" style={{ margin: "16px 0 8px" }}>Evaluation Feedback</div>
              <div className="grid2">
                {Object.entries(open.parameter_scores || {}).map(([name, v]) => (
                  <div key={name} className="tile">
                    <div className="row-between"><b style={{ fontSize: 13 }}>{name}</b><span className="pill red">{v.score}%</span></div>
                    <div className="mini" style={{ marginTop: 6 }}>{v.comment}</div>
                  </div>
                ))}
              </div>
              <div className="grid2" style={{ marginTop: 12 }}>
                <div className="tile"><div className="kpi-label">Empathy Score</div><div className="kpi" style={{ fontSize: 24 }}>{open.empathy_score}/100</div></div>
                <div className="tile"><div className="kpi-label">Adaptability Score</div><div className="kpi" style={{ fontSize: 24 }}>{open.adaptability_score}/100</div></div>
              </div>
              {open.coachable_moments?.length > 0 && (
                <>
                  <div className="kpi-label" style={{ margin: "16px 0 8px" }}>Coachable Moments</div>
                  {open.coachable_moments.map((m, i) => (
                    <div key={i} className="tile" style={{ marginBottom: 10 }}>
                      <div className="mini">Turn {m.turn}</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}><b>They said:</b> {m.said}</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}><b>Why it matters:</b> {m.why_it_matters}</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}><b>Better approach:</b> {m.better_approach}</div>
                    </div>
                  ))}
                </>
              )}
              {open.recording_url ? (
                <a href={open.recording_url} target="_blank" rel="noreferrer" className="btn outline full no-print" style={{ marginTop: 14 }}>⬇ Download call recording</a>
              ) : (
                <div className="mini no-print" style={{ marginTop: 14 }}>Recording unavailable (older than 30 days, or none was captured).</div>
              )}
              <button className="btn dark full no-print" style={{ marginTop: 8 }} onClick={() => window.print()}>⬇ Download report as PDF</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
