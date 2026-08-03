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
const BAND_COLORS = ["#f09595", "#f0b862", "#7fb2e6", "#6ee0a4"];

export default function AdminHome() {
  const { loading, me } = useProfile("admin");
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [paramData, setParamData] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [bandData, setBandData] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [upcoming, setUpcoming] = useState([]);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const [{ data: emps }, { data: courses }, { data: lessons }, { data: enr }, { data: prog }, { data: results }] =
        await Promise.all([
          supabase.from("profiles").select("id, full_name").eq("role", "employee"),
          supabase.from("courses").select("id"),
          supabase.from("lessons").select("id, course_id"),
          supabase.from("enrollments").select("user_id, course_id"),
          supabase.from("lesson_progress").select("user_id, lesson_id"),
          supabase.from("roleplay_results").select("user_id, overall, parameter_scores, created_at").order("created_at", { ascending: true }),
        ]);

      // completion per employee + bands for the donut
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

      // leaderboard
      const board = (emps || []).map((e) => {
        const mine = (results || []).filter((r) => r.user_id === e.id);
        const avg = mine.length ? Math.round(mine.reduce((a, r) => a + (r.overall || 0), 0) / mine.length) : 0;
        return { id: e.id, name: e.full_name, avg, plays: mine.length };
      }).filter((e) => e.plays > 0).sort((a, b) => b.avg - a.avg).slice(0, 6);

      // upcoming live classroom sessions
      const { data: sessions } = await supabase
        .from("live_sessions").select("*").gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true }).limit(3);

      setStats({ employees: (emps || []).length, courses: (courses || []).length, avg: n ? Math.round(sum / n) : 0, calls: (results || []).length });
      setParamData(paramChart);
      setTrendData(trend);
      setBandData(Object.entries(bands).map(([name, value]) => ({ name, value })));
      setLeaderboard(board);
      setUpcoming(sessions || []);
    })();
  }, [loading]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Welcome, {me.full_name.split(" ")[0]}</h1>
        <p className="sub">Petpooja PitchLab — admin console.</p>

        <div className="grid4">
          <div className="stat">
            <div className="stat-row">
              <div className="stat-icon">👥</div>
              <div><div className="stat-value">{stats?.employees ?? "…"}</div><div className="stat-label">Employees</div></div>
            </div>
          </div>
          <div className="stat">
            <div className="stat-row">
              <div className="stat-icon blue">📚</div>
              <div><div className="stat-value">{stats?.courses ?? "…"}</div><div className="stat-label">Courses</div></div>
            </div>
          </div>
          <div className="stat">
            <div className="stat-row">
              <div className="stat-icon orange">🎯</div>
              <div><div className="stat-value">{stats?.avg ?? "…"}%</div><div className="stat-label">Avg completion</div></div>
            </div>
          </div>
          <div className="stat">
            <div className="stat-row">
              <div className="stat-icon green">🎤</div>
              <div><div className="stat-value">{stats?.calls ?? "…"}</div><div className="stat-label">Roleplay calls scored</div></div>
            </div>
          </div>
        </div>

        <div className="dash" style={{ marginTop: 20 }}>
          <div className="stack">
            <div className="grid2">
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
                      <Bar dataKey="score" fill="#6d4aff" radius={[6, 6, 0, 0]} />
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
                        {bandData.map((entry, i) => <Cell key={i} fill={BAND_COLORS[i]} />)}
                      </Pie>
                      <Legend verticalAlign="bottom" height={30} wrapperStyle={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="mini" style={{ padding: 24 }}>No employees yet.</div>}
              </div>
            </div>

            <div className="card pad">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Team score trend</div>
              <div className="mini" style={{ marginBottom: 12 }}>Average roleplay score by day, last 30 days.</div>
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
              ) : <div className="mini" style={{ padding: 24 }}>Not enough calls yet to show a trend — needs at least 2 different days of activity.</div>}
            </div>

            <div className="grid2">
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
          </div>

          <div className="stack">
            <div className="card pad">
              <div className="card-head"><div style={{ fontWeight: 700 }}>🏆 Top performers</div></div>
              {leaderboard.length === 0 ? (
                <div className="mini">No scored calls yet on the team.</div>
              ) : (
                leaderboard.map((e, i) => (
                  <div key={e.id} className="lb-row">
                    <div className={`lb-rank ${i === 0 ? "g1" : i === 1 ? "g2" : i === 2 ? "g3" : ""}`}>{i + 1}</div>
                    <div className="lb-name">{e.name}</div>
                    <div className="lb-score">{e.avg}</div>
                  </div>
                ))
              )}
            </div>

            <div className="card pad">
              <div className="card-head"><div style={{ fontWeight: 700 }}>📅 Upcoming sessions</div></div>
              {upcoming.length === 0 ? (
                <div className="mini">No live sessions scheduled.</div>
              ) : (
                upcoming.map((s) => (
                  <div key={s.id} className="session" style={{ marginBottom: 12 }}>
                    <div className="session-icon">🎥</div>
                    <div>
                      <div className="session-title">{s.title}</div>
                      <div className="session-when">{new Date(s.scheduled_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))
              )}
              <button className="btn outline full" style={{ marginTop: 4 }} onClick={() => router.push("/admin/classroom")}>Manage classroom</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
