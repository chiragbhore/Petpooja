import { useEffect, useMemo, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

const PARAMETERS = [
  "Product Knowledge", "Understanding Customer Needs", "Mapping Customer Pain Points to Solutions",
  "Communication & Confidence", "Objection Handling", "Rapport Building", "Overall Sales Readiness",
];

export default function MyImprovements() {
  const { loading, me } = useProfile("employee");
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    if (loading || !me) return;
    supabase.from("roleplay_results").select("*").eq("user_id", me.id).order("created_at", { ascending: false })
      .then(({ data }) => setCalls(data || []));
  }, [loading, me]);

  const summary = useMemo(() => {
    if (calls.length === 0) return null;

    const paramSums = {}; const paramCounts = {};
    calls.forEach((c) => {
      PARAMETERS.forEach((p) => {
        const v = c.parameter_scores?.[p]?.score;
        if (typeof v === "number") { paramSums[p] = (paramSums[p] || 0) + v; paramCounts[p] = (paramCounts[p] || 0) + 1; }
      });
    });
    const paramAvgs = PARAMETERS.map((p) => ({
      name: p, avg: paramCounts[p] ? Math.round(paramSums[p] / paramCounts[p]) : null,
    })).filter((p) => p.avg !== null).sort((a, b) => a.avg - b.avg);

    const overallAvg = Math.round(calls.reduce((a, c) => a + (c.overall || 0), 0) / calls.length);

    const missedTally = {};
    calls.forEach((c) => {
      (c.vas_coverage || []).filter((v) => !v.identified).forEach((v) => {
        missedTally[v.service_name] = (missedTally[v.service_name] || 0) + 1;
      });
    });
    const topMissed = Object.entries(missedTally).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const recentImprovements = calls.slice(0, 5).flatMap((c) =>
      (c.improvements || []).map((text) => ({ text }))
    ).slice(0, 8);

    return { overallAvg, weakest: paramAvgs.slice(0, 3), topMissed, recentImprovements, count: calls.length, lastCallDate: calls[0]?.created_at };
  }, [calls]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">My Areas of Improvement</h1>
        <p className="sub">A summary built from all your scored calls — your weakest skills first, so you know exactly what to work on next.</p>

        {!summary ? (
          <div className="card pad mini">No scored calls yet — complete a roleplay call to see your improvement summary here.</div>
        ) : (
          <div className="dash">
            <div className="stack">
              <div className="card pad">
                <div className="mini" style={{ marginBottom: 12 }}>
                  {summary.count} scored calls · overall average {summary.overallAvg}/100 · last practiced {new Date(summary.lastCallDate).toLocaleDateString()}
                </div>
                <div className="kpi-label" style={{ marginBottom: 8 }}>Weakest skills (focus here first)</div>
                {summary.weakest.map((p) => (
                  <div key={p.name} className="row-between" style={{ padding: "6px 0" }}>
                    <span style={{ fontSize: 13 }}>{p.name}</span>
                    <span className="pill red">{p.avg}%</span>
                  </div>
                ))}
              </div>

              {summary.topMissed.length > 0 && (
                <div className="card pad">
                  <div className="kpi-label" style={{ marginBottom: 8 }}>Opportunities you tend to miss</div>
                  <div className="mini" style={{ marginBottom: 10 }}>Real pain points that come up in calls but you haven't been catching.</div>
                  {summary.topMissed.map(([name, count]) => (
                    <div key={name} className="row-between" style={{ padding: "6px 0" }}>
                      <span style={{ fontSize: 13 }}>{name}</span>
                      <span className="pill gray">missed {count}×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="stack">
              {summary.recentImprovements.length > 0 && (
                <div className="card pad">
                  <div className="kpi-label" style={{ marginBottom: 8 }}>Recent feedback notes</div>
                  <div className="mini" style={{ marginBottom: 10 }}>From your last few call reports.</div>
                  {summary.recentImprovements.map((item, i) => (
                    <div key={i} style={{ fontSize: 13, padding: "6px 0", borderTop: i > 0 ? "1px solid var(--line)" : "none" }}>
                      ✕ {item.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
