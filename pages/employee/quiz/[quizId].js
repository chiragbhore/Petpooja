import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../../lib/useProfile";
import { supabase } from "../../../lib/supabaseClient";
import Sidebar from "../../../components/Sidebar";

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

export default function TakeQuiz() {
  const { loading, me } = useProfile("employee");
  const router = useRouter();
  const { quizId } = router.query;

  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [attemptId, setAttemptId] = useState(null);
  const [answers, setAnswers] = useState({}); // questionId -> { chosenIndex } | { chosenIndices } | { paths, previews }
  const [skipped, setSkipped] = useState(new Set());
  const [timeLeft, setTimeLeft] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);
  const [initializing, setInitializing] = useState(true);

  const timerRef = useRef(null);
  const autoSubmittedRef = useRef(false);

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };
  };

  useEffect(() => {
    if (loading || !quizId || !me) return;
    (async () => {
      const { data: q } = await supabase.from("quizzes").select("*").eq("id", quizId).single();
      const { data: qs } = await supabase.from("quiz_questions").select("*").eq("quiz_id", quizId).order("sort_order", { ascending: true });
      setQuiz(q);
      setQuestions(qs || []);

      const { data: existing } = await supabase
        .from("quiz_attempts").select("*")
        .eq("quiz_id", quizId).eq("user_id", me.id).eq("status", "in_progress")
        .maybeSingle();

      if (existing) {
        setAttemptId(existing.id);
        setAnswers(existing.answers || {});
        if (q?.time_limit_minutes) {
          const elapsed = Math.floor((Date.now() - new Date(existing.started_at).getTime()) / 1000);
          const remaining = Math.max(0, q.time_limit_minutes * 60 - elapsed);
          setTimeLeft(remaining);
        }
      } else {
        const { data: created } = await supabase
          .from("quiz_attempts")
          .insert({ quiz_id: quizId, user_id: me.id, status: "in_progress", started_at: new Date().toISOString(), answers: {}, score: 0, passed: false })
          .select().single();
        setAttemptId(created?.id || null);
        if (q?.time_limit_minutes) setTimeLeft(q.time_limit_minutes * 60);
      }
      setInitializing(false);
    })();
  }, [loading, quizId, me]);

  useEffect(() => {
    if (timeLeft === null || result) return;
    if (timeLeft <= 0) {
      if (!autoSubmittedRef.current) { autoSubmittedRef.current = true; submit(true); }
      return;
    }
    timerRef.current = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, result]);

  const saveAnswer = async (questionId, value) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    setSkipped((prev) => { const s = new Set(prev); s.delete(questionId); return s; });
    if (attemptId) await supabase.from("quiz_attempts").update({ answers: next }).eq("id", attemptId);
  };

  const pickSingle = (questionId, index) => saveAnswer(questionId, { chosenIndex: index });
  const toggleMulti = (question, index) => {
    const current = answers[question.id]?.chosenIndices || [];
    const next = current.includes(index) ? current.filter((i) => i !== index) : [...current, index].sort();
    saveAnswer(question.id, { chosenIndices: next });
  };

  const doUpload = async (question, files) => {
    const list = Array.from(files || []).slice(0, 5);
    if (list.length === 0) return;
    setMsg(null);
    const previews = list.map((f) => URL.createObjectURL(f));
    setAnswers((prev) => ({ ...prev, [question.id]: { uploading: true, previews } }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const paths = [];
      for (const file of list) {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `${session.user.id}/${quizId}/${question.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("quiz-screenshots").upload(path, file, { upsert: false });
        if (upErr) throw new Error(upErr.message);
        paths.push(path);
      }
      await saveAnswer(question.id, { paths, previews });
    } catch (e) {
      setAnswers((prev) => ({ ...prev, [question.id]: { error: e.message || "Upload failed." } }));
    }
  };

  // Paste-to-upload: focus the box and press Ctrl+V — no file picker needed.
  const handlePaste = (question) => (e) => {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      doUpload(question, files);
    }
  };

  const toggleSkip = (questionId) => {
    setSkipped((prev) => {
      const s = new Set(prev);
      if (s.has(questionId)) s.delete(questionId); else s.add(questionId);
      return s;
    });
  };

  const isAnswered = (q) => {
    const a = answers[q.id];
    if (q.question_type === "screenshot") return a?.paths?.length > 0;
    if (q.multi_correct) return a?.chosenIndices?.length > 0;
    return a?.chosenIndex !== undefined;
  };
  const unfinished = questions.filter((q) => !isAnswered(q));

  const submit = async (auto = false) => {
    if (!auto && unfinished.length > 0) {
      setMsg("Please finish every question before submitting — see the list below.");
      return;
    }
    if (!attemptId) return;
    setMsg(null);
    setSubmitting(true);
    if (timerRef.current) clearTimeout(timerRef.current);

    const res = await fetch("/api/submit-quiz", { method: "POST", headers: await authHeader(), body: JSON.stringify({ attemptId }) });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) { setMsg(json.error || "Could not submit. Please try again."); return; }
    setResult(json);
  };

  if (loading || initializing || !quiz) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="link-back" onClick={() => router.back()}>← Back</div>
            <h1 className="page">{quiz.title}</h1>
            <p className="sub">Pass mark: {quiz.pass_percent}%</p>
          </div>
          {timeLeft !== null && !result && (
            <span className={`pill ${timeLeft < 60 ? "red" : "gray"}`} style={{ fontVariantNumeric: "tabular-nums", fontSize: 16 }}>⏱ {formatClock(timeLeft)}</span>
          )}
        </div>
        {msg && <div className="msg err">{msg}</div>}

        {result ? (
          <div className="card pad" style={{ textAlign: "center" }}>
            {result.needsReview ? (
              <>
                <div style={{ fontSize: 40 }}>🕐</div>
                <div style={{ fontWeight: 700, marginTop: 8 }}>Submitted — under review</div>
                <p className="mini" style={{ marginTop: 6, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
                  Your answers have been reviewed by AI and are now waiting on a final check from your admin before your score is confirmed.
                </p>
              </>
            ) : (
              <>
                <div className="kpi" style={{ fontSize: 44 }}>{result.score}%</div>
                <div style={{ marginTop: 12 }}>
                  <span className={`pill ${result.passed ? "red" : "gray"}`} style={result.passed ? { background: "#e8f6ee", color: "#15803d" } : {}}>
                    {result.passed ? "✓ Passed" : "Not passed — you can retry"}
                  </span>
                </div>
              </>
            )}
            <button className="btn primary" style={{ marginTop: 18 }} onClick={() => router.push("/employee/courses")}>Back to courses</button>
          </div>
        ) : (
          <>
            {questions.map((q, i) => {
              const a = answers[q.id];
              const answered = isAnswered(q);
              const isSkipped = skipped.has(q.id) && !answered;
              return (
                <div key={q.id} className="card pad" style={{ marginBottom: 14, borderColor: isSkipped ? "#f0b862" : undefined }}>
                  <div className="row-between" style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700 }}>
                      {i + 1}. {q.question}
                      {q.question_type === "screenshot" && <span className="pill red" style={{ marginLeft: 8 }}>📷 Screenshot</span>}
                      {q.multi_correct && <span className="pill" style={{ marginLeft: 8 }}>☑ Select all that apply</span>}
                    </div>
                    {isSkipped && <span className="pill" style={{ background: "#fff4e0", color: "#946200" }}>Skipped</span>}
                  </div>

                  {q.question_type === "screenshot" ? (
                    <div>
                      <div
                        tabIndex={0}
                        onPaste={handlePaste(q)}
                        style={{ border: "2px dashed var(--line)", borderRadius: 10, padding: 20, textAlign: "center", cursor: "text", outline: "none" }}
                      >
                        <div style={{ fontSize: 26 }}>📋</div>
                        <div className="mini" style={{ marginTop: 6 }}>Click here, then press <b>Ctrl+V</b> (or ⌘V on Mac) to paste your screenshot</div>
                        <div className="mini">You can paste more than one if your answer needs it.</div>
                      </div>
                      {a?.previews?.length > 0 && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          {a.previews.map((url, pi) => <img key={pi} src={url} alt={`Your screenshot ${pi + 1}`} style={{ maxWidth: 160, borderRadius: 10 }} />)}
                        </div>
                      )}
                      {a?.uploading && <p className="mini" style={{ marginTop: 8 }}>Uploading…</p>}
                      {a?.error && <p className="mini" style={{ marginTop: 8, color: "var(--red-dark)" }}>{a.error} — try pasting again.</p>}
                      {answered && <p className="mini" style={{ marginTop: 8, color: "#15803d" }}>✓ Saved — this will be reviewed after you submit.</p>}
                    </div>
                  ) : q.multi_correct ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(q.options || []).map((opt, oi) => {
                        const checked = (a?.chosenIndices || []).includes(oi);
                        return (
                          <label key={oi} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: checked ? "#fdeaec" : "var(--input-bg)", cursor: "pointer" }}>
                            <input type="checkbox" checked={checked} onChange={() => toggleMulti(q, oi)} style={{ width: "auto" }} />
                            <span style={{ fontSize: 14 }}>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(q.options || []).map((opt, oi) => (
                        <label key={oi} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: a?.chosenIndex === oi ? "#fdeaec" : "var(--input-bg)", cursor: "pointer" }}>
                          <input type="radio" name={q.id} checked={a?.chosenIndex === oi} onChange={() => pickSingle(q.id, oi)} style={{ width: "auto" }} />
                          <span style={{ fontSize: 14 }}>{opt}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {!answered && (
                    <button type="button" className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => toggleSkip(q.id)}>
                      {isSkipped ? "Unskip" : "Skip for now"}
                    </button>
                  )}
                </div>
              );
            })}

            {questions.length === 0 ? (
              <div className="card pad mini">This quiz has no questions yet.</div>
            ) : (
              <>
                {unfinished.length > 0 && (
                  <div className="card pad" style={{ marginBottom: 14, background: "#fff4e0", borderColor: "#f0d9a8" }}>
                    <b style={{ fontSize: 13 }}>Still need answers for:</b>
                    <div className="mini" style={{ marginTop: 4 }}>
                      {unfinished.map((q) => `Q${questions.indexOf(q) + 1}`).join(", ")}
                    </div>
                  </div>
                )}
                <button className="btn primary full" disabled={submitting} onClick={() => submit(false)}>
                  {submitting ? "Submitting…" : "Submit answers"}
                </button>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
