import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

const EVENT_LABEL = {
  call_start: "Call started",
  connected: "Connected",
  go_away_notice: "Google warned of upcoming disconnect",
  reconnect_attempt: "Reconnect attempt",
  reconnect_ok: "Reconnect succeeded",
  reconnect_failed: "Reconnect FAILED",
  reconnect_giveup: "Gave up reconnecting",
  interrupted: "Rep interrupted the AI",
  error: "Error",
  connection_closed: "Connection closed",
  call_ended_by_user: "Call ended (by rep)",
};
const PROBLEM_EVENTS = ["reconnect_failed", "reconnect_giveup", "error"];

export default function VoiceCallLogs() {
  const { loading, me } = useProfile("admin");
  const [logs, setLogs] = useState([]);
  const [employees, setEmployees] = useState({});
  const [filterEmp, setFilterEmp] = useState("all");
  const [problemsOnly, setProblemsOnly] = useState(false);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const [{ data: rows }, { data: emps }] = await Promise.all([
        supabase.from("voice_call_logs").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("profiles").select("id, full_name").eq("role", "employee"),
      ]);
      const map = {}; (emps || []).forEach((e) => { map[e.id] = e.full_name; });
      setEmployees(map);
      setLogs(rows || []);
    })();
  }, [loading]);

  const visible = logs
    .filter((l) => filterEmp === "all" || l.user_id === filterEmp)
    .filter((l) => !problemsOnly || PROBLEM_EVENTS.includes(l.event));

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Voice call connection logs</h1>
        <p className="sub">A behind-the-scenes record of every connect, reconnect, and error during roleplay calls — no dev tools needed.</p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <label className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
            <span>Filter by employee</span>
            <select value={filterEmp} onChange={(e) => setFilterEmp(e.target.value)}>
              <option value="all">All employees</option>
              {Object.entries(employees).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <button className={`chipbtn ${problemsOnly ? "on" : ""}`} onClick={() => setProblemsOnly(!problemsOnly)}>
            {problemsOnly ? "✓ " : ""}Show only problems
          </button>
        </div>

        <div className="card">
          <table className="table">
            <thead><tr><th>Employee</th><th>Event</th><th>Detail</th><th>Call time</th><th>When</th></tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={5} className="mini" style={{ padding: 20 }}>No logs yet — they'll appear here as employees practice calls.</td></tr>}
              {visible.map((l) => (
                <tr key={l.id}>
                  <td><b>{employees[l.user_id] || "—"}</b></td>
                  <td>
                    <span className={`pill ${PROBLEM_EVENTS.includes(l.event) ? "red" : "gray"}`}>
                      {EVENT_LABEL[l.event] || l.event}
                    </span>
                  </td>
                  <td className="mini">{l.detail || "—"}</td>
                  <td className="mini">{l.elapsed_seconds != null ? `${Math.floor(l.elapsed_seconds / 60)}m ${l.elapsed_seconds % 60}s in` : "—"}</td>
                  <td className="mini">{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mini" style={{ marginTop: 10 }}>Showing the most recent 500 events across all employees.</p>
      </main>
    </div>
  );
}
