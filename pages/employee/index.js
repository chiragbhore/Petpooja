import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../lib/useProfile";
import { loadEmployeeData, courseProgress, Ring } from "../../lib/lms";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
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
const MODE_ICON = { call: "📞", in_person: "🚪", demo: "🖥️" };

export default function EmployeeHome() {
  const { loading, me } = useProfile("employee");
  const router = useRouter();
  const [data, setData] = useState(null);
  const [radarData, setRadarData] = useState([]);
  const [callCount, setCallCount] = useState(0);
  const [avgScore, setAvgScore] = useState(null);
  const [recommended, setRecommended] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [upcoming, setUpcoming] = useState([]);

  useEffect(() => {
    if (loading || !me) return;
    loadEmployeeData(me.id).then(setData);

    (async () => {
      // --- skill radar + call stats ---
      const { data: results } = await supabase
        .from("roleplay_results").select("overall, parameter_scores, created_at")
        .eq("user_id", me.id).order("created_at", { ascending: true });
      const sums = {}; const counts = {};
      (results || []).forEach((r) => {
        PARAMETERS.forEach((p) => {
          const v = r.parameter_scores?.[p]?.score;
          if (typeof v === "number") { sums[p] = (sums[p] || 0) + v; counts[p] = (counts[p] || 0) + 1; }
        });
      });
      setRadarData(PARAMETERS.map((p) => ({ skill: SHORT_LABEL[p], you: counts[p] ? Math.round(sums[p] / counts[p]) : 0 })));
      setCallCount((results || []).length);
      if (results && results.length > 0) {
        setAvgScore(Math.round(results.reduce((a, r) => a + (r.overall || 0), 0) / results.length));
      }

      // --- recommended scenarios: open-library ones you haven't tried yet ---
      const { data: scenarios } = await supabase.from("scenarios").select("*").order("created_at", { ascending: true });
      const attemptedIds = new Set((results || []).map((r) => r.scenario_id).filter(Boolean));
      const open = (scenarios || []).filter((s) => !s.assigned_to || s.assigned_to === me.id);
      const notTried = open.filter((s) => !attemptedIds.has(s.id));
      setRecommended((notTried.length > 0 ? notTried : open).slice(0, 3));

      // --- team leaderboard ---
      const { data: emps } = await supabase.from("profiles").select("id, full_name").eq("role", "employee");
      const { data: allResults } = await supabase.from("roleplay_results").select("user_id, overall");
      const board = (emps || []).map((e) => {
        const mine = (allResults || []).filter((r) => r.user_id === e.id);
        const avg = mine.length ? Math.round(mine.reduce((a, r) => a + (r.overall || 0), 0) / mine.length) : 0;
        return { id: e.id, name: e.full_name, avg, plays: mine.length };
      }).filter((e) => e.plays > 0).sort((a, b) => b.avg - a.avg).slice(0, 6);
      setLeaderboard(board);

      // --- upcoming live classroom sessions ---
      const { data: sessions } = await supabase
        .from("live_sessions").select("*").gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true }).limit(3);
      setUpcoming(sessions || []);
    })();
  }, [loading, me]);

  if (loading || !data) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  const allLessons = data.courses.flatMap((c) => data.lessonsByCourse[c.id] || []);
  const overall = courseProgress(allLessons, data.completed);
  const hasScores = radarData.some((d) => d.you > 0);
  const nextCourse = data.courses.find((c) => courseProgress(data.lessonsByCourse[c.id] || [], data.completed).pct < 100);
  const nextCourseProgress = nextCourse ? courseProgress(data.lessonsByCourse[nextCourse.id] || [], data.completed) : null;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">Hi {me.full_name.split(" ")[0]} 👋</h1>
        <p className="sub">Welcome to PitchLab, Petpooja's sales training portal.</p>

        <div className="grid4">
          <div className="stat">
            <div className="stat-row">
              <div className="stat-icon">📚</div>
              <div><div className="stat-value">{overall.pct}%</div><div className="stat-label">Course completion</div></div>
            </div>
          </div>
          <div className="stat">
            <div className="stat-row">
              <div className="stat-icon green">🎤</div>
              <div><div className="stat-value">{callCount}</div><div className="stat-label">Roleplay calls</div></div>
            </div>
          </div>
          <div className="stat">
            <div className="stat-row">
              <div className="stat-icon orange">🎯</div>
              <div><div className="stat-value">{avgScore ?? "—"}</div><div className="stat-label">Average score</div></div>
            </div>
          </div>
          <div className="stat">
            <div className="stat-row">
              <div className="stat-icon blue">🏆</div>
              <div><div className="stat-value">{leaderboard.findIndex((e) => e.id === me.id) === -1 ? "—" : `#${leaderboard.findIndex((e) => e.id === me.id) + 1}`}</div><div className="stat-label">Team rank</div></div>
            </div>
          </div>
        </div>

        {nextCourse && (
          <>
            <div className="section-label">Continue learning</div>
            <div className="card pad continue" style={{ marginBottom: 22 }}>
              <div className="continue-media">
                <button className="play-btn" onClick={() => router.push(`/employee/course/${nextCourse.id}`)}>▶</button>
              </div>
              <div className="continue-body">
                <div>
                  {nextCourse.tag && <span className="pill">{nextCourse.tag}</span>}
                  <h3 style={{ marginTop: 8 }}>{nextCourse.title}</h3>
                  <p>{nextCourse.description}</p>
                </div>
                <div className="continue-foot">
                  <div className="bar"><i style={{ width: `${nextCourseProgress.pct}%` }} /></div>
                  <span className="bar-label">{nextCourseProgress.done}/{nextCourseProgress.total} lessons</span>
                  <button className="btn primary" onClick={() => router.push(`/employee/course/${nextCourse.id}`)}>Continue</button>
                </div>
              </div>
            </div>
          </>
        )}

        {recommended.length > 0 && (
          <>
            <div className="section-label">Recommended practice</div>
            <div className="grid3" style={{ marginBottom: 22 }}>
              {recommended.map((s) => (
                <div key={s.id} className="rec" onClick={() => router.push("/employee/roleplay")}>
                  <div className="rec-thumb">
                    {MODE_ICON[s.mode] || "📞"}
                    <span className="pill float">{s.difficulty}</span>
                  </div>
                  <div className="rec-body">
                    <h4>{s.title}</h4>
                    <div className="rec-meta">{s.category || "General"}</div>
                    <button className="btn subtle sm" onClick={(e) => { e.stopPropagation(); router.push("/employee/roleplay"); }}>Start practice</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="dash">
          <div className="stack">
            <div className="card pad">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Your skill profile</div>
              <div className="mini" style={{ marginBottom: 12 }}>Average score across all your scored calls, per skill.</div>
              {hasScores ? (
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="var(--line)" />
                    <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "var(--muted)" }} />
                    <Radar dataKey="you" stroke="#6d4aff" fill="#6d4aff" fillOpacity={0.35} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : <div className="mini" style={{ padding: 24 }}>Complete a roleplay call to see your skill profile.</div>}
            </div>

            <div className="section-label" style={{ margin: 0 }}>Your courses</div>
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
                        {c.tag && <span className="pill">{c.tag}</span>}
                      </div>
                      <div className="course-desc">{c.description}</div>
                      <div className="progress"><i style={{ width: `${p.pct}%` }} /></div>
                      <div className="mini">{p.done} of {p.total} lessons</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="stack">
            <div className="card pad">
              <div className="card-head"><div style={{ fontWeight: 700 }}>🏆 Top performers</div></div>
              {leaderboard.length === 0 ? (
                <div className="mini">No scored calls yet on the team.</div>
              ) : (
                leaderboard.map((e, i) => (
                  <div key={e.id} className={`lb-row ${e.id === me.id ? "me" : ""}`}>
                    <div className={`lb-rank ${i === 0 ? "g1" : i === 1 ? "g2" : i === 2 ? "g3" : ""}`}>{i + 1}</div>
                    <div className="lb-name">{e.name}{e.id === me.id ? " (you)" : ""}</div>
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
              <button className="btn outline full" style={{ marginTop: 4 }} onClick={() => router.push("/employee/classroom")}>View classroom</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
