import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function MyAssessmentScores() {
  const { loading, me } = useProfile("employee");
  const [attempts, setAttempts] = useState([]);
  const [quizzes, setQuizzes] = useState({});

  useEffect(() => {
    if (loading || !me) return;
    (async () => {
      const { data: att } = await supabase
        .from("quiz_attempts").select("*")
        .eq("user_id", me.id).neq("status", "in_progress")
        .order("submitted_at", { ascending: false });
      const { data: qz } = await supabase.from("quizzes").select("id, title");
      const map = {}; (qz || []).forEach((q) => { map[q.id] = q.title; });
      setQuizzes(map);
      setAttempts(att || []);
    })();
  }, [loading, me]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">My Assessment Scores</h1>
        <p className="sub">Every assessment you've submitted, and its final result.</p>

        <div className="card">
          <table className="table">
            <thead><tr><th>Assessment</th><th>Submitted</th><th>Status</th><th>Score</th></tr></thead>
            <tbody>
              {attempts.length === 0 && <tr><td colSpan={4} className="mini" style={{ padding: 20 }}>No assessments submitted yet.</td></tr>}
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td><b>{quizzes[a.quiz_id] || "Assessment"}</b></td>
                  <td className="mini">{a.submitted_at ? new Date(a.submitted_at).toLocaleString() : "—"}</td>
                  <td>
                    {a.status === "pending_review" ? (
                      <span className="pill" style={{ background: "#fff4e0", color: "#946200" }}>Under review</span>
                    ) : (
                      <span className={`pill ${a.passed ? "" : "gray"}`} style={a.passed ? { background: "#e8f6ee", color: "#15803d" } : {}}>
                        {a.passed ? "✓ Passed" : "Not passed"}
                      </span>
                    )}
                  </td>
                  <td>{a.status === "pending_review" ? <span className="mini">Pending</span> : <b>{a.score}%</b>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
