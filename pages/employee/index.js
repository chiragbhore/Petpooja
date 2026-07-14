import { useProfile } from "../../lib/useProfile";
import Sidebar from "../../components/Sidebar";

export default function EmployeeHome() {
  const { loading, me } = useProfile("employee");
  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">Hi {me.full_name.split(" ")[0]} 👋</h1>
        <p className="sub">Welcome to PitchLab, Petpooja's sales training portal.</p>

        <div className="card pad">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>You're all set up.</div>
          <div className="mini">
            Your courses and roleplay practice will appear here in the next update.
            {me.team ? ` You're on the ${me.team} team.` : ""}
          </div>
        </div>
      </main>
    </div>
  );
}
