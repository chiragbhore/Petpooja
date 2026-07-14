import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function AdminHome() {
  const { loading, me } = useProfile("admin");
  const router = useRouter();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const [{ data: emps }, { data: courses }, { data: lessons }, { data: enr }, { data: prog }] =
        await Promise.all([
          supabase.from("profiles").select("id").eq("role", "employee"),
          supabase.from("courses").select("id"),
          supabase.from("lessons").select("id, course_id"),
          supabase.from("enrollments").select("user_id, course_id"),
          supabase.from("lesson_progress").select("user_id, lesson_id"),
        ]);

      // average completion across employees
      const lessonsByCourse = {};
      (lessons || []).forEach((l) => { (lessonsByCourse[l.course_id] = lessonsByCourse[l.course_id] || []).push(l.id); });
      const doneByUser = {};
      (prog || []).forEach((p) => { (doneByUser[p.user_id] = doneByUser[p.user_id] || new Set()).add(p.lesson_id); });

      let sum = 0, n = 0;
      (emps || []).forEach((e) => {
        const myCourses = (enr || []).filter((x) => x.user_id === e.id).map((x) => x.course_id);
        const total = myCourses.reduce((a, cid) => a + (lessonsByCourse[cid] || []).length, 0);
        if (total === 0) { return; }
        const done = myCourses.reduce((a, cid) => a + (lessonsByCourse[cid] || []).filter((lid) => doneByUser[e.id]?.has(lid)).length, 0);
        sum += Math.round((done / total) * 100); n += 1;
      });

      setStats({
        employees: (emps || []).length,
        courses: (courses || []).length,
        avg: n ? Math.round(sum / n) : 0,
      });
    })();
  }, [loading]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Welcome, {me.full_name.split(" ")[0]}</h1>
        <p className="sub">Petpooja PitchLab — admin console.</p>

        <div className="grid3">
          <div className="tile"><div className="kpi">{stats?.employees ?? "…"}</div><div className="kpi-label">Employees</div></div>
          <div className="tile"><div className="kpi">{stats?.courses ?? "…"}</div><div className="kpi-label">Courses</div></div>
          <div className="tile"><div className="kpi">{stats?.avg ?? "…"}%</div><div className="kpi-label">Avg completion</div></div>
        </div>

        <div className="grid2" style={{ marginTop: 20 }}>
          <div className="card pad">
            <div style={{ fontWeight: 700 }}>Build training</div>
            <div className="mini" style={{ marginBottom: 12 }}>Create courses and roleplay scenarios.</div>
            <button className="btn primary" onClick={() => router.push("/admin/courses")}>Manage courses</button>
          </div>
          <div className="card pad">
            <div style={{ fontWeight: 700 }}>Your team</div>
            <div className="mini" style={{ marginBottom: 12 }}>Add people and assign them training.</div>
            <button className="btn dark" onClick={() => router.push("/admin/employees")}>Manage team</button>
          </div>
        </div>
      </main>
    </div>
  );
}
