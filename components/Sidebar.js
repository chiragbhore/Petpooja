import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

export default function Sidebar({ role, me }) {
  const router = useRouter();
  const path = router.pathname;

  const links =
    role === "admin"
      ? [
          ["/admin", "Overview"],
          ["/admin/courses", "Courses"],
          ["/admin/scenarios", "Roleplays"],
          ["/admin/employees", "Team"],
        ]
      : [
          ["/employee", "Dashboard"],
          ["/employee/courses", "Courses"],
          ["/employee/roleplay", "Roleplay"],
        ];

  const isActive = (href) => path === href || (href !== "/admin" && href !== "/employee" && path.startsWith(href));

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <aside className="sidebar">
      <img src="/petpooja.png" alt="Petpooja" className="brand-logo" />
      <div className="brand-sub"><b>PitchLab</b> · Sales Training</div>

      <nav className="nav">
        {links.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className={isActive(href) ? "active" : ""}
            onClick={(e) => { e.preventDefault(); router.push(href); }}
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="spacer" />

      <div className="row-between" style={{ padding: "8px 6px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
          <div className="avatar">
            {(me?.full_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="stack" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{me?.full_name}</div>
            <div className="mini" style={{ textTransform: "capitalize" }}>{role}</div>
          </div>
        </div>
      </div>
      <button className="btn ghost full" onClick={logout} style={{ marginTop: 6 }}>Log out</button>
    </aside>
  );
}
