import { useEffect, useState, useRef } from "react";
import { useProfile, hasPermission } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import { uploadScormPackage } from "../../lib/scorm";
import Sidebar from "../../components/Sidebar";

export default function AdminCourses() {
  const { loading, me } = useProfile(["admin", "trainer"]);
  const [courses, setCourses] = useState([]);
  const [lessonsByCourse, setLessonsByCourse] = useState({});
  const [form, setForm] = useState({ title: "", tag: "Core", description: "" });
  const [lessonInput, setLessonInput] = useState({}); // courseId -> text
  const [msg, setMsg] = useState(null);
  const [scormBusy, setScormBusy] = useState(null); // lessonId currently uploading
  const [scormProgress, setScormProgress] = useState("");
  const fileInputRef = useRef(null);
  const pendingLessonId = useRef(null);

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

  const openScormPicker = (lessonId) => {
    pendingLessonId.current = lessonId;
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const onScormFileChosen = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow picking the same file again later
    const lessonId = pendingLessonId.current;
    if (!file || !lessonId) return;
    if (!file.name.toLowerCase().endsWith(".zip")) { setMsg("Please choose a .zip SCORM package."); return; }

    setMsg(null);
    setScormBusy(lessonId);
    setScormProgress("Unpacking…");
    try {
      const url = await uploadScormPackage(file, lessonId, (done, total) => {
        setScormProgress(`Uploading ${done}/${total} files…`);
      });
      const { error } = await supabase.from("lessons").update({ content_type: "scorm", scorm_url: url }).eq("id", lessonId);
      if (error) throw new Error(error.message);
      load();
    } catch (err) {
      setMsg("SCORM upload failed: " + (err.message || err));
    }
    setScormBusy(null);
    setScormProgress("");
  };

  const removeScorm = async (lessonId) => {
    await supabase.from("lessons").update({ content_type: "standard", scorm_url: null }).eq("id", lessonId);
    load();
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;
  if (me.role === "trainer" && !hasPermission(me, "courses")) {
    return <div className="center-screen"><div className="mini">You don't have access to this section — ask your admin to grant it.</div></div>;
  }

  return (
    <div className="shell">
      <Sidebar role={me.role} me={me} />
      <main className="content">
        <h1 className="page">Courses</h1>
        <p className="sub">Create courses, add lessons, and attach SCORM packages where useful.</p>
        {msg && <div className="msg err">{msg}</div>}

        <input ref={fileInputRef} type="file" accept=".zip" style={{ display: "none" }} onChange={onScormFileChosen} />

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
                <div key={l.id} className="lesson" style={{ padding: "10px 0", flexWrap: "wrap" }}>
                  <div className="num">{i + 1}</div>
                  <div className="ltitle">
                    {l.title}
                    {l.content_type === "scorm" && <span className="pill red" style={{ marginLeft: 8 }}>SCORM</span>}
                  </div>
                  {scormBusy === l.id ? (
                    <span className="mini">{scormProgress}</span>
                  ) : l.content_type === "scorm" ? (
                    <>
                      <button className="btn outline" onClick={() => openScormPicker(l.id)}>Replace SCORM</button>
                      <button className="btn ghost" onClick={() => removeScorm(l.id)}>Remove SCORM</button>
                    </>
                  ) : (
                    <button className="btn outline" onClick={() => openScormPicker(l.id)}>+ Add SCORM package</button>
                  )}
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
