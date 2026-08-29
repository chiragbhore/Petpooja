import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

const blankQ = { question_type: "multiple_choice", question: "", options: ["", "", "", ""], correct_index: 0, answer_guide: "" };

export default function AdminQuizzes() {
  const { loading, me } = useProfile("admin");
  const [courses, setCourses] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [questionsByQuiz, setQuestionsByQuiz] = useState({});
  const [form, setForm] = useState({ course_id: "", title: "", pass_percent: 70 });
  const [qForm, setQForm] = useState({}); // quizId -> question draft
  const [msg, setMsg] = useState(null);

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
    });
    if (error) { setMsg(error.message); return; }
    setForm({ course_id: "", title: "", pass_percent: 70 });
    load();
  };

  const delQuiz = async (id) => { if (confirm("Delete this quiz and all its questions?")) { await supabase.from("quizzes").delete().eq("id", id); load(); } };

  const getQForm = (quizId) => qForm[quizId] || blankQ;
  const setQ = (quizId, patch) => setQForm({ ...qForm, [quizId]: { ...getQForm(quizId), ...patch } });

  const addQuestion = async (quizId) => {
    const q = getQForm(quizId);
    if (!q.question.trim()) { setMsg("Fill in the question."); return; }
    if (q.question_type === "multiple_choice" && q.options.some((o) => !o.trim())) { setMsg("Fill in all 4 options."); return; }
    if (q.question_type === "screenshot" && !q.answer_guide.trim()) { setMsg("Describe what a correct screenshot should show."); return; }
    setMsg(null);
    const count = (questionsByQuiz[quizId] || []).length;
    const payload = q.question_type === "screenshot"
      ? { quiz_id: quizId, question_type: "screenshot", question: q.question, answer_guide: q.answer_guide, options: null, correct_index: null, sort_order: count }
      : { quiz_id: quizId, question_type: "multiple_choice", question: q.question, options: q.options, correct_index: q.correct_index, answer_guide: null, sort_order: count };
    const { error } = await supabase.from("quiz_questions").insert(payload);
    if (error) { setMsg(error.message); return; }
    setQForm({ ...qForm, [quizId]: blankQ });
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
        {msg && <div className="msg err">{msg}</div>}

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
            </div>
            <label className="field"><span>Quiz title</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Foundations Knowledge Check" required /></label>
            <button className="btn primary">Create quiz</button>
          </form>
        </div>

        {quizzes.map((quiz) => {
          const questions = questionsByQuiz[quiz.id] || [];
          const draft = getQForm(quiz.id);
          return (
            <div key={quiz.id} className="card pad" style={{ marginBottom: 16 }}>
              <div className="row-between">
                <div>
                  <b>{quiz.title}</b>
                  <div className="mini">{courseName(quiz.course_id)} · Pass mark {quiz.pass_percent}% · {questions.length} question{questions.length === 1 ? "" : "s"}</div>
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
                      </div>
                      {q.question_type === "screenshot" ? (
                        <div className="mini" style={{ marginTop: 4 }}>AI checks for: {q.answer_guide}</div>
                      ) : (
                        <div className="mini" style={{ marginTop: 4 }}>
                          {(q.options || []).map((o, oi) => (
                            <span key={oi} style={{ marginRight: 12, color: oi === q.correct_index ? "#15803d" : undefined, fontWeight: oi === q.correct_index ? 700 : 400 }}>
                              {oi === q.correct_index ? "✓ " : ""}{o}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button className="btn ghost" onClick={() => delQuestion(q.id)}>Remove</button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, background: "#fafbfc", borderRadius: 12, padding: 16 }}>
                <div className="mini" style={{ fontWeight: 700, marginBottom: 10 }}>Add a question</div>

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button type="button" className={`chipbtn ${draft.question_type === "multiple_choice" ? "on" : ""}`} onClick={() => setQ(quiz.id, { question_type: "multiple_choice" })}>Multiple choice</button>
                  <button type="button" className={`chipbtn ${draft.question_type === "screenshot" ? "on" : ""}`} onClick={() => setQ(quiz.id, { question_type: "screenshot" })}>📷 Screenshot (AI-reviewed)</button>
                </div>

                <label className="field"><span>Question</span>
                  <input value={draft.question} onChange={(e) => setQ(quiz.id, { question: e.target.value })}
                    placeholder={draft.question_type === "screenshot" ? "e.g. Show a screenshot of a completed KDS order screen" : "What's the first step in a discovery call?"} /></label>

                {draft.question_type === "screenshot" ? (
                  <label className="field"><span>What should a correct screenshot show? (this guides the AI reviewer)</span>
                    <textarea rows={3} value={draft.answer_guide} onChange={(e) => setQ(quiz.id, { answer_guide: e.target.value })}
                      placeholder="e.g. A screenshot from the Petpooja admin portal's KDS screen showing at least one order in 'Preparing' status, with the order items visible." />
                  </label>
                ) : (
                  <div className="grid2">
                    {[0, 1, 2, 3].map((i) => (
                      <label key={i} className="field">
                        <span>
                          <input type="radio" name={"correct-" + quiz.id} checked={draft.correct_index === i}
                            onChange={() => setQ(quiz.id, { correct_index: i })} style={{ width: "auto", marginRight: 6 }} />
                          Option {i + 1} {draft.correct_index === i && "(correct)"}
                        </span>
                        <input value={draft.options[i]} onChange={(e) => {
                          const opts = [...draft.options]; opts[i] = e.target.value; setQ(quiz.id, { options: opts });
                        }} />
                      </label>
                    ))}
                  </div>
                )}
                <button className="btn outline" onClick={() => addQuestion(quiz.id)}>+ Add question</button>
              </div>
            </div>
          );
        })}
        {quizzes.length === 0 && <div className="mini">No quizzes yet — create one above.</div>}
      </main>
    </div>
  );
}
