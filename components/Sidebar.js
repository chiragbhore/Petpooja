import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import ThemeToggle from "./ThemeToggle";

const ICONS = {
  Overview: "🏠", Dashboard: "🏠",
  Courses: "📚", Roleplay: "🎤", "Roleplays": "🎯",
  Assessments: "📝", "Knowledge Base": "🧠",
  "Call Reports": "📈", "My Calls": "🎧",
  Classroom: "📅", Team: "👥",
};

export default function Sidebar({ role, me }) {
  const router = useRouter();
  const path = router.pathname;

  const links =
    role === "admin"
      ? [
          ["/admin", "Overview"],
          ["/admin/courses", "Courses"],
          ["/admin/scenarios", "Roleplays"],
          ["/admin/quizzes", "Assessments"],
          ["/admin/knowledge", "Knowledge Base"],
          ["/admin/reports", "Call Reports"],
          ["/admin/classroom", "Classroom"],
          ["/admin/employees", "Team"],
        ]
      : [
          ["/employee", "Dashboard"],
          ["/employee/courses", "Courses"],
          ["/employee/roleplay", "Roleplay"],
          ["/employee/my-calls", "My Calls"],
          ["/employee/classroom", "Classroom"],
        ];

  const isActive = (href) => path === href || (href !== "/admin" && href !== "/employee" && path.startsWith(href));

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <img src="/petpooja.png" alt="Petpooja" style={{ width: 38, height: 38, objectFit: "contain", background: "#fff", borderRadius: 10, padding: 4 }} />
        <div className="sb-brand-name">PitchLab<span>Sales Pitch Practice</span></div>
      </div>

      <nav className="sb-nav">
        {links.map(([href, label]) => (
          <a
            key={href}
            className={`sb-link ${isActive(href) ? "active" : ""}`}
            onClick={() => router.push(href)}
          >
            <span>{ICONS[label] || "•"}</span> {label}
          </a>
        ))}
      </nav>

      <div className="spacer" />

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <ThemeToggle />
      </div>

      <div className="sb-user">
        <div className="avatar">
          {(me?.full_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me?.full_name}</div>
          <div className="mini" style={{ textTransform: "capitalize" }}>{role}</div>
        </div>
      </div>
      <button className="btn ghost full" onClick={logout} style={{ marginTop: 8 }}>Log out</button>
    </aside>
  );
}
