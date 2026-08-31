import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function QuizReview() {
  const { loading, me } = useProfile("admin");
  const [attempts, setAttempts] = useState([]);
  const [employees, setEmployees] = useState({});
  const [quizzes, setQuizzes] = useState({});
  const [open, setOpen] = useState(null); // attempt being reviewed
  const [pendingCount, setPendingCount] = useState(0);
  const [overrides, setOverrides] = useState({}); // questionId -> boolean
  const [imageUrls, setImageUrls] = useState({}); // path -> signed url
  const [finalizing, setFinalizing] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);

  const [tab, setTab] = useState("pending");

  const load = async () => {
    const [{ data: pending }, { data: completed }, { data: emps }, { data: qz }] = await Promise.all([
      supabase.from("quiz_attempts").select("*").eq("status", "pending_review").order("submitted_at", { ascending: true }),
      supabase.from("quiz_attempts").select("*").eq("status", "completed").order("submitted_at", { ascending: false }).limit(100),
      supabase.from("profiles").select("id, full_name").eq("role", "employee"),
      supabase.from("quizzes").select("id, title"),
    ]);
    const empMap = {}; (emps || []).forEach((e) => { empMap[e.id] = e.full_name; });
    const qzMap = {}; (qz || []).forEach((q) => { qzMap[q.id] = q.title; });
    setEmployees(empMap);
    setQuizzes(qzMap);
    setAttempts(tab === "pending" ? (pending || []) : (completed || []));
    setPendingCount((pending || []).length);
  };
  useEffect(() => { if (!loading) load(); }, [loading, tab]);

  const openAttempt = async (attempt) => {
    setOpen(attempt);
    setOverrides({});
    setReviewIndex(0);
    const paths = (attempt.ai_review || []).flatMap((r) => r.paths || []);
    const urls = {};
    for (const path of paths) {
      const { data } = await supabase.storage.from("quiz-screenshots").createSignedUrl(path, 3600);
      if (data?.signedUrl) urls[path] = data.signedUrl;
    }
    setImageUrls(urls);
  };

  const setOverride = (questionId, value) => setOverrides((prev) => ({ ...prev, [questionId]: value }));

  const finalize = async () => {
    if (!open) return;
    setFinalizing(true);
    const { data: questions } = await supabase.from("quiz_questions").select("*").eq("quiz_id", open.quiz_id);
    const total = (questions || []).length;

    let correctCount = 0;
    const updatedReview = (open.ai_review || []).map((r) => {
      const finalCorrect = overrides[r.questionId] !== undefined ? overrides[r.questionId] : r.correct;
      if (finalCorrect) correctCount += 1;
      return { ...r, adminOverride: overrides[r.questionId] !== undefined ? overrides[r.questionId] : null };
    });
    // add correct multiple-choice answers back into the count
    (questions || []).forEach((q) => {
      if (q.question_type !== "screenshot") {
        const a = (open.answers || {})[q.id];
        const correctSet = new Set(Array.isArray(q.correct_indices) ? q.correct_indices : [q.correct_index]);
        if (q.multi_correct) {
          const chosen = new Set(a?.chosenIndices || []);
          const matches = chosen.size === correctSet.size && [...chosen].every((i) => correctSet.has(i));
          if (matches) correctCount += 1;
        } else if (a?.chosenIndex !== undefined && correctSet.has(a.chosenIndex)) {
          correctCount += 1;
        }
      }
    });

    const { data: quiz } = await supabase.from("quizzes").select("pass_percent").eq("id", open.quiz_id).single();
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passed = score >= (quiz?.pass_percent || 70);

    await supabase.from("quiz_attempts").update({
      status: "completed", score, passed, ai_review: updatedReview,
      reviewed_at: new Date().toISOString(), reviewed_by: me.id,
    }).eq("id", open.id);

    // Once reviewed, the employee's raw answer screenshots are no longer
    // needed — clear them out of storage to save space. Their reference
    // examples (the admin's own library) are untouched, since those get
    // reused across every future attempt.
    const allSubmittedPaths = (open.ai_review || []).flatMap((r) => r.paths || []);
    if (allSubmittedPaths.length > 0) {
      await supabase.storage.from("quiz-screenshots").remove(allSubmittedPaths);
    }

    setFinalizing(false);
    setOpen(null);
    load();
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Assessment review</h1>
        <p className="sub">Screenshot answers the AI has graded, waiting on your final sign-off before the employee sees a score.</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button className={`chipbtn ${tab === "pending" ? "on" : ""}`} onClick={() => setTab("pending")}>Pending review{pendingCount > 0 ? ` (${pendingCount})` : ""}</button>
          <button className={`chipbtn ${tab === "completed" ? "on" : ""}`} onClick={() => setTab("completed")}>Completed scores</button>
        </div>

        <div className="card">
          <table className="table">
            <thead><tr><th>Employee</th><th>Assessment</th><th>Submitted</th><th>{tab === "pending" ? "AI preliminary score" : "Final score"}</th><th></th></tr></thead>
            <tbody>
              {attempts.length === 0 && <tr><td colSpan={5} className="mini" style={{ padding: 20 }}>{tab === "pending" ? "Nothing waiting on review right now." : "No completed assessments yet."}</td></tr>}
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td><b>{employees[a.user_id] || "—"}</b></td>
                  <td>{quizzes[a.quiz_id] || "Assessment"}</td>
                  <td className="mini">{new Date(a.submitted_at).toLocaleString()}</td>
                  <td><span className={`pill ${a.score >= 70 ? "red" : "gray"}`}>{a.score}%</span></td>
                  <td style={{ textAlign: "right" }}><button className="btn ghost" onClick={() => openAttempt(a)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {open && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }} onClick={() => setOpen(null)}>
            <div className="card pad scroll" style={{ width: 960, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div className="row-between" style={{ marginBottom: 12 }}>
                <b>{employees[open.user_id]} — {quizzes[open.quiz_id]}</b>
                <span style={{ cursor: "pointer", color: "#9aa0aa" }} onClick={() => setOpen(null)}>✕</span>
              </div>

              {(open.ai_review || []).length === 0 ? (
                <div className="mini" style={{ marginBottom: 14 }}>No screenshot answers to review for this attempt.</div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                    {open.ai_review.map((r, i) => {
                      const decided = overrides[r.questionId] !== undefined ? overrides[r.questionId] : r.correct;
                      return (
                        <button
                          key={i}
                          onClick={() => setReviewIndex(i)}
                          className="chipbtn"
                          style={{
                            width: 32, height: 32, padding: 0,
                            background: i === reviewIndex ? "#6d4aff" : decided ? "#e8f6ee" : "#fdeaec",
                            color: i === reviewIndex ? "#fff" : undefined,
                            borderColor: i === reviewIndex ? "#6d4aff" : undefined,
                          }}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>

                  {(() => {
                    const r = open.ai_review[reviewIndex];
                    const chosen = overrides[r.questionId] !== undefined ? overrides[r.questionId] : r.correct;
                    return (
                      <div className="tile" style={{ marginBottom: 16 }}>
                        <div className="mini" style={{ marginBottom: 4 }}>Question {reviewIndex + 1} of {open.ai_review.length}</div>
                        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{r.question}</div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                          {(r.paths || []).map((p, pi) => (
                            imageUrls[p] ? <img key={pi} src={imageUrls[p]} alt={`Submission ${pi + 1}`} style={{ maxWidth: 820, width: "100%", maxHeight: 700, objectFit: "contain", borderRadius: 10, border: "1px solid var(--line)" }} /> : (
                              <div key={pi} className="mini">Image no longer available (cleared after a previous review).</div>
                            )
                          ))}
                        </div>
                        <div className="mini" style={{ marginBottom: 14, fontSize: 14 }}>
                          AI verdict: <b style={{ color: r.correct ? "#15803d" : "var(--red-dark)" }}>{r.correct ? "Correct" : "Incorrect"}</b> — {r.feedback}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className={`chipbtn ${chosen === true ? "on" : ""}`} onClick={() => setOverride(r.questionId, true)}>Mark Correct</button>
                          <button className={`chipbtn ${chosen === false ? "on" : ""}`} onClick={() => setOverride(r.questionId, false)}>Mark Incorrect</button>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="row-between" style={{ marginBottom: 16 }}>
                    <button className="btn outline" disabled={reviewIndex === 0} onClick={() => setReviewIndex(reviewIndex - 1)}>← Previous</button>
                    <button className="btn outline" disabled={reviewIndex === open.ai_review.length - 1} onClick={() => setReviewIndex(reviewIndex + 1)}>Next →</button>
                  </div>
                </>
              )}

              <button className="btn primary full" disabled={finalizing} onClick={finalize}>
                {finalizing ? "Finalizing…" : "Finalize review & release score"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
