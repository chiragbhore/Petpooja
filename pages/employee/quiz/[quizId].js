import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../../lib/useProfile";
import { supabase } from "../../../lib/supabaseClient";
import Sidebar from "../../../components/Sidebar";

export default function TakeQuiz() {
  const { loading, me } = useProfile("employee");
  const router = useRouter();
  const { quizId } = router.query;

  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({}); // questionId -> chosen index (multiple choice)
  const [screenshots, setScreenshots] = useState({}); // questionId -> { paths: [], previews: [], correct, feedback, grading }
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (loading || !quizId) return;
    (async () => {
      const { data: q } = await supabase.from("quizzes").select("*").eq("id", quizId).single();
      const { data: qs } = await supabase.from("quiz_questions").select("*").eq("quiz_id", quizId).order("sort_order", { ascending: true });
      setQuiz(q);
      setQuestions(qs || []);
    })();
  }, [loading, quizId]);

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };
  };

  const pick = (questionId, index) => setAnswers({ ...answers, [questionId]: index });

  const uploadScreenshots = async (question, fileList) => {
    const files = Array.from(fileList || []).slice(0, 5); // up to 5 images per answer
    if (files.length === 0) return;
    setMsg(null);
    const previews = files.map((f) => URL.createObjectURL(f));
    setScreenshots((prev) => ({ ...prev, [question.id]: { grading: true, previews } }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const paths = [];
      for (const file of files) {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `${session.user.id}/${quizId}/${question.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("quiz-screenshots").upload(path, file, { upsert: false });
        if (upErr) throw new Error(upErr.message);
        paths.push(path);
      }

      const res = await fetch("/api/grade-screenshot", {
        method: "POST", headers: await authHeader(),
        body: JSON.stringify({ questionId: question.id, screenshotPaths: paths }),
      });
      const json = await res.json();
      if (!res.ok || !json.graded) throw new Error(json.error || "Could not review the screenshots.");

      setScreenshots((prev) => ({
        ...prev,
        [question.id]: { paths, previews, grading: false, correct: json.correct, feedback: json.feedback },
      }));
    } catch (e) {
      setScreenshots((prev) => ({ ...prev, [question.id]: { ...prev[question.id], grading: false, error: e.message || "Upload failed." } }));
    }
  };

  const allAnswered = questions.every((q) =>
    q.question_type === "screenshot" ? screenshots[q.id]?.correct !== undefined : answers[q.id] !== undefined
  );

  const submit = async () => {
    if (!allAnswered) { setMsg("Please answer (and let every screenshot finish being reviewed) before submitting."); return; }
    setMsg(null);
    setSubmitting(true);

    let correct = 0;
    const answerLog = {};
    questions.forEach((q) => {
      if (q.question_type === "screenshot") {
        const s = screenshots[q.id];
        if (s?.correct) correct += 1;
        answerLog[q.id] = { type: "screenshot", paths: s?.paths || [], correct: !!s?.correct, feedback: s?.feedback };
      } else {
        const isRight = answers[q.id] === q.correct_index;
        if (isRight) correct += 1;
        answerLog[q.id] = { type: "multiple_choice", chosenIndex: answers[q.id] };
      }
    });

    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= (quiz.pass_percent || 70);

    const { error } = await supabase.from("quiz_attempts").insert({
      quiz_id: quizId, user_id: me.id, score, passed, answers: answerLog,
    });
    if (error) { setMsg(error.message); setSubmitting(false); return; }
    setResult({ score, passed, correct, total: questions.length });
    setSubmitting(false);
  };

  if (loading || !quiz) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <div className="link-back" onClick={() => router.back()}>← Back</div>
        <h1 className="page">{quiz.title}</h1>
        <p className="sub">Pass mark: {quiz.pass_percent}%</p>
        {msg && <div className="msg err">{msg}</div>}

        {result ? (
          <div className="card pad" style={{ textAlign: "center" }}>
            <div className="kpi" style={{ fontSize: 44 }}>{result.score}%</div>
            <div className="kpi-label">{result.correct} of {result.total} correct</div>
            <div style={{ marginTop: 12 }}>
              <span className={`pill ${result.passed ? "red" : "gray"}`} style={result.passed ? { background: "#e8f6ee", color: "#15803d" } : {}}>
                {result.passed ? "✓ Passed" : "Not passed — you can retry"}
              </span>
            </div>
            <button className="btn primary" style={{ marginTop: 18 }} onClick={() => router.push("/employee/courses")}>Back to courses</button>
          </div>
        ) : (
          <>
            {questions.map((q, i) => (
              <div key={q.id} className="card pad" style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>
                  {i + 1}. {q.question}
                  {q.question_type === "screenshot" && <span className="pill red" style={{ marginLeft: 8 }}>📷 Screenshot</span>}
                </div>

                {q.question_type === "screenshot" ? (
                  <div>
                    <input
                      type="file" accept="image/*" multiple
                      onChange={(e) => uploadScreenshots(q, e.target.files)}
                    />
                    <div className="mini" style={{ marginTop: 4 }}>You can select multiple screenshots at once if your answer needs more than one.</div>

                    {screenshots[q.id]?.previews?.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        {screenshots[q.id].previews.map((url, pi) => (
                          <img key={pi} src={url} alt={`Your screenshot ${pi + 1}`} style={{ maxWidth: 160, borderRadius: 10 }} />
                        ))}
                      </div>
                    )}
                    {screenshots[q.id]?.grading && <p className="mini" style={{ marginTop: 8 }}>🔎 AI is reviewing your screenshots…</p>}
                    {screenshots[q.id]?.error && <p className="mini" style={{ marginTop: 8, color: "var(--red-dark)" }}>{screenshots[q.id].error} — try uploading again.</p>}
                    {screenshots[q.id]?.correct !== undefined && (
                      <div className="tile" style={{ marginTop: 10, background: screenshots[q.id].correct ? "#e8f6ee" : "#fdeaec" }}>
                        <b style={{ fontSize: 13, color: screenshots[q.id].correct ? "#15803d" : "var(--red-dark)" }}>
                          {screenshots[q.id].correct ? "✓ Looks correct" : "✕ Not quite"}
                        </b>
                        <div className="mini" style={{ marginTop: 4 }}>{screenshots[q.id].feedback}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(q.options || []).map((opt, oi) => (
                      <label key={oi} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: answers[q.id] === oi ? "#fdeaec" : "var(--input-bg)", cursor: "pointer" }}>
                        <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => pick(q.id, oi)} style={{ width: "auto" }} />
                        <span style={{ fontSize: 14 }}>{opt}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {questions.length === 0 ? (
              <div className="card pad mini">This quiz has no questions yet.</div>
            ) : (
              <button className="btn primary full" disabled={submitting || !allAnswered} onClick={submit}>
                {submitting ? "Submitting…" : "Submit answers"}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
