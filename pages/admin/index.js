import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
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

export default function AdminHome() {
  const { loading, me } = useProfile("admin");
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [paramData, setParamData] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [bandData, setBandData] = useState([]);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const [{ data: emps }, { data: courses }, { data: lessons }, { data: enr }, { data: prog }, { data: results }] =
        await Promise.all([
          supabase.from("profiles").select("id").eq("role", "employee"),
          supabase.from("courses").select("id"),
          supabase.from("lessons").select("id, course_id"),
          supabase.from("enrollments").select("user_id, course_id"),
          supabase.from("lesson_progress").select("user_id, lesson_id"),
          supabase.from("roleplay_results").select("user_id, overall, parameter_scores, created_at").order("created_at", { ascending: true }),
        ]);

      // average completion across employees + completion bands for the donut
      const lessonsByCourse = {};
      (lessons || []).forEach((l) => { (lessonsByCourse[l.course_id] = lessonsByCourse[l.course_id] || []).push(l.id); });
      const doneByUser = {};
      (prog || []).forEach((p) => { (doneByUser[p.user_id] = doneByUser[p.user_id] || new Set()).add(p.lesson_id); });

      let sum = 0, n = 0;
      const bands = { "0-25%": 0, "25-50%": 0, "50-75%": 0, "75-100%": 0 };
      (emps || []).forEach((e) => {
        const myCourses = (enr || []).filter((x) => x.user_id === e.id).map((x) => x.course_id);
        const total = myCourses.reduce((a, cid) => a + (lessonsByCourse[cid] || []).length, 0);
        const done = myCourses.reduce((a, cid) => a + (lessonsByCourse[cid] || []).filter((lid) => doneByUser[e.id]?.has(lid)).length, 0);
        const pct = total ? Math.round((done / total) * 100) : 0;
        if (total > 0) { sum += pct; n += 1; }
        if (pct <= 25) bands["0-25%"] += 1;
        else if (pct <= 50) bands["25-50%"] += 1;
        else if (pct <= 75) bands["50-75%"] += 1;
        else bands["75-100%"] += 1;
      });

      // team-wide average per audit parameter
      const paramSums = {}; const paramCounts = {};
      (results || []).forEach((r) => {
        PARAMETERS.forEach((p) => {
          const v = r.parameter_scores?.[p]?.score;
          if (typeof v === "number") { paramSums[p] = (paramSums[p] || 0) + v; paramCounts[p] = (paramCounts[p] || 0) + 1; }
        });
      });
      const paramChart = PARAMETERS.map((p) => ({
        name: SHORT_LABEL[p], score: paramCounts[p] ? Math.round(paramSums[p] / paramCounts[p]) : 0,
      }));

      // team average score trend, grouped by day, last 30 days
      const byDay = {};
      (results || []).forEach((r) => {
        const day = new Date(r.created_at).toISOString().slice(0, 10);
        (byDay[day] = byDay[day] || []).push(r.overall || 0);
      });
      const days = Object.keys(byDay).sort().slice(-30);
      const trend = days.map((d) => ({
        date: d.slice(5), avg: Math.round(byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length),
      }));

      setStats({ employees: (emps || []).length, courses: (courses || []).length, avg: n ? Math.round(sum / n) : 0, calls: (results || []).length });
      setParamData(paramChart);
      setTrendData(trend);
      setBandData(Object.entries(bands).map(([name, value]) => ({ name, value })));
    })();
  }, [loading]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  const bandColors = ["#f09595", "#f0b862", "#7fb2e6", "#6ee0a4"];

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Welcome, {me.full_name.split(" ")[0]}</h1>
        <p className="sub">Petpooja PitchLab — admin console.</p>

        <div className="grid3">
          <div className="tile"><div className="kpi">{stats?.employees ?? "…"}</div><div className="kpi-label">Employees</div></div>
          <div className="tile"><div className="kpi">{stats?.courses ?? "…"}</div><div className="kpi-label">Courses</div></div>
          <div className="tile"><div className="kpi">{stats?.avg ?? "…"}%</div><div className="kpi-label">Avg completion</div></div>
          <div className="tile"><div className="kpi">{stats?.calls ?? "…"}</div><div className="kpi-label">Roleplay calls scored</div></div>
        </div>

        <div className="grid2" style={{ marginTop: 20 }}>
          <div className="card pad">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Team strength by skill</div>
            <div className="mini" style={{ marginBottom: 12 }}>Average score across every scored call, per audit parameter.</div>
            {paramData.length > 0 && paramData.some((d) => d.score > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={paramData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="score" fill="#d42b3a" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="mini" style={{ padding: 24 }}>No scored calls yet.</div>}
          </div>

          <div className="card pad">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Team completion</div>
            <div className="mini" style={{ marginBottom: 12 }}>Employees grouped by course completion.</div>
            {bandData.some((d) => d.value > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={bandData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {bandData.map((entry, i) => <Cell key={i} fill={bandColors[i]} />)}
                  </Pie>
                  <Legend verticalAlign="bottom" height={30} wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="mini" style={{ padding: 24 }}>No employees yet.</div>}
          </div>
        </div>

        <div className="card pad" style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Team score trend</div>
          <div className="mini" style={{ marginBottom: 12 }}>Average roleplay score by day, last 30 days.</div>
          {trendData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="avg" stroke="#d42b3a" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="mini" style={{ padding: 24 }}>Not enough calls yet to show a trend — needs at least 2 different days of activity.</div>}
        </div>

        <div className="grid2" style={{ marginTop: 20 }}>
          <div className="card pad">
            <div style={{ fontWeight: 700 }}>Build training</div>
            <div className="mini" style={{ marginBottom: 12 }}>Create courses and roleplay scenarios.</div>
            <button className="btn primary" onClick={() => router.push("/admin/courses")}>Manage courses</button>
          </div>
          <div className="card pad">
            <div style={{ fontWeight: 700 }}>Your team</div>
            <div className="mini" style={{ marginBottom: 12 }}>Add people and assign them training.</div>
            <button className="btn dark" onClick={() => router.push("/admin/employees")}>Manage team</button>
          </div>
        </div>
      </main>
    </div>
  );
}
