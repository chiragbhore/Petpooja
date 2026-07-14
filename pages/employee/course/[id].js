import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../../lib/useProfile";
import { supabase } from "../../../lib/supabaseClient";
import { courseProgress, Ring } from "../../../lib/lms";
import Sidebar from "../../../components/Sidebar";

export default function CourseDetail() {
  const { loading, me } = useProfile("employee");
  const router = useRouter();
  const { id } = router.query;

  const [course, setCourse] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [completed, setCompleted] = useState(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !me || !id) return;
    (async () => {
      const { data: c } = await supabase.from("courses").select("*").eq("id", id).single();
      const { data: ls } = await supabase.from("lessons").select("*").eq("course_id", id).order("sort_order", { ascending: true });
      const { data: prog } = await supabase.from("lesson_progress").select("lesson_id").eq("user_id", me.id);
      setCourse(c);
      setLessons(ls || []);
      setCompleted(new Set((prog || []).map((p) => p.lesson_id)));
    })();
  }, [loading, me, id]);

  const toggle = async (lessonId) => {
    if (busy) return;
    setBusy(true);
    const next = new Set(completed);
    if (next.has(lessonId)) {
      next.delete(lessonId);
      setCompleted(new Set(next));
      await supabase.from("lesson_progress").delete().eq("user_id", me.id).eq("lesson_id", lessonId);
    } else {
      next.add(lessonId);
      setCompleted(new Set(next));
      await supabase.from("lesson_progress").insert({ user_id: me.id, lesson_id: lessonId });
    }
    setBusy(false);
  };

  if (loading || !course) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  const p = courseProgress(lessons, completed);

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <div className="link-back" onClick={() => router.push("/employee/courses")}>← Back to courses</div>

        <div className="card pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div>
            {course.tag && <span className="pill red">{course.tag}</span>}
            <h1 className="page" style={{ marginTop: 8 }}>{course.title}</h1>
            <p className="mini" style={{ maxWidth: 520 }}>{course.description}</p>
          </div>
          <Ring value={p.pct} size={84} stroke={9} />
        </div>

        <div className="section-label">Lessons</div>
        <div className="card">
          {lessons.length === 0 && <div className="pad mini">No lessons in this course yet.</div>}
          {lessons.map((l, i) => {
            const done = completed.has(l.id);
            return (
              <div key={l.id} className="lesson">
                <div className={`check ${done ? "on" : ""}`} onClick={() => toggle(l.id)}>{done ? "✓" : ""}</div>
                <div className="num">{i + 1}</div>
                <div className={`ltitle ${done ? "done" : ""}`}>{l.title}</div>
                <div className="mini">{l.minutes || 8} min</div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
