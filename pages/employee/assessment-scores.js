import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function MyAssessmentScores() {
  const { loading, me } = useProfile("employee");
  const [attempts, setAttempts] = useState([]);
  const [quizzes, setQuizzes] = useState({});

  const [open, setOpen] = useState(null);
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showCert, setShowCert] = useState(false);

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

  // Only reachable for a completed attempt — shows exactly what the
  // employee answered, and for anything marked wrong, what the correct
  // answer actually was.
  const openDetails = async (attempt) => {
    setOpen(attempt);
    setReviewIndex(0);
    const { data: questions } = await supabase.from("quiz_questions").select("*").eq("quiz_id", attempt.quiz_id).order("sort_order", { ascending: true });
    const aiReviewByQ = {};
    (attempt.ai_review || []).forEach((r) => { aiReviewByQ[r.questionId] = r; });
    const mcqOverrides = attempt.mcq_overrides || {};

    const items = [];
    for (const q of questions || []) {
      if (q.question_type === "screenshot") {
        const r = aiReviewByQ[q.id];
        const finalCorrect = r?.adminOverride !== null && r?.adminOverride !== undefined ? r.adminOverride : (r?.correct ?? false);
        items.push({
          type: "screenshot", question: q.question, paths: r?.paths || [],
          correct: finalCorrect, feedback: r?.feedback, referenceImages: q.reference_images || [],
        });
      } else {
        const a = (attempt.answers || {})[q.id];
        const correctSet = new Set(Array.isArray(q.correct_indices) ? q.correct_indices : [q.correct_index]);
        let baseCorrect;
        if (q.multi_correct) {
          const chosen = new Set(a?.chosenIndices || []);
          baseCorrect = chosen.size === correctSet.size && [...chosen].every((i) => correctSet.has(i));
        } else {
          baseCorrect = a?.chosenIndex !== undefined && correctSet.has(a.chosenIndex);
        }
        const finalCorrect = mcqOverrides[q.id] !== undefined ? mcqOverrides[q.id] : baseCorrect;
        items.push({
          type: "mcq", question: q.question, options: q.options || [], multiCorrect: q.multi_correct,
          correctIndices: [...correctSet], chosenIndex: a?.chosenIndex, chosenIndices: a?.chosenIndices || [],
          correct: finalCorrect,
        });
      }
    }
    setReviewItems(items);
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;
  const current = reviewItems[reviewIndex];

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">My Assessment Scores</h1>
        <p className="sub">Every assessment you've submitted, and its final result.</p>

        <div className="card">
          <table className="table">
            <thead><tr><th>Assessment</th><th>Submitted</th><th>Status</th><th>Score</th><th></th></tr></thead>
            <tbody>
              {attempts.length === 0 && <tr><td colSpan={5} className="mini" style={{ padding: 20 }}>No assessments submitted yet.</td></tr>}
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
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {a.status === "completed" && <button className="btn ghost sm" onClick={() => openDetails(a)}>View answers</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {open && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }} onClick={() => setOpen(null)}>
            <div className="card pad scroll" style={{ width: 800, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div className="row-between" style={{ marginBottom: 12 }}>
                <b>{quizzes[open.quiz_id]} — {open.score}%</b>
                <span style={{ cursor: "pointer", color: "#9aa0aa" }} onClick={() => setOpen(null)}>✕</span>
              </div>

              {open.passed && (
                <button className="btn outline" style={{ marginBottom: 16 }} onClick={() => setShowCert(true)}>🎓 View Certificate</button>
              )}

              {reviewItems.length === 0 ? (
                <div className="mini">This assessment has no questions.</div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                    {reviewItems.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => setReviewIndex(i)}
                        className="chipbtn"
                        style={{
                          width: 32, height: 32, padding: 0,
                          background: i === reviewIndex ? "#6d4aff" : item.correct ? "#e8f6ee" : "#fdeaec",
                          color: i === reviewIndex ? "#fff" : undefined,
                          borderColor: i === reviewIndex ? "#6d4aff" : undefined,
                        }}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>

                  {current && (
                    <div className="tile" style={{ marginBottom: 16 }}>
                      <div className="row-between" style={{ marginBottom: 8 }}>
                        <div className="mini">Question {reviewIndex + 1} of {reviewItems.length}</div>
                        <span className={`pill ${current.correct ? "" : "gray"}`} style={current.correct ? { background: "#e8f6ee", color: "#15803d" } : {}}>
                          {current.correct ? "✓ Correct" : "✕ Incorrect"}
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{current.question}</div>

                      {current.type === "screenshot" ? (
                        <>
                          <div className="mini" style={{ marginBottom: 6, fontWeight: 700 }}>Your submission:</div>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                            {current.paths.length === 0 && <div className="mini">Nothing was submitted for this question.</div>}
                            {current.paths.map((url, pi) => (
                              <img key={pi} src={url} alt={`Your submission ${pi + 1}`} style={{ maxWidth: 320, borderRadius: 10, border: "1px solid var(--line)" }} />
                            ))}
                          </div>
                          {!current.correct && current.referenceImages?.length > 0 && (
                            <>
                              <div className="mini" style={{ marginBottom: 6, fontWeight: 700, color: "var(--red-dark)" }}>What a correct answer should show:</div>
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                {current.referenceImages.map((url, pi) => (
                                  <img key={pi} src={url} alt={`Correct example ${pi + 1}`} style={{ maxWidth: 320, borderRadius: 10, border: "1px solid #15803d" }} />
                                ))}
                              </div>
                            </>
                          )}
                          {current.feedback && <div className="mini" style={{ marginTop: 10 }}>{current.feedback}</div>}
                        </>
                      ) : (
                        <div>
                          {current.options.map((opt, oi) => {
                            const isCorrectOption = current.correctIndices.includes(oi);
                            const wasChosen = current.multiCorrect ? current.chosenIndices.includes(oi) : current.chosenIndex === oi;
                            // Only reveal which option was correct if the employee actually got it wrong.
                            const showAsCorrect = !current.correct && isCorrectOption;
                            return (
                              <div key={oi} style={{
                                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, marginBottom: 6,
                                background: wasChosen ? (current.correct ? "#e8f6ee" : "#fdeaec") : "transparent",
                                border: showAsCorrect ? "1px solid #15803d" : "1px solid var(--line)",
                              }}>
                                <span style={{ fontSize: 14 }}>
                                  {wasChosen ? "☑" : "☐"} {opt}
                                  {wasChosen && <span className="mini" style={{ marginLeft: 8 }}>← your answer</span>}
                                  {showAsCorrect && <span style={{ color: "#15803d", marginLeft: 8, fontWeight: 700 }}>✓ correct answer</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="row-between">
                    <button className="btn outline" disabled={reviewIndex === 0} onClick={() => setReviewIndex(reviewIndex - 1)}>← Previous</button>
                    <button className="btn outline" disabled={reviewIndex === reviewItems.length - 1} onClick={() => setReviewIndex(reviewIndex + 1)}>Next →</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {showCert && open && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.6)", display: "grid", placeItems: "center", padding: 20, zIndex: 60 }} onClick={() => setShowCert(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", maxWidth: 700, width: "100%", borderRadius: 12 }}>
              <div id="certificate-printable" style={{ position: "relative", width: "100%", lineHeight: 0 }}>
                <img src="/certificate-template.png" alt="" style={{ width: "100%", display: "block" }} />
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "100%", textAlign: "center", fontFamily: "Georgia, serif" }}>
                  <div style={{ fontSize: "clamp(20px, 4vw, 34px)", fontWeight: 700, color: "#1a1a1a" }}>{me?.full_name}</div>
                </div>
                <div style={{ position: "absolute", bottom: "12%", left: "50%", transform: "translateX(-50%)", width: "100%", textAlign: "center", fontFamily: "Georgia, serif" }}>
                  <div style={{ fontSize: "clamp(11px, 1.6vw, 15px)", color: "#444" }}>
                    {quizzes[open.quiz_id]} · {new Date(open.reviewed_at || open.submitted_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · Score: {open.score}%
                  </div>
                </div>
              </div>
              <div className="no-print" style={{ display: "flex", gap: 10, padding: 16 }}>
                <button className="btn outline full" onClick={() => setShowCert(false)}>Close</button>
                <button className="btn primary full" onClick={() => window.print()}>⬇ Download as PDF</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
