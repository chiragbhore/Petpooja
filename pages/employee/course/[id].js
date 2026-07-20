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
  const [viewing, setViewing] = useState(null); // lesson currently open in the SCORM viewer
  const [quiz, setQuiz] = useState(null);
  const [bestAttempt, setBestAttempt] = useState(null);

  useEffect(() => {
    if (loading || !me || !id) return;
    (async () => {
      const { data: c } = await supabase.from("courses").select("*").eq("id", id).single();
      const { data: ls } = await supabase.from("lessons").select("*").eq("course_id", id).order("sort_order", { ascending: true });
      const { data: prog } = await supabase.from("lesson_progress").select("lesson_id").eq("user_id", me.id);
      setCourse(c);
      setLessons(ls || []);
      setCompleted(new Set((prog || []).map((p) => p.lesson_id)));

      const { data: qz } = await supabase.from("quizzes").select("*").eq("course_id", id).limit(1).maybeSingle();
      setQuiz(qz || null);
      if (qz) {
        const { data: attempts } = await supabase
          .from("quiz_attempts").select("*").eq("quiz_id", qz.id).eq("user_id", me.id)
          .order("score", { ascending: false }).limit(1);
        setBestAttempt(attempts && attempts[0] ? attempts[0] : null);
      }
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
            const isScorm = l.content_type === "scorm" && l.scorm_url;
            return (
              <div key={l.id} className="lesson">
                <div className={`check ${done ? "on" : ""}`} onClick={() => toggle(l.id)}>{done ? "✓" : ""}</div>
                <div className="num">{i + 1}</div>
                <div className={`ltitle ${done ? "done" : ""}`}>
                  {l.title}
                  {isScorm && <span className="pill red" style={{ marginLeft: 8 }}>Interactive</span>}
                </div>
                {isScorm && <button className="btn outline" onClick={() => setViewing(l)}>Open lesson</button>}
                <div className="mini">{l.minutes || 8} min</div>
              </div>
            );
          })}
        </div>

        {quiz && (
          <>
            <div className="section-label">Assessment</div>
            <div className="card pad row-between">
              <div>
                <b>{quiz.title}</b>
                <div className="mini">Pass mark: {quiz.pass_percent}%{bestAttempt ? ` · Your best: ${bestAttempt.score}% (${bestAttempt.passed ? "Passed" : "Not passed"})` : " · Not attempted yet"}</div>
              </div>
              <button className="btn primary" onClick={() => router.push(`/employee/quiz/${quiz.id}`)}>
                {bestAttempt ? "Retake quiz" : "Take assessment"}
              </button>
            </div>
          </>
        )}
      </main>

      {viewing && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 100, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#14161a" }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{viewing.title}</span>
            <button className="btn danger" onClick={() => setViewing(null)}>Close</button>
          </div>
          <iframe src={viewing.scorm_url} title={viewing.title} style={{ flex: 1, border: "none", width: "100%", background: "#fff" }} />
        </div>
      )}
    </div>
  );
}
