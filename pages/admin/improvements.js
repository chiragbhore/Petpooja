import { useEffect, useMemo, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

const PARAMETERS = [
  "Product Knowledge", "Understanding Customer Needs", "Mapping Customer Pain Points to Solutions",
  "Communication & Confidence", "Objection Handling", "Rapport Building", "Overall Sales Readiness",
];

export default function AreasOfImprovement() {
  const { loading, me } = useProfile("admin");
  const [employees, setEmployees] = useState([]);
  const [calls, setCalls] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const [{ data: emps }, { data: rows }] = await Promise.all([
        supabase.from("profiles").select("id, full_name").eq("role", "employee"),
        supabase.from("roleplay_results").select("*").order("created_at", { ascending: false }),
      ]);
      setEmployees(emps || []);
      setCalls(rows || []);
    })();
  }, [loading]);

  const summaries = useMemo(() => {
    return employees.map((e) => {
      const myCalls = calls.filter((c) => c.user_id === e.id);
      if (myCalls.length === 0) return { employee: e, calls: 0 };

      const paramSums = {}; const paramCounts = {};
      myCalls.forEach((c) => {
        PARAMETERS.forEach((p) => {
          const v = c.parameter_scores?.[p]?.score;
          if (typeof v === "number") { paramSums[p] = (paramSums[p] || 0) + v; paramCounts[p] = (paramCounts[p] || 0) + 1; }
        });
      });
      const paramAvgs = PARAMETERS.map((p) => ({
        name: p, avg: paramCounts[p] ? Math.round(paramSums[p] / paramCounts[p]) : null,
      })).filter((p) => p.avg !== null).sort((a, b) => a.avg - b.avg);

      const overallAvg = Math.round(myCalls.reduce((a, c) => a + (c.overall || 0), 0) / myCalls.length);

      const missedTally = {};
      myCalls.forEach((c) => {
        (c.vas_coverage || []).filter((v) => !v.identified).forEach((v) => {
          missedTally[v.service_name] = (missedTally[v.service_name] || 0) + 1;
        });
      });
      const topMissed = Object.entries(missedTally).sort((a, b) => b[1] - a[1]).slice(0, 5);

      const recentImprovements = myCalls.slice(0, 5).flatMap((c) =>
        (c.improvements || []).map((text) => ({ text, date: c.created_at }))
      ).slice(0, 8);

      return {
        employee: e,
        calls: myCalls.length,
        overallAvg,
        weakest: paramAvgs.slice(0, 3),
        topMissed,
        recentImprovements,
        lastCallDate: myCalls[0]?.created_at,
      };
    }).filter((s) => s.calls > 0).sort((a, b) => a.overallAvg - b.overallAvg);
  }, [employees, calls]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  const active = selected ? summaries.find((s) => s.employee.id === selected) : summaries[0];

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Areas of Improvement</h1>
        <p className="sub">A per-employee coaching view, built from every call they've had scored — weakest skills first, so you know exactly what feedback to give.</p>

        {summaries.length === 0 ? (
          <div className="card pad mini">No scored calls yet — this fills in as your team practices.</div>
        ) : (
          <div className="dash">
            <div className="stack">
              <div className="card">
                <table className="table">
                  <thead><tr><th>Employee</th><th>Avg score</th><th>Calls</th><th>Weakest area</th></tr></thead>
                  <tbody>
                    {summaries.map((s) => (
                      <tr
                        key={s.employee.id}
                        onClick={() => setSelected(s.employee.id)}
                        style={{ cursor: "pointer", background: active?.employee.id === s.employee.id ? "var(--input-bg)" : "transparent" }}
                      >
                        <td><b>{s.employee.full_name}</b></td>
                        <td><span className={`pill ${s.overallAvg < 50 ? "red" : "gray"}`}>{s.overallAvg}/100</span></td>
                        <td className="mini">{s.calls}</td>
                        <td className="mini">{s.weakest[0]?.name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="stack">
              {active && (
                <>
                  <div className="card pad">
                    <div className="card-head"><div style={{ fontWeight: 700 }}>{active.employee.full_name}</div></div>
                    <div className="mini" style={{ marginBottom: 12 }}>
                      {active.calls} scored calls · overall average {active.overallAvg}/100 · last practiced {new Date(active.lastCallDate).toLocaleDateString()}
                    </div>

                    <div className="kpi-label" style={{ marginBottom: 8 }}>Weakest skills (focus here first)</div>
                    {active.weakest.map((p) => (
                      <div key={p.name} className="row-between" style={{ padding: "6px 0" }}>
                        <span style={{ fontSize: 13 }}>{p.name}</span>
                        <span className="pill red">{p.avg}%</span>
                      </div>
                    ))}
                  </div>

                  {active.topMissed.length > 0 && (
                    <div className="card pad">
                      <div className="kpi-label" style={{ marginBottom: 8 }}>Most frequently missed opportunities</div>
                      <div className="mini" style={{ marginBottom: 10 }}>Pain points this employee tends to overlook across calls — good material for a targeted coaching conversation.</div>
                      {active.topMissed.map(([name, count]) => (
                        <div key={name} className="row-between" style={{ padding: "6px 0" }}>
                          <span style={{ fontSize: 13 }}>{name}</span>
                          <span className="pill gray">missed {count}×</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {active.recentImprovements.length > 0 && (
                    <div className="card pad">
                      <div className="kpi-label" style={{ marginBottom: 8 }}>Recent feedback notes</div>
                      <div className="mini" style={{ marginBottom: 10 }}>The AI's own improvement notes from their last few calls.</div>
                      {active.recentImprovements.map((item, i) => (
                        <div key={i} style={{ fontSize: 13, padding: "6px 0", borderTop: i > 0 ? "1px solid var(--line)" : "none" }}>
                          ✕ {item.text}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
