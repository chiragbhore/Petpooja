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
  const [answers, setAnswers] = useState({});
  const [skipped, setSkipped] = useState(new Set());
  const [timeLeft, setTimeLeft] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [current, setCurrent] = useState(0);
  const [showSubmitPopup, setShowSubmitPopup] = useState(false);
  const [showCert, setShowCert] = useState(false);

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

      // No retakes — if this employee already has a finished attempt
      // (completed or awaiting admin review), show that result instead of
      // letting them start over.
      const { data: alreadyDone } = await supabase
        .from("quiz_attempts").select("*")
        .eq("quiz_id", quizId).eq("user_id", me.id).in("status", ["completed", "pending_review"])
        .order("submitted_at", { ascending: false }).limit(1).maybeSingle();

      if (alreadyDone) {
        setResult({
          score: alreadyDone.score, passed: alreadyDone.passed,
          needsReview: alreadyDone.status === "pending_review", alreadyTaken: true,
          completedAt: alreadyDone.reviewed_at || alreadyDone.submitted_at,
        });
        setInitializing(false);
        return;
      }

      const { data: existing } = await supabase
        .from("quiz_attempts").select("*")
        .eq("quiz_id", quizId).eq("user_id", me.id).eq("status", "in_progress")
        .maybeSingle();

      if (existing) {
        setAttemptId(existing.id);
        setAnswers(existing.answers || {});
        if (q?.time_limit_minutes) {
          const elapsed = Math.floor((Date.now() - new Date(existing.started_at).getTime()) / 1000);
          setTimeLeft(Math.max(0, q.time_limit_minutes * 60 - elapsed));
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
      if (!autoSubmittedRef.current) { autoSubmittedRef.current = true; doSubmit(); }
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
    const cur = answers[question.id]?.chosenIndices || [];
    const next = cur.includes(index) ? cur.filter((i) => i !== index) : [...cur, index].sort();
    saveAnswer(question.id, { chosenIndices: next });
  };

  // Reads a File into base64 and uploads it through our own server to
  // Google Drive, returning a usable link — replaces the old direct
  // upload to Supabase Storage.
  const uploadFileToDrive = async (file, question) => {
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const filename = `${quizId}-${question.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${file.name}`;
    const res = await fetch("/api/drive-upload", {
      method: "POST", headers: await authHeader(),
      body: JSON.stringify({ base64Data, filename, mimeType: file.type || "application/octet-stream" }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Upload failed.");
    return json.url;
  };

  const doUpload = async (question, files) => {
    const existing = answers[question.id] || {};
    const existingPaths = existing.paths || [];
    const existingPreviews = existing.previews || [];
    const room = Math.max(0, 5 - existingPaths.length); // hard cap: 5 screenshots per answer
    const list = Array.from(files || []).slice(0, room);
    if (list.length === 0) return;
    setMsg(null);
    const newPreviews = list.map((f) => URL.createObjectURL(f));
    setAnswers((prev) => ({ ...prev, [question.id]: { ...existing, uploading: true, previews: [...existingPreviews, ...newPreviews] } }));
    try {
      const newPaths = [];
      for (const file of list) {
        const url = await uploadFileToDrive(file, question);
        newPaths.push(url);
      }
      // Append to whatever was already pasted, instead of replacing it —
      // this is what lets more than one paste build up into one answer.
      await saveAnswer(question.id, { paths: [...existingPaths, ...newPaths], previews: [...existingPreviews, ...newPreviews] });
    } catch (e) {
      setAnswers((prev) => ({ ...prev, [question.id]: { ...existing, error: e.message || "Upload failed." } }));
    }
  };

  const removeShot = (question, idx) => {
    const existing = answers[question.id] || {};
    const paths = (existing.paths || []).filter((_, i) => i !== idx);
    const previews = (existing.previews || []).filter((_, i) => i !== idx);
    saveAnswer(question.id, paths.length > 0 ? { paths, previews } : undefined);
  };

  const handlePaste = (question) => (e) => {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) { e.preventDefault(); doUpload(question, files); }
  };

  const isAnswered = (q) => {
    const a = answers[q.id];
    if (q.question_type === "screenshot") return a?.paths?.length > 0;
    if (q.multi_correct) return a?.chosenIndices?.length > 0;
    return a?.chosenIndex !== undefined;
  };
  const unfinished = questions.filter((q) => !isAnswered(q));

  const goNext = () => {
    if (!isAnswered(questions[current])) setSkipped((prev) => new Set(prev).add(questions[current].id));
    if (current < questions.length - 1) setCurrent(current + 1);
    else attemptFinish();
  };
  const goPrev = () => { if (current > 0) setCurrent(current - 1); };
  const jumpTo = (idx) => setCurrent(idx);

  const attemptFinish = () => {
    if (unfinished.length > 0) setShowSubmitPopup(true);
    else doSubmit();
  };

  const doSubmit = async () => {
    if (!attemptId) return;
    setMsg(null);
    setSubmitting(true);
    setShowSubmitPopup(false);
    if (timerRef.current) clearTimeout(timerRef.current);

    const res = await fetch("/api/submit-quiz", { method: "POST", headers: await authHeader(), body: JSON.stringify({ attemptId }) });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) { setMsg(json.error || "Could not submit. Please try again."); return; }
    setResult(json);
  };

  if (loading || initializing || !quiz) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  if (result) {
    const showCertificate = result.passed && !result.needsReview;
    return (
      <div className="shell">
        <Sidebar role="employee" me={me} />
        <main className="content">
          <h1 className="page">{quiz.title}</h1>
          <div className="card pad" style={{ textAlign: "center" }}>
            {result.alreadyTaken && (
              <div className="mini" style={{ marginBottom: 12, color: "#946200" }}>You've already completed this assessment — retakes aren't allowed.</div>
            )}
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
                    {result.passed ? "✓ Passed" : "Not passed"}
                  </span>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
              {showCertificate && <button className="btn outline" onClick={() => setShowCert(true)}>🎓 View Certificate</button>}
              <button className="btn primary" onClick={() => router.push("/employee/courses")}>Back to courses</button>
            </div>
          </div>
        </main>

        {showCert && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.6)", display: "grid", placeItems: "center", padding: 20, zIndex: 60 }} onClick={() => setShowCert(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", maxWidth: 700, width: "100%", borderRadius: 12 }}>
              <div id="certificate-printable" style={{ position: "relative", width: "100%", lineHeight: 0 }}>
                <img src="/certificate-template.png" alt="" style={{ width: "100%", display: "block" }} />
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "100%", textAlign: "center", fontFamily: "Georgia, serif" }}>
                  <div style={{ fontSize: "clamp(20px, 4vw, 34px)", fontWeight: 700, color: "#1a1a1a" }}>{me?.full_name}</div>
                </div>
                <div style={{ position: "absolute", bottom: "12%", left: "50%", transform: "translateX(-50%)", width: "100%", textAlign: "center", fontFamily: "Georgia, serif" }}>
                  <div style={{ fontSize: "clamp(11px, 1.6vw, 15px)", color: "#444" }}>
                    {quiz.title} · {result.completedAt ? new Date(result.completedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : new Date().toLocaleDateString()} · Score: {result.score}%
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
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="shell">
        <Sidebar role="employee" me={me} />
        <main className="content">
          <h1 className="page">{quiz.title}</h1>
          <div className="card pad mini">This quiz has no questions yet.</div>
        </main>
      </div>
    );
  }

  const q = questions[current];
  const a = answers[q.id];
  const answered = isAnswered(q);
  const isLast = current === questions.length - 1;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="link-back" onClick={() => router.back()}>← Back</div>
            <h1 className="page">{quiz.title}</h1>
            <p className="sub">Pass mark: {quiz.pass_percent}% · Question {current + 1} of {questions.length}</p>
          </div>
          {timeLeft !== null && (
            <span className={`pill ${timeLeft < 60 ? "red" : "gray"}`} style={{ fontVariantNumeric: "tabular-nums", fontSize: 16 }}>⏱ {formatClock(timeLeft)}</span>
          )}
        </div>
        {msg && <div className="msg err">{msg}</div>}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {questions.map((qq, i) => {
            const done = isAnswered(qq);
            const wasSkipped = skipped.has(qq.id) && !done;
            return (
              <button
                key={qq.id}
                onClick={() => jumpTo(i)}
                className="chipbtn"
                style={{
                  width: 32, height: 32, padding: 0,
                  background: i === current ? "#6d4aff" : done ? "#e8f6ee" : wasSkipped ? "#fff4e0" : "var(--input-bg)",
                  color: i === current ? "#fff" : undefined,
                  borderColor: i === current ? "#6d4aff" : undefined,
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        <div className="card pad" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>
            {q.question}
            {q.question_type === "screenshot" && <span className="pill red" style={{ marginLeft: 8 }}>📷 Screenshot</span>}
            {q.multi_correct && <span className="pill" style={{ marginLeft: 8 }}>☑ Select all that apply</span>}
          </div>

          {q.media_url && (
            <div style={{ marginBottom: 14 }}>
              {q.media_type === "video" ? (
                <video src={q.media_url} controls style={{ maxWidth: "100%", borderRadius: 10 }} />
              ) : (
                <img src={q.media_url} alt="Question reference" style={{ maxWidth: "100%", borderRadius: 10 }} />
              )}
            </div>
          )}

          {q.question_type === "screenshot" ? (
            <div>
              <div tabIndex={0} onPaste={handlePaste(q)} style={{ border: "2px dashed var(--line)", borderRadius: 10, padding: 20, textAlign: "center", cursor: "text", outline: "none" }}>
                <div style={{ fontSize: 26 }}>📋</div>
                <div className="mini" style={{ marginTop: 6 }}>Click here, then press <b>Ctrl+V</b> (or ⌘V on Mac) to paste your screenshot</div>
                <div className="mini">Paste again to add more — up to 5 total.</div>
              </div>
              {a?.previews?.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {a.previews.map((url, pi) => (
                    <div key={pi} style={{ position: "relative" }}>
                      <img src={url} alt={`Your screenshot ${pi + 1}`} style={{ maxWidth: 160, borderRadius: 10, display: "block" }} />
                      <button type="button" onClick={() => removeShot(q, pi)}
                        style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,.6)", color: "#fff", border: "none", borderRadius: "50%", width: 22, height: 22, cursor: "pointer" }}>✕</button>
                    </div>
                  ))}
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
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
          <button className="btn outline" onClick={goPrev} disabled={current === 0}>← Previous</button>
          <div style={{ display: "flex", gap: 10 }}>
            {!answered && <button className="btn ghost" onClick={goNext}>Skip for now</button>}
            <button className="btn primary" disabled={submitting} onClick={goNext}>
              {submitting ? "Submitting…" : isLast ? "Finish & Review" : "Next →"}
            </button>
          </div>
        </div>

        {showSubmitPopup && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}>
            <div className="card pad" style={{ width: 460, maxWidth: "100%" }}>
              <b>You still have {unfinished.length} unanswered question{unfinished.length === 1 ? "" : "s"}</b>
              <p className="mini" style={{ marginTop: 8, marginBottom: 12 }}>
                {unfinished.map((qq) => `Q${questions.indexOf(qq) + 1}`).join(", ")} — you can go back and answer them, or submit as-is.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn outline full" onClick={() => { setShowSubmitPopup(false); jumpTo(questions.indexOf(unfinished[0])); }}>Go back and answer</button>
                <button className="btn primary full" onClick={doSubmit} disabled={submitting}>{submitting ? "Submitting…" : "Submit anyway"}</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
