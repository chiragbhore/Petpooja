import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function AdminCourses() {
  const { loading, me } = useProfile("admin");
  const router = useRouter();
  const [courses, setCourses] = useState([]);
  const [lessonsByCourse, setLessonsByCourse] = useState({});
  const [quizzes, setQuizzes] = useState([]);
  const [form, setForm] = useState({ title: "", tag: "Core", description: "" });
  const [lessonInput, setLessonInput] = useState({}); // courseId -> text
  const [msg, setMsg] = useState(null);

  const load = async () => {
    const [{ data: cs }, { data: ls }, { data: qz }] = await Promise.all([
      supabase.from("courses").select("*").order("sort_order", { ascending: true }),
      supabase.from("lessons").select("*").order("sort_order", { ascending: true }),
      supabase.from("quizzes").select("id, title, course_id").order("created_at", { ascending: true }),
    ]);
    const map = {};
    (ls || []).forEach((l) => { (map[l.course_id] = map[l.course_id] || []).push(l); });
    setCourses(cs || []);
    setLessonsByCourse(map);
    setQuizzes(qz || []);
  };

  useEffect(() => { if (!loading) load(); }, [loading]);

  const addCourse = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!form.title.trim()) return;
    const { error } = await supabase.from("courses").insert({
      title: form.title, tag: form.tag, description: form.description, sort_order: courses.length,
    });
    if (error) { setMsg(error.message); return; }
    setForm({ title: "", tag: "Core", description: "" });
    load();
  };

  const delCourse = async (id) => {
    if (!confirm("Delete this course and all its lessons?")) return;
    await supabase.from("courses").delete().eq("id", id);
    load();
  };

  const addLesson = async (courseId) => {
    const title = (lessonInput[courseId] || "").trim();
    if (!title) return;
    const count = (lessonsByCourse[courseId] || []).length;
    await supabase.from("lessons").insert({ course_id: courseId, title, sort_order: count });
    setLessonInput({ ...lessonInput, [courseId]: "" });
    load();
  };

  const delLesson = async (id) => { await supabase.from("lessons").delete().eq("id", id); load(); };

  const quizzesForCourse = (courseId) => quizzes.filter((q) => q.course_id === courseId);
  const unlinkedQuizzes = quizzes.filter((q) => !q.course_id);

  const linkQuiz = async (courseId, quizId) => {
    if (!quizId) return;
    await supabase.from("quizzes").update({ course_id: courseId }).eq("id", quizId);
    load();
  };
  const unlinkQuiz = async (quizId) => {
    await supabase.from("quizzes").update({ course_id: null }).eq("id", quizId);
    load();
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Courses</h1>
        <p className="sub">Create courses, add lessons, and attach an assessment to each one.</p>
        {msg && <div className="msg err">{msg}</div>}

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>New course</div>
          <form onSubmit={addCourse}>
            <div className="grid2">
              <label className="field"><span>Title</span>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
              <label className="field"><span>Tag</span>
                <select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}>
                  <option>Core</option><option>Skill</option><option>Advanced</option>
                </select></label>
            </div>
            <label className="field"><span>Description</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this course covers" /></label>
            <button className="btn primary">Create course</button>
          </form>
        </div>

        {courses.map((c) => {
          const linked = quizzesForCourse(c.id);
          return (
            <div key={c.id} className="card pad" style={{ marginBottom: 16 }}>
              <div className="row-between">
                <div><b>{c.title}</b> {c.tag && <span className="pill red">{c.tag}</span>}
                  <div className="mini">{c.description}</div></div>
                <button className="btn danger" onClick={() => delCourse(c.id)}>Delete</button>
              </div>

              <div style={{ marginTop: 12 }}>
                {(lessonsByCourse[c.id] || []).map((l, i) => (
                  <div key={l.id} className="lesson" style={{ padding: "10px 0" }}>
                    <div className="num">{i + 1}</div>
                    <div className="ltitle">{l.title}</div>
                    <button className="btn ghost" onClick={() => delLesson(l.id)}>Remove</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <input placeholder="Add a lesson title"
                    value={lessonInput[c.id] || ""}
                    onChange={(e) => setLessonInput({ ...lessonInput, [c.id]: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && addLesson(c.id)} />
                  <button className="btn outline" onClick={() => addLesson(c.id)} style={{ whiteSpace: "nowrap" }}>+ Lesson</button>
                </div>
              </div>

              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                <div className="mini" style={{ fontWeight: 700, marginBottom: 8 }}>📝 Assessment</div>
                {linked.length > 0 ? (
                  linked.map((q) => (
                    <div key={q.id} className="row-between" style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 13 }}>{q.title}</span>
                      <div>
                        <button className="btn ghost sm" onClick={() => router.push("/admin/quizzes")}>Manage</button>
                        <button className="btn ghost sm" onClick={() => unlinkQuiz(q.id)}>Unlink</button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="mini" style={{ marginBottom: 8 }}>No assessment attached to this course yet.</div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {unlinkedQuizzes.length > 0 && (
                    <select onChange={(e) => { linkQuiz(c.id, e.target.value); e.target.value = ""; }} defaultValue="" style={{ maxWidth: 240 }}>
                      <option value="">Attach an existing assessment…</option>
                      {unlinkedQuizzes.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
                    </select>
                  )}
                  <button className="btn outline sm" onClick={() => router.push("/admin/quizzes")}>+ Create new assessment</button>
                </div>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
