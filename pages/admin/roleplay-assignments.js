import { useEffect, useMemo, useState, Fragment } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function RoleplayAssignments() {
  const { loading, me } = useProfile("admin");
  const [scenarios, setScenarios] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]); // {scenario_id, user_id}
  const [results, setResults] = useState([]); // {scenario_id, user_id} — completed calls

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
      supabase.from("roleplay_results").select("scenario_id, user_id"),
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

  // Per-employee: how many scenarios assigned, how many actually completed
  // (at least one scored call exists for that scenario+employee pair).
  const summaries = useMemo(() => {
    const doneSet = new Set(results.map((r) => r.scenario_id + "::" + r.user_id));
    return employees.map((e) => {
      const mine = assignments.filter((a) => a.user_id === e.id);
      const assignedCount = mine.length;
      const completedList = mine.filter((a) => doneSet.has(a.scenario_id + "::" + a.user_id));
      const pendingList = mine.filter((a) => !doneSet.has(a.scenario_id + "::" + a.user_id));
      const pct = assignedCount > 0 ? Math.round((completedList.length / assignedCount) * 100) : 0;
      return {
        employee: e, assignedCount, completedCount: completedList.length, pendingCount: pendingList.length, pct,
        pendingTitles: pendingList.map((p) => scenarios.find((s) => s.id === p.scenario_id)?.title || "Scenario"),
      };
    }).sort((a, b) => a.pct - b.pct); // least complete first
  }, [employees, assignments, results, scenarios]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Roleplay assignments</h1>
        <p className="sub">Assign practice scenarios to your team in bulk, and track exactly how much of it they've actually completed.</p>
        {msg && <div className={`msg ${msg.startsWith("✓") ? "ok" : "err"}`}>{msg}</div>}

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

        <div className="section-label">Completion tracking</div>
        <div className="card">
          <table className="table">
            <thead><tr><th>Employee</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>% Complete</th><th></th></tr></thead>
            <tbody>
              {summaries.length === 0 && <tr><td colSpan={6} className="mini" style={{ padding: 20 }}>No employees yet.</td></tr>}
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
                      <td colSpan={6} style={{ background: "var(--input-bg)" }}>
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
