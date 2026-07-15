import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function MyCalls() {
  const { loading, me } = useProfile("employee");
  const [calls, setCalls] = useState([]);
  const [scenarios, setScenarios] = useState({});
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (loading || !me) return;
    (async () => {
      const { data: rows } = await supabase
        .from("roleplay_results")
        .select("*")
        .eq("user_id", me.id)
        .order("created_at", { ascending: false });
      const { data: sc } = await supabase.from("scenarios").select("id, title");
      const map = {}; (sc || []).forEach((s) => { map[s.id] = s.title; });
      setScenarios(map);
      setCalls(rows || []);
    })();
  }, [loading, me]);

  const avg = calls.length ? Math.round(calls.reduce((a, c) => a + (c.overall || 0), 0) / calls.length) : 0;

  const openReport = async (call) => {
    let url = null;
    if (call.recording_path) {
      const { data } = await supabase.storage.from("call-recordings").createSignedUrl(call.recording_path, 3600);
      url = data?.signedUrl || null;
    }
    setOpen({ ...call, recording_url: url });
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">My calls</h1>
        <p className="sub">Every roleplay call you've completed, with your AI-generated pitch report.</p>

        <div className="grid3" style={{ marginBottom: 20 }}>
          <div className="tile"><div className="kpi">{calls.length}</div><div className="kpi-label">Calls completed</div></div>
          <div className="tile"><div className="kpi">{avg}</div><div className="kpi-label">Average score</div></div>
          <div className="tile"><div className="kpi">{calls.filter((c) => c.recording_path).length}</div><div className="kpi-label">Recordings available</div></div>
        </div>

        <div className="card">
          <table className="table">
            <thead><tr><th>Scenario</th><th>Date</th><th>Score</th><th></th></tr></thead>
            <tbody>
              {calls.length === 0 && <tr><td colSpan={4} className="mini" style={{ padding: 20 }}>No calls yet — head to Roleplay to practice.</td></tr>}
              {calls.map((c) => (
                <tr key={c.id}>
                  <td><b>{scenarios[c.scenario_id] || "Scenario"}</b></td>
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
            <div className="card pad scroll" id="printable-report" style={{ width: 620, maxWidth: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div className="row-between no-print" style={{ marginBottom: 10 }}>
                <b>{scenarios[open.scenario_id] || "Scenario"}</b>
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
              <div className="grid2">
                {Object.entries(open.parameter_scores || {}).map(([name, v]) => (
                  <div key={name} className="tile">
                    <div className="row-between"><b style={{ fontSize: 13 }}>{name}</b><span className="pill red">{v.score}%</span></div>
                    <div className="mini" style={{ marginTop: 6 }}>{v.comment}</div>
                  </div>
                ))}
              </div>
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
