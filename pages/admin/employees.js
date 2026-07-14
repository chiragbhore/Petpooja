import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function Employees() {
  const { loading, me } = useProfile("admin");
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ full_name: "", email: "", team: "", password: "" });
  const [msg, setMsg] = useState(null); // {type, text}
  const [busy, setBusy] = useState(false);

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };
  };

  const refresh = async () => {
    const res = await fetch("/api/employees", { headers: await authHeader() });
    const json = await res.json();
    if (res.ok) setList(json.employees || []);
  };

  useEffect(() => {
    if (!loading) refresh();
  }, [loading]);

  const create = async (e) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify(form),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg({ type: "err", text: json.error || "Could not create employee." });
      return;
    }
    setMsg({ type: "ok", text: `${form.full_name} can now log in with that email and password.` });
    setForm({ full_name: "", email: "", team: "", password: "" });
    refresh();
  };

  const remove = async (emp) => {
    if (!confirm(`Remove ${emp.full_name}? They will no longer be able to log in.`)) return;
    const res = await fetch("/api/employees", {
      method: "DELETE",
      headers: await authHeader(),
      body: JSON.stringify({ id: emp.id }),
    });
    const json = await res.json();
    if (!res.ok) { setMsg({ type: "err", text: json.error || "Could not remove." }); return; }
    setMsg({ type: "ok", text: `${emp.full_name} removed.` });
    refresh();
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Team</h1>
        <p className="sub">Create employee logins and manage your team.</p>

        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Add a new employee</div>
          <form onSubmit={create}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <label className="field">
                <span>Full name</span>
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </label>
              <label className="field">
                <span>Team (optional)</span>
                <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="SMB Sales" />
              </label>
              <label className="field">
                <span>Email (their login)</span>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </label>
              <label className="field">
                <span>Temporary password</span>
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 6 characters" required minLength={6} />
              </label>
            </div>
            <button className="btn primary" disabled={busy}>
              {busy ? "Creating…" : "Create employee"}
            </button>
          </form>
        </div>

        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Team</th><th></th></tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={4} className="mini" style={{ padding: 20 }}>No employees yet. Add your first one above.</td></tr>
              )}
              {list.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="avatar">
                        {emp.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <b>{emp.full_name}</b>
                    </div>
                  </td>
                  <td className="mini">{emp.email}</td>
                  <td>{emp.team || <span className="mini">—</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn danger" onClick={() => remove(emp)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
