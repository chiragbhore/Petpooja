import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../lib/useProfile";
import { loadEmployeeData, courseProgress } from "../../lib/lms";
import Sidebar from "../../components/Sidebar";

export default function Courses() {
  const { loading, me } = useProfile("employee");
  const router = useRouter();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (loading || !me) return;
    loadEmployeeData(me.id).then(setData);
  }, [loading, me]);

  if (loading || !data) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">Courses</h1>
        <p className="sub">Work through your assigned training.</p>

        {data.courses.length === 0 ? (
          <div className="card pad mini">No courses assigned yet.</div>
        ) : (
          <div className="grid2">
            {data.courses.map((c) => {
              const p = courseProgress(data.lessonsByCourse[c.id] || [], data.completed);
              return (
                <div key={c.id} className="tile course-card" onClick={() => router.push(`/employee/course/${c.id}`)}>
                  <div className="row-between">
                    <span className="course-title">{c.title}</span>
                    {c.tag && <span className="pill red">{c.tag}</span>}
                  </div>
                  <div className="course-desc">{c.description}</div>
                  <div className="progress"><i style={{ width: `${p.pct}%` }} /></div>
                  <div className="mini">{p.done} of {p.total} lessons · {p.pct}%</div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
