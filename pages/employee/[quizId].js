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
  const [answers, setAnswers] = useState({}); // questionId -> chosen index
  const [result, setResult] = useState(null); // {score, passed}
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

  const pick = (questionId, index) => setAnswers({ ...answers, [questionId]: index });

  const submit = async () => {
    if (Object.keys(answers).length < questions.length) { setMsg("Please answer every question before submitting."); return; }
    setMsg(null);
    setSubmitting(true);
    let correct = 0;
    questions.forEach((q) => { if (answers[q.id] === q.correct_index) correct += 1; });
    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= (quiz.pass_percent || 70);

    const { error } = await supabase.from("quiz_attempts").insert({
      quiz_id: quizId, user_id: me.id, score, passed, answers,
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
                <div style={{ fontWeight: 700, marginBottom: 10 }}>{i + 1}. {q.question}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {q.options.map((opt, oi) => (
                    <label key={oi} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: answers[q.id] === oi ? "#fdeaec" : "var(--input-bg)", cursor: "pointer" }}>
                      <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => pick(q.id, oi)} style={{ width: "auto" }} />
                      <span style={{ fontSize: 14 }}>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {questions.length === 0 ? (
              <div className="card pad mini">This quiz has no questions yet.</div>
            ) : (
              <button className="btn primary full" disabled={submitting} onClick={submit}>{submitting ? "Submitting…" : "Submit answers"}</button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
