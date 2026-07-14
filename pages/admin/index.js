import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function AdminHome() {
  const { loading, me } = useProfile("admin");
  const router = useRouter();
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const { count } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("role", "employee");
      setCount(count ?? 0);
    })();
  }, [loading]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Welcome, {me.full_name.split(" ")[0]}</h1>
        <p className="sub">Petpooja PitchLab — admin console.</p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div className="card pad" style={{ minWidth: 200 }}>
            <div className="mini">Employees</div>
            <div style={{ fontSize: 32, fontWeight: 800 }}>{count ?? "…"}</div>
          </div>
          <div className="card pad" style={{ minWidth: 200 }}>
            <div className="mini">Your role</div>
            <div style={{ fontSize: 32, fontWeight: 800, textTransform: "capitalize" }}>Admin</div>
          </div>
        </div>

        <div className="card pad" style={{ marginTop: 20 }}>
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 700 }}>Manage your team</div>
              <div className="mini">Create employee logins and remove people who leave.</div>
            </div>
            <button className="btn primary" onClick={() => router.push("/admin/employees")}>
              Go to Team
            </button>
          </div>
        </div>

        <p className="mini" style={{ marginTop: 24 }}>
          Courses and roleplay training will appear here in the next update.
        </p>
      </main>
    </div>
  );
}
