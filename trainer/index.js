import { useRouter } from "next/router";
import { useProfile } from "../../lib/useProfile";
import Sidebar from "../../components/Sidebar";

const SECTIONS = [
  ["courses", "Courses", "Build courses, lessons, and SCORM content.", "/admin/courses"],
  ["scenarios", "Roleplays", "Design AI voice roleplay scenarios.", "/admin/scenarios"],
  ["quizzes", "Assessments", "Create quizzes for your courses.", "/admin/quizzes"],
  ["knowledge", "Knowledge Base", "Maintain the product knowledge the AI tests reps on.", "/admin/knowledge"],
  ["reports", "Call Reports", "Review employee call reports and scores.", "/admin/reports"],
  ["classroom", "Classroom", "Schedule live training sessions.", "/admin/classroom"],
];

export default function TrainerHome() {
  const { loading, me } = useProfile("trainer");
  const router = useRouter();

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  const perms = me.permissions || {};
  const granted = SECTIONS.filter(([key]) => perms[key]);

  return (
    <div className="shell">
      <Sidebar role="trainer" me={me} />
      <main className="content">
        <h1 className="page">Welcome, {me.full_name.split(" ")[0]}</h1>
        <p className="sub">Petpooja PitchLab — trainer console.</p>

        {granted.length === 0 ? (
          <div className="card pad mini">Your admin hasn't granted you access to any section yet — ask them to set your permissions under Team.</div>
        ) : (
          <div className="grid2">
            {granted.map(([key, title, desc, href]) => (
              <div key={key} className="card pad">
                <div style={{ fontWeight: 700 }}>{title}</div>
                <div className="mini" style={{ marginBottom: 12 }}>{desc}</div>
                <button className="btn primary" onClick={() => router.push(href)}>Open</button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
