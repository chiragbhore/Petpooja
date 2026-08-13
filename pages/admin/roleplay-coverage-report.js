import { useEffect, useMemo, useState, Fragment } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

const BAND_COLORS = ["#f09595", "#f0b862", "#7fb2e6", "#6ee0a4"];

export default function RoleplayCoverageReport() {
  const { loading, me } = useProfile("admin");
  const [scenarios, setScenarios] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [results, setResults] = useState([]);

  const [pickedScenario, setPickedScenario] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    const [{ data: scs }, { data: emps }, { data: asg }, { data: res }] = await Promise.all([
      supabase.from("scenarios").select("id, title, difficulty, category").order("created_at", { ascending: true }),
      supabase.from("profiles").select("id, full_name").eq("role", "employee").order("full_name", { ascending: true }),
      supabase.from("scenario_assignments").select("scenario_id, user_id"),
      supabase.from("roleplay_results").select("scenario_id, user_id, overall, created_at"),
    ]);
    setScenarios(scs || []);
    setEmployees(emps || []);
    setAssignments(asg || []);
    setResults(res || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleSelectAll = () => {
    if (selected.size === employees.length) setSelected(new Set());
    else setSelected(new Set(employees.map((e) => e.id)));
  };

  const bulkAssign = async () => {
    if (!pickedScenario || selected.size === 0) return;
    setBusy(true);
    setMsg(null);
    const already = new Set(assignments.filter((a) => a.scenario_id === pickedScenario).map((a) => a.user_id));
    const rows = [...selected]
      .filter((userId) => !already.has(userId))
      .map((userId) => ({ scenario_id: pickedScenario, user_id: userId, assigned_by: me.id }));

    if (rows.length > 0) {
      const { error } = await supabase.from("scenario_assignments").insert(rows);
      if (error) { setMsg(error.message); setBusy(false); return; }
    }
    const title = scenarios.find((s) => s.id === pickedScenario)?.title || "the scenario";
    setMsg(`✓ Assigned "${title}" to ${selected.size} employee${selected.size === 1 ? "" : "s"}.`);
    setSelected(new Set());
    setPickedScenario("");
    setBusy(false);
    load();
  };

  // Per-employee assignment/completion + team-wide stats & chart data, all
  // derived from the same three tables in one place.
  const { summaries, teamStats, bandData, scoreCompareData, trendData } = useMemo(() => {
    const doneSet = new Set(results.map((r) => r.scenario_id + "::" + r.user_id));
    const scoreByUser = {};
    results.forEach((r) => { (scoreByUser[r.user_id] = scoreByUser[r.user_id] || []).push(r.overall || 0); });

    const summaries = employees.map((e) => {
      const mine = assignments.filter((a) => a.user_id === e.id);
      const assignedCount = mine.length;
      const completedList = mine.filter((a) => doneSet.has(a.scenario_id + "::" + a.user_id));
      const pendingList = mine.filter((a) => !doneSet.has(a.scenario_id + "::" + a.user_id));
      const pct = assignedCount > 0 ? Math.round((completedList.length / assignedCount) * 100) : 0;
      const myScores = scoreByUser[e.id] || [];
      const avgScore = myScores.length ? Math.round(myScores.reduce((a, b) => a + b, 0) / myScores.length) : null;
      return {
        employee: e, assignedCount, completedCount: completedList.length, pendingCount: pendingList.length, pct, avgScore,
        pendingTitles: pendingList.map((p) => scenarios.find((s) => s.id === p.scenario_id)?.title || "Scenario"),
      };
    }).sort((a, b) => a.pct - b.pct);

    const totalAssigned = assignments.length;
    const totalCompleted = assignments.filter((a) => doneSet.has(a.scenario_id + "::" + a.user_id)).length;
    const totalPending = totalAssigned - totalCompleted;
    const overallPct = totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;
    const teamAvgScore = results.length ? Math.round(results.reduce((a, r) => a + (r.overall || 0), 0) / results.length) : 0;

    const bands = { "0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0 };
    summaries.forEach((s) => {
      if (s.assignedCount === 0) return;
      if (s.pct <= 25) bands["0-25%"] += 1;
      else if (s.pct <= 50) bands["25-50%"] += 1;
      else if (s.pct <= 75) bands["50-75%"] += 1;
      else bands["75-100%"] += 1;
    });
    const bandData = Object.entries(bands).map(([name, value]) => ({ name, value }));

    const scoreCompareData = summaries
      .filter((s) => s.avgScore !== null)
      .map((s) => ({ name: s.employee.full_name.split(" ")[0], score: s.avgScore }))
      .sort((a, b) => b.score - a.score);

    const byDay = {};
    results.forEach((r) => {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      (byDay[day] = byDay[day] || []).push(r.overall || 0);
    });
    const days = Object.keys(byDay).sort().slice(-30);
    const trendData = days.map((d) => ({ date: d.slice(5), avg: Math.round(byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length) }));

    return {
      summaries,
      teamStats: { totalAssigned, totalCompleted, totalPending, overallPct, teamAvgScore },
      bandData, scoreCompareData, trendData,
    };
  }, [employees, assignments, results, scenarios]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Roleplay Coverage Report</h1>
        <p className="sub">Assign practice in bulk, and see exactly how much your team has actually completed — with the full statistics behind it.</p>
        {msg && <div className={`msg ${msg.startsWith("✓") ? "ok" : "err"}`}>{msg}</div>}

        <div className="grid4" style={{ marginBottom: 20 }}>
          <div className="tile"><div className="kpi">{teamStats.totalAssigned}</div><div className="kpi-label">Total assigned</div></div>
          <div className="tile"><div className="kpi">{teamStats.totalCompleted}</div><div className="kpi-label">Completed</div></div>
          <div className="tile"><div className="kpi">{teamStats.totalPending}</div><div className="kpi-label">Pending</div></div>
          <div className="tile"><div className="kpi">{teamStats.overallPct}%</div><div className="kpi-label">Team completion</div></div>
        </div>

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Bulk-assign a scenario</div>
          <div className="grid2" style={{ marginBottom: 14 }}>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Scenario</span>
              <select value={pickedScenario} onChange={(e) => setPickedScenario(e.target.value)}>
                <option value="">Choose a scenario…</option>
                {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </label>
          </div>
          <div className="mini" style={{ fontWeight: 700, marginBottom: 8 }}>
            Select employees ({selected.size} selected)
            <button className="btn ghost sm" style={{ marginLeft: 10 }} onClick={toggleSelectAll}>
              {selected.size === employees.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {employees.map((e) => (
              <button key={e.id} className={`chipbtn ${selected.has(e.id) ? "on" : ""}`} onClick={() => toggleSelect(e.id)}>
                {selected.has(e.id) ? "✓ " : ""}{e.full_name}
              </button>
            ))}
            {employees.length === 0 && <span className="mini">No employees yet.</span>}
          </div>
          <button className="btn primary" disabled={!pickedScenario || selected.size === 0 || busy} onClick={bulkAssign}>
            {busy ? "Assigning…" : `Assign to ${selected.size || 0} employee${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>

        <div className="grid2" style={{ marginBottom: 20 }}>
          <div className="card pad">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Score comparison</div>
            <div className="mini" style={{ marginBottom: 12 }}>Average roleplay score per employee.</div>
            {scoreCompareData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={scoreCompareData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="score" fill="#6d4aff" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="mini" style={{ padding: 24 }}>No scored calls yet.</div>}
          </div>

          <div className="card pad">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Completion spread</div>
            <div className="mini" style={{ marginBottom: 12 }}>Employees grouped by % of assigned practice completed.</div>
            {bandData.some((d) => d.value > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={bandData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {bandData.map((entry, i) => <Cell key={i} fill={BAND_COLORS[i]} />)}
                  </Pie>
                  <Legend verticalAlign="bottom" height={30} wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="mini" style={{ padding: 24 }}>No assignments with progress yet.</div>}
          </div>
        </div>

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Team score trend</div>
          <div className="mini" style={{ marginBottom: 12 }}>Average score by day, last 30 days.</div>
          {trendData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="avg" stroke="#6d4aff" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="mini" style={{ padding: 24 }}>Not enough calls yet to show a trend.</div>}
        </div>

        <div className="section-label">Per-employee coverage</div>
        <div className="card">
          <table className="table">
            <thead><tr><th>Employee</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>% Complete</th><th>Avg score</th><th></th></tr></thead>
            <tbody>
              {summaries.length === 0 && <tr><td colSpan={7} className="mini" style={{ padding: 20 }}>No employees yet.</td></tr>}
              {summaries.map((s) => (
                <Fragment key={s.employee.id}>
                  <tr>
                    <td><b>{s.employee.full_name}</b></td>
                    <td className="mini">{s.assignedCount}</td>
                    <td className="mini">{s.completedCount}</td>
                    <td className="mini">{s.pendingCount}</td>
                    <td style={{ minWidth: 140 }}>
                      <div className="row-between" style={{ gap: 8 }}>
                        <div className="progress" style={{ flex: 1 }}><i style={{ width: `${s.pct}%` }} /></div>
                        <span className="mini" style={{ fontWeight: 700 }}>{s.pct}%</span>
                      </div>
                    </td>
                    <td>{s.avgScore !== null ? <span className={`pill ${s.avgScore >= 70 ? "red" : "gray"}`}>{s.avgScore}</span> : <span className="mini">—</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {s.pendingCount > 0 && (
                        <button className="btn ghost sm" onClick={() => setExpanded(expanded === s.employee.id ? null : s.employee.id)}>
                          {expanded === s.employee.id ? "Hide" : "View pending"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === s.employee.id && (
                    <tr>
                      <td colSpan={7} style={{ background: "var(--input-bg)" }}>
                        <div className="mini" style={{ fontWeight: 700, marginBottom: 6 }}>Still pending for {s.employee.full_name.split(" ")[0]}:</div>
                        <div className="mini">{s.pendingTitles.join(", ")}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
