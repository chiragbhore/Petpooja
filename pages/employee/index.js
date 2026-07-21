import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../lib/useProfile";
import { loadEmployeeData, courseProgress, Ring } from "../../lib/lms";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const PARAMETERS = [
  "Product Knowledge", "Understanding Customer Needs", "Mapping Customer Pain Points to Solutions",
  "Communication & Confidence", "Objection Handling", "Rapport Building", "Overall Sales Readiness",
];
const SHORT_LABEL = {
  "Product Knowledge": "Product", "Understanding Customer Needs": "Needs",
  "Mapping Customer Pain Points to Solutions": "Pain→Fit", "Communication & Confidence": "Comms",
  "Objection Handling": "Objections", "Rapport Building": "Rapport", "Overall Sales Readiness": "Readiness",
};

export default function EmployeeHome() {
  const { loading, me } = useProfile("employee");
  const router = useRouter();
  const [data, setData] = useState(null);
  const [radarData, setRadarData] = useState([]);
  const [trendData, setTrendData] = useState([]);

  useEffect(() => {
    if (loading || !me) return;
    loadEmployeeData(me.id).then(setData);
    supabase.from("roleplay_results").select("overall, parameter_scores, created_at")
      .eq("user_id", me.id).order("created_at", { ascending: true })
      .then(({ data: results }) => {
        const sums = {}; const counts = {};
        (results || []).forEach((r) => {
          PARAMETERS.forEach((p) => {
            const v = r.parameter_scores?.[p]?.score;
            if (typeof v === "number") { sums[p] = (sums[p] || 0) + v; counts[p] = (counts[p] || 0) + 1; }
          });
        });
        setRadarData(PARAMETERS.map((p) => ({ skill: SHORT_LABEL[p], you: counts[p] ? Math.round(sums[p] / counts[p]) : 0 })));
        setTrendData((results || []).slice(-10).map((r, i) => ({ call: "Call " + (i + 1), score: r.overall || 0 })));
      });
  }, [loading, me]);

  if (loading || !data) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  const allLessons = data.courses.flatMap((c) => data.lessonsByCourse[c.id] || []);
  const overall = courseProgress(allLessons, data.completed);
  const hasScores = radarData.some((d) => d.you > 0);

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">Hi {me.full_name.split(" ")[0]} 👋</h1>
        <p className="sub">Welcome to PitchLab, Petpooja's sales training portal.</p>

        <div className="grid3">
          <div className="tile" style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Ring value={overall.pct} />
            <div><div className="kpi">{overall.pct}%</div><div className="kpi-label">Overall completion</div></div>
          </div>
          <div className="tile"><div className="kpi">{data.courses.length}</div><div className="kpi-label">Courses assigned</div></div>
          <div className="tile"><div className="kpi">{overall.done}/{overall.total}</div><div className="kpi-label">Lessons completed</div></div>
        </div>

        <div className="grid2" style={{ marginTop: 20 }}>
          <div className="card pad">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Your skill profile</div>
            <div className="mini" style={{ marginBottom: 12 }}>Average score across all your scored calls, per skill.</div>
            {hasScores ? (
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="var(--line)" />
                  <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "var(--muted)" }} />
                  <Radar dataKey="you" stroke="#d42b3a" fill="#d42b3a" fillOpacity={0.35} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            ) : <div className="mini" style={{ padding: 24 }}>Complete a roleplay call to see your skill profile.</div>}
          </div>

          <div className="card pad">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Your recent scores</div>
            <div className="mini" style={{ marginBottom: 12 }}>Your last {trendData.length || 0} scored calls.</div>
            {trendData.length > 1 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="call" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="score" stroke="#d42b3a" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <div className="mini" style={{ padding: 24 }}>Complete a couple of roleplay calls to see your trend.</div>}
          </div>
        </div>

        <div className="section-label">Your courses</div>
        {data.courses.length === 0 ? (
          <div className="card pad mini">No courses assigned yet. Your admin will assign training to you soon.</div>
        ) : (
          <div className="grid2">
            {data.courses.map((c) => {
              const p = courseProgress(data.lessonsByCourse[c.id] || [], data.completed);
              return (
                <div key={c.id} className="tile course-card" onClick={() => router.push(`/employee/course/${c.id}`)}>
                  <div className="row-between">
                    <span className="course-title">{c.title}</span>
                    {c.tag && <span className="pill red">{c.tag}</span>}
                  </div>
                  <div className="course-desc">{c.description}</div>
                  <div className="progress"><i style={{ width: `${p.pct}%` }} /></div>
                  <div className="mini">{p.done} of {p.total} lessons</div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
