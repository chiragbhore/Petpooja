import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function AdminCourses() {
  const { loading, me } = useProfile("admin");
  const [courses, setCourses] = useState([]);
  const [lessonsByCourse, setLessonsByCourse] = useState({});
  const [form, setForm] = useState({ title: "", tag: "Core", description: "" });
  const [lessonInput, setLessonInput] = useState({}); // courseId -> text
  const [msg, setMsg] = useState(null);

  const load = async () => {
    const { data: cs } = await supabase.from("courses").select("*").order("sort_order", { ascending: true });
    const { data: ls } = await supabase.from("lessons").select("*").order("sort_order", { ascending: true });
    const map = {};
    (ls || []).forEach((l) => { (map[l.course_id] = map[l.course_id] || []).push(l); });
    setCourses(cs || []);
    setLessonsByCourse(map);
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

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Courses</h1>
        <p className="sub">Create courses and add lessons to them.</p>
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

        {courses.map((c) => (
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
          </div>
        ))}
      </main>
    </div>
  );
}
