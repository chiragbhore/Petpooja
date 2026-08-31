import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

const blankQ = { question_type: "multiple_choice", question: "", options: ["", "", "", ""], multi_correct: false, correct_indices: [0], answer_guide: "", reference_images: [], media_url: "", media_type: "" };

export default function AdminQuizzes() {
  const { loading, me } = useProfile("admin");
  const [courses, setCourses] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [questionsByQuiz, setQuestionsByQuiz] = useState({});
  const [form, setForm] = useState({ course_id: "", title: "", pass_percent: 70, time_limit_minutes: "" });
  const [qForm, setQForm] = useState({}); // quizId -> question draft
  const [editingQ, setEditingQ] = useState({}); // quizId -> questionId being edited, or null
  const [msg, setMsg] = useState(null);
  const [refUploading, setRefUploading] = useState({});
  const [rescoring, setRescoring] = useState(false);

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };
  };

  const load = async () => {
    const [{ data: cs }, { data: qz }, { data: qs }] = await Promise.all([
      supabase.from("courses").select("id, title").order("sort_order", { ascending: true }),
      supabase.from("quizzes").select("*").order("created_at", { ascending: true }),
      supabase.from("quiz_questions").select("*").order("sort_order", { ascending: true }),
    ]);
    setCourses(cs || []);
    setQuizzes(qz || []);
    const map = {};
    (qs || []).forEach((q) => { (map[q.quiz_id] = map[q.quiz_id] || []).push(q); });
    setQuestionsByQuiz(map);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  const createQuiz = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!form.course_id || !form.title.trim()) { setMsg("Pick a course and enter a title."); return; }
    const { error } = await supabase.from("quizzes").insert({
      course_id: form.course_id, title: form.title, pass_percent: Number(form.pass_percent) || 70,
      time_limit_minutes: form.time_limit_minutes ? Number(form.time_limit_minutes) : null,
    });
    if (error) { setMsg(error.message); return; }
    setForm({ course_id: "", title: "", pass_percent: 70, time_limit_minutes: "" });
    load();
  };

  const delQuiz = async (id) => { if (confirm("Delete this quiz and all its questions?")) { await supabase.from("quizzes").delete().eq("id", id); load(); } };

  const getQForm = (quizId) => qForm[quizId] || blankQ;
  const setQ = (quizId, patch) => setQForm({ ...qForm, [quizId]: { ...getQForm(quizId), ...patch } });

  const uploadReferenceImages = async (quizId, files) => {
    if (!files || files.length === 0) return;
    setRefUploading((prev) => ({ ...prev, [quizId]: true }));
    setMsg(null);
    const draft = getQForm(quizId);
    const uploaded = [...(draft.reference_images || [])];
    const failures = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${quizId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("quiz-reference-images").upload(path, file, { upsert: false });
      if (error) failures.push(file.name + ": " + error.message);
      else uploaded.push(path);
    }
    setQ(quizId, { reference_images: uploaded });
    setRefUploading((prev) => ({ ...prev, [quizId]: false }));
    if (failures.length > 0) {
      setMsg("⚠ " + failures.length + " reference image(s) FAILED to upload: " + failures.join("; ") + ". If this mentions 'Bucket not found', the quiz-reference-images storage bucket needs to be created in Supabase first.");
    }
  };
  const removeReferenceImage = (quizId, path) => {
    const draft = getQForm(quizId);
    setQ(quizId, { reference_images: (draft.reference_images || []).filter((p) => p !== path) });
  };

  const uploadQuestionMedia = async (quizId, file) => {
    if (!file) return;
    setMsg(null);
    const isVideo = file.type.startsWith("video/");
    const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "png")).toLowerCase();
    const path = `${quizId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("quiz-question-media").upload(path, file, { upsert: false });
    if (error) {
      setMsg("⚠ Media upload failed: " + error.message + (error.message.includes("not found") ? " — the 'quiz-question-media' storage bucket needs to be created first." : ""));
      return;
    }
    const { data } = supabase.storage.from("quiz-question-media").getPublicUrl(path);
    setQ(quizId, { media_url: data.publicUrl, media_type: isVideo ? "video" : "image" });
  };
  const removeQuestionMedia = (quizId) => setQ(quizId, { media_url: "", media_type: "" });

  const toggleCorrect = (quizId, index) => {
    const draft = getQForm(quizId);
    if (draft.multi_correct) {
      const has = draft.correct_indices.includes(index);
      setQ(quizId, { correct_indices: has ? draft.correct_indices.filter((i) => i !== index) : [...draft.correct_indices, index].sort() });
    } else {
      setQ(quizId, { correct_indices: [index] });
    }
  };

  const startEdit = (quizId, q) => {
    setEditingQ({ ...editingQ, [quizId]: q.id });
    setQForm({
      ...qForm,
      [quizId]: {
        question_type: q.question_type,
        question: q.question,
        options: q.options || ["", "", "", ""],
        multi_correct: !!q.multi_correct,
        correct_indices: Array.isArray(q.correct_indices) ? q.correct_indices : [q.correct_index ?? 0],
        answer_guide: q.answer_guide || "",
        reference_images: q.reference_images || [],
        media_url: q.media_url || "",
        media_type: q.media_type || "",
      },
    });
  };
  const cancelEdit = (quizId) => {
    setEditingQ({ ...editingQ, [quizId]: null });
    setQForm({ ...qForm, [quizId]: blankQ });
  };

  const saveQuestion = async (quizId) => {
    const q = getQForm(quizId);
    const editingId = editingQ[quizId];
    if (!q.question.trim()) { setMsg("Fill in the question."); return; }
    if (q.question_type === "multiple_choice") {
      if (q.options.some((o) => !o.trim())) { setMsg("Fill in all 4 options."); return; }
      if (q.correct_indices.length === 0) { setMsg("Mark at least one option as correct."); return; }
    }
    if (q.question_type === "screenshot" && !q.answer_guide.trim()) { setMsg("Describe what a correct screenshot should show."); return; }
    setMsg(null);

    const payload = q.question_type === "screenshot"
      ? { quiz_id: quizId, question_type: "screenshot", question: q.question, answer_guide: q.answer_guide, reference_images: q.reference_images || [], options: null, correct_index: null, correct_indices: null, multi_correct: false, media_url: q.media_url || null, media_type: q.media_type || null }
      : { quiz_id: quizId, question_type: "multiple_choice", question: q.question, options: q.options, correct_index: q.correct_indices[0], correct_indices: q.correct_indices, multi_correct: q.multi_correct, answer_guide: null, reference_images: [], media_url: q.media_url || null, media_type: q.media_type || null };

    if (editingId) {
      const { error } = await supabase.from("quiz_questions").update(payload).eq("id", editingId);
      if (error) { setMsg(error.message); return; }

      // A multiple-choice answer was changed after employees may have
      // already been graded on it — retroactively recompute every
      // attempt for this quiz so nothing stays silently wrong.
      if (q.question_type === "multiple_choice") {
        setRescoring(true);
        const res = await fetch("/api/rescore-quiz-question", { method: "POST", headers: await authHeader(), body: JSON.stringify({ questionId: editingId }) });
        const json = await res.json();
        setRescoring(false);
        if (res.ok) setMsg(`✓ Question updated — ${json.attemptsUpdated} past attempt(s) automatically rescored.`);
        else setMsg("Question saved, but rescoring failed: " + json.error);
      } else {
        setMsg("✓ Question updated.");
      }
      cancelEdit(quizId);
    } else {
      const count = (questionsByQuiz[quizId] || []).length;
      const { error } = await supabase.from("quiz_questions").insert({ ...payload, sort_order: count });
      if (error) { setMsg(error.message); return; }
      setQForm({ ...qForm, [quizId]: blankQ });
    }
    load();
  };

  const delQuestion = async (id) => { await supabase.from("quiz_questions").delete().eq("id", id); load(); };

  const courseName = (id) => courses.find((c) => c.id === id)?.title || "—";

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Assessments</h1>
        <p className="sub">Build quizzes to check real understanding after a course — multiple choice, or a screenshot the AI reviews.</p>
        {msg && <div className={`msg ${msg.startsWith("✓") ? "ok" : "err"}`}>{msg}</div>}
        {rescoring && <div className="msg">Rescoring past attempts…</div>}

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>New quiz</div>
          <form onSubmit={createQuiz}>
            <div className="grid2">
              <label className="field"><span>Course</span>
                <select value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })}>
                  <option value="">Select a course…</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              <label className="field"><span>Pass mark (%)</span>
                <input type="number" min="0" max="100" value={form.pass_percent} onChange={(e) => setForm({ ...form, pass_percent: e.target.value })} />
              </label>
              <label className="field"><span>Time limit in minutes (optional)</span>
                <input type="number" min="1" value={form.time_limit_minutes} onChange={(e) => setForm({ ...form, time_limit_minutes: e.target.value })} placeholder="Leave blank for no limit" />
              </label>
            </div>
            <label className="field"><span>Quiz title</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Foundations Knowledge Check" required /></label>
            <button className="btn primary">Create quiz</button>
          </form>
        </div>

        {quizzes.map((quiz) => {
          const questions = questionsByQuiz[quiz.id] || [];
          const draft = getQForm(quiz.id);
          const isEditing = !!editingQ[quiz.id];
          return (
            <div key={quiz.id} className="card pad" style={{ marginBottom: 16 }}>
              <div className="row-between">
                <div>
                  <b>{quiz.title}</b>
                  <div className="mini">{courseName(quiz.course_id)} · Pass mark {quiz.pass_percent}% · {questions.length} question{questions.length === 1 ? "" : "s"}{quiz.time_limit_minutes ? ` · ⏱ ${quiz.time_limit_minutes} min limit` : ""}</div>
                </div>
                <button className="btn danger" onClick={() => delQuiz(quiz.id)}>Delete quiz</button>
              </div>

              <div style={{ marginTop: 14 }}>
                {questions.map((q, i) => (
                  <div key={q.id} className="lesson" style={{ alignItems: "flex-start", padding: "10px 0" }}>
                    <div className="num">{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {q.question}
                        {q.question_type === "screenshot" && <span className="pill red" style={{ marginLeft: 8 }}>📷 Screenshot</span>}
                        {q.multi_correct && <span className="pill" style={{ marginLeft: 8 }}>☑ Multi-select</span>}
                        {q.media_url && <span className="pill" style={{ marginLeft: 8 }}>{q.media_type === "video" ? "🎬" : "🖼️"} Media attached</span>}
                      </div>
                      {q.question_type === "screenshot" ? (
                        <>
                          <div className="mini" style={{ marginTop: 4 }}>AI checks for: {q.answer_guide}</div>
                          {Array.isArray(q.reference_images) && q.reference_images.length > 0 && (
                            <div className="mini" style={{ marginTop: 2 }}>📎 {q.reference_images.length} reference example{q.reference_images.length === 1 ? "" : "s"} attached</div>
                          )}
                        </>
                      ) : (
                        <div className="mini" style={{ marginTop: 4 }}>
                          {(q.options || []).map((o, oi) => {
                            const correctSet = new Set(Array.isArray(q.correct_indices) ? q.correct_indices : [q.correct_index]);
                            const isCorrect = correctSet.has(oi);
                            return (
                              <span key={oi} style={{ marginRight: 12, color: isCorrect ? "#15803d" : undefined, fontWeight: isCorrect ? 700 : 400 }}>
                                {isCorrect ? "✓ " : ""}{o}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <button className="btn ghost" onClick={() => startEdit(quiz.id, q)}>Edit</button>
                    <button className="btn ghost" onClick={() => delQuestion(q.id)}>Remove</button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, background: "#fafbfc", borderRadius: 12, padding: 16 }}>
                <div className="mini" style={{ fontWeight: 700, marginBottom: 10 }}>{isEditing ? "Editing question" : "Add a question"}</div>

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button type="button" className={`chipbtn ${draft.question_type === "multiple_choice" ? "on" : ""}`} onClick={() => setQ(quiz.id, { question_type: "multiple_choice" })}>Multiple choice</button>
                  <button type="button" className={`chipbtn ${draft.question_type === "screenshot" ? "on" : ""}`} onClick={() => setQ(quiz.id, { question_type: "screenshot" })}>📷 Screenshot (AI-reviewed)</button>
                </div>

                <label className="field"><span>Question</span>
                  <input value={draft.question} onChange={(e) => setQ(quiz.id, { question: e.target.value })}
                    placeholder={draft.question_type === "screenshot" ? "e.g. Show a screenshot of a completed KDS order screen" : "What's the first step in a discovery call?"} /></label>

                <label className="field">
                  <span>Attach an image or video to this question (optional — shown to the employee above the question)</span>
                  <input type="file" accept="image/*,video/*" onChange={(e) => uploadQuestionMedia(quiz.id, e.target.files?.[0])} />
                </label>
                {draft.media_url && (
                  <div style={{ marginBottom: 14 }}>
                    {draft.media_type === "video" ? (
                      <video src={draft.media_url} controls style={{ maxWidth: 260, borderRadius: 10, display: "block" }} />
                    ) : (
                      <img src={draft.media_url} alt="Question media" style={{ maxWidth: 260, borderRadius: 10, display: "block" }} />
                    )}
                    <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => removeQuestionMedia(quiz.id)}>Remove media</button>
                  </div>
                )}

                {draft.question_type === "screenshot" ? (
                  <>
                    <label className="field"><span>What should a correct screenshot show? (this guides the AI reviewer)</span>
                      <textarea rows={3} value={draft.answer_guide} onChange={(e) => setQ(quiz.id, { answer_guide: e.target.value })}
                        placeholder="e.g. A screenshot from the Petpooja admin portal's KDS screen showing at least one order in 'Preparing' status, with the order items visible." />
                    </label>
                    <label className="field">
                      <span>Upload correct example screenshots (optional, but recommended — the AI will compare an employee's answer against the real content in these, like item names, prices, or contact details)</span>
                      <input type="file" accept="image/*" multiple onChange={(e) => uploadReferenceImages(quiz.id, e.target.files)} />
                    </label>
                    {refUploading[quiz.id] && <div className="mini" style={{ marginBottom: 10 }}>Uploading…</div>}
                    {(draft.reference_images || []).length > 0 && (
                      <div className="mini" style={{ marginBottom: 12 }}>
                        {draft.reference_images.length} reference image{draft.reference_images.length === 1 ? "" : "s"} attached.{" "}
                        {draft.reference_images.map((p, i) => (
                          <button key={p} type="button" className="btn ghost sm" style={{ marginLeft: i === 0 ? 0 : 6 }} onClick={() => removeReferenceImage(quiz.id, p)}>Remove #{i + 1}</button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13 }}>
                      <input type="checkbox" checked={draft.multi_correct} onChange={(e) => setQ(quiz.id, { multi_correct: e.target.checked, correct_indices: e.target.checked ? draft.correct_indices : [draft.correct_indices[0] || 0] })} style={{ width: "auto" }} />
                      Allow more than one correct answer for this question
                    </label>
                    <div className="grid2">
                      {[0, 1, 2, 3].map((i) => (
                        <label key={i} className="field">
                          <span>
                            <input
                              type={draft.multi_correct ? "checkbox" : "radio"}
                              name={draft.multi_correct ? undefined : "correct-" + quiz.id}
                              checked={draft.correct_indices.includes(i)}
                              onChange={() => toggleCorrect(quiz.id, i)}
                              style={{ width: "auto", marginRight: 6 }}
                            />
                            Option {i + 1} {draft.correct_indices.includes(i) && "(correct)"}
                          </span>
                          <input value={draft.options[i]} onChange={(e) => {
                            const opts = [...draft.options]; opts[i] = e.target.value; setQ(quiz.id, { options: opts });
                          }} />
                        </label>
                      ))}
                    </div>
                  </>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn outline" onClick={() => saveQuestion(quiz.id)}>{isEditing ? "Save changes" : "+ Add question"}</button>
                  {isEditing && <button type="button" className="btn ghost" onClick={() => cancelEdit(quiz.id)}>Cancel</button>}
                </div>
              </div>
            </div>
          );
        })}
        {quizzes.length === 0 && <div className="mini">No quizzes yet — create one above.</div>}
      </main>
    </div>
  );
}
