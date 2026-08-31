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
  const [expandedQuiz, setExpandedQuiz] = useState(null); // only one quiz's detail panel open at a time
  const [activeTab, setActiveTab] = useState({}); // quizId -> 'questions' | 'add' | 'bulk'

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
    // If the preview below doesn't show it, the bucket likely isn't
    // actually set to Public in Supabase — that's the real thing to check.
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

  const downloadSampleCsv = () => {
    const rows = [
      ["Question", "Option A", "Option B", "Option C", "Option D", "Correct Answer(s)"],
      ["What's the first step in a discovery call?", "Introduce yourself", "Pitch the product immediately", "Ask about pricing", "Close the deal", "A"],
      ["Which of these are Petpooja products? (select all that apply)", "POS", "KDS", "Excel", "Captain App", "A,B,D"],
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "assessment-questions-sample.csv";
    a.click();
  };

  const parseCsv = (text) => {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = "";
          if (row.length > 1 || row[0] !== "") rows.push(row);
          row = [];
        } else field += c;
      }
    }
    if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  };

  const bulkUploadQuestions = async (quizId, file) => {
    if (!file) return;
    setMsg(null);
    const text = await file.text();
    const rows = parseCsv(text).slice(1); // drop header row
    const startCount = (questionsByQuiz[quizId] || []).length;
    const toInsert = [];
    const skipped = [];

    rows.forEach((r, idx) => {
      const [question, a, b, c, d, correctStr] = r.map((v) => (v || "").trim());
      if (!question) return; // blank row, ignore silently
      const options = [a, b, c, d];
      if (options.some((o) => !o)) { skipped.push(`Row ${idx + 2}: needs all 4 options filled in.`); return; }
      const correctIndices = (correctStr || "").split(",").map((s) => s.trim().toUpperCase().charCodeAt(0) - 65).filter((i) => i >= 0 && i <= 3);
      if (correctIndices.length === 0) { skipped.push(`Row ${idx + 2}: "${question.slice(0, 40)}" has no valid Correct Answer (use letters like A or A,C).`); return; }
      toInsert.push({
        quiz_id: quizId, question_type: "multiple_choice", question, options,
        correct_index: correctIndices[0], correct_indices: correctIndices, multi_correct: correctIndices.length > 1,
        answer_guide: null, reference_images: [], media_url: null, media_type: null,
        sort_order: startCount + toInsert.length,
      });
    });

    if (toInsert.length > 0) {
      const { error } = await supabase.from("quiz_questions").insert(toInsert);
      if (error) { setMsg("Bulk upload failed: " + error.message); return; }
    }
    setMsg(`✓ Added ${toInsert.length} question${toInsert.length === 1 ? "" : "s"} from the file.` + (skipped.length > 0 ? ` ${skipped.length} row(s) skipped — ${skipped.join(" ")}` : ""));
    load();
  };

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

        <div className="section-label">Your assessments</div>
        {quizzes.length === 0 && <div className="card pad mini">No quizzes yet — create one above.</div>}

        {quizzes.map((quiz) => {
          const questions = questionsByQuiz[quiz.id] || [];
          const draft = getQForm(quiz.id);
          const isEditing = !!editingQ[quiz.id];
          const isOpen = expandedQuiz === quiz.id;
          const tab = activeTab[quiz.id] || "questions";
          const setTab = (t) => setActiveTab({ ...activeTab, [quiz.id]: t });

          return (
            <div key={quiz.id} className="card" style={{ marginBottom: 12, overflow: "hidden" }}>
              {/* ---- Summary row (always visible) ---- */}
              <div
                className="row-between"
                style={{ padding: "16px 18px", cursor: "pointer" }}
                onClick={() => setExpandedQuiz(isOpen ? null : quiz.id)}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{quiz.title}</div>
                  <div className="mini" style={{ marginTop: 3 }}>
                    {courseName(quiz.course_id)} · Pass mark {quiz.pass_percent}% · {questions.length} question{questions.length === 1 ? "" : "s"}
                    {quiz.time_limit_minutes ? ` · ⏱ ${quiz.time_limit_minutes} min limit` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="btn danger sm" onClick={(e) => { e.stopPropagation(); delQuiz(quiz.id); }}>Delete</button>
                  <span style={{ fontSize: 18, color: "var(--muted)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
                </div>
              </div>

              {/* ---- Expanded detail panel ---- */}
              {isOpen && (
                <div style={{ borderTop: "1px solid var(--line)", padding: "16px 18px" }}>
                  {/* Tab switcher */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                    <button type="button" className={`chipbtn ${tab === "questions" ? "on" : ""}`} onClick={() => setTab("questions")}>
                      📋 Questions ({questions.length})
                    </button>
                    <button type="button" className={`chipbtn ${tab === "add" ? "on" : ""}`} onClick={() => setTab("add")}>
                      {isEditing ? "✏️ Editing question" : "+ Add question"}
                    </button>
                    <button type="button" className={`chipbtn ${tab === "bulk" ? "on" : ""}`} onClick={() => setTab("bulk")}>
                      ⬆ Bulk upload
                    </button>
                  </div>

                  {/* ---- Tab: Questions list ---- */}
                  {tab === "questions" && (
                    <div>
                      {questions.length === 0 ? (
                        <div className="mini">No questions yet — switch to the "Add question" tab to create one, or "Bulk upload" to add several at once.</div>
                      ) : (
                        <div className="card">
                          <table className="table">
                            <thead><tr><th style={{ width: 36 }}>#</th><th>Question</th><th></th></tr></thead>
                            <tbody>
                              {questions.map((q, i) => {
                                const correctSet = new Set(Array.isArray(q.correct_indices) ? q.correct_indices : [q.correct_index]);
                                return (
                                  <tr key={q.id}>
                                    <td className="mini">{i + 1}</td>
                                    <td>
                                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                                        {q.question}
                                        {q.question_type === "screenshot" && <span className="pill red" style={{ marginLeft: 8 }}>📷 Screenshot</span>}
                                        {q.multi_correct && <span className="pill" style={{ marginLeft: 8 }}>☑ Multi-select</span>}
                                        {q.media_url && <span className="pill" style={{ marginLeft: 8 }}>{q.media_type === "video" ? "🎬" : "🖼️"} Media</span>}
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
                                            const isCorrect = correctSet.has(oi);
                                            return (
                                              <span key={oi} style={{ marginRight: 12, color: isCorrect ? "#15803d" : undefined, fontWeight: isCorrect ? 700 : 400 }}>
                                                {isCorrect ? "✓ " : ""}{o}
                                              </span>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                      <button className="btn ghost sm" onClick={() => { startEdit(quiz.id, q); setTab("add"); }}>Edit</button>
                                      <button className="btn ghost sm" onClick={() => delQuestion(q.id)}>Remove</button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ---- Tab: Add / edit a single question ---- */}
                  {tab === "add" && (
                    <div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
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
                        <div style={{ marginBottom: 16 }}>
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

                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <button className="btn primary" onClick={() => saveQuestion(quiz.id)}>{isEditing ? "Save changes" : "+ Add question"}</button>
                        {isEditing && <button type="button" className="btn ghost" onClick={() => cancelEdit(quiz.id)}>Cancel</button>}
                      </div>
                    </div>
                  )}

                  {/* ---- Tab: Bulk upload ---- */}
                  {tab === "bulk" && (
                    <div>
                      <p className="mini" style={{ marginBottom: 14 }}>
                        Fill in a spreadsheet and upload it here instead of adding questions one at a time — handy for handing off to other trainers to build assessments. Screenshot questions still need to be added individually on the "Add question" tab, since they need real reference images.
                      </p>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <button type="button" className="btn outline" onClick={downloadSampleCsv}>⬇ Download sample CSV</button>
                        <input type="file" accept=".csv" onChange={(e) => bulkUploadQuestions(quiz.id, e.target.files?.[0])} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}
