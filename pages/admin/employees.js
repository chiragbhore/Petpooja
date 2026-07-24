import { useEffect, useState, Fragment } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function Employees() {
  const { loading, me } = useProfile("admin");
  const [list, setList] = useState([]);
  const [courses, setCourses] = useState([]);
  const [enrollments, setEnrollments] = useState([]); // {user_id, course_id}
  const [form, setForm] = useState({ full_name: "", email: "", team: "", password: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [assignFor, setAssignFor] = useState(null);

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };
  };

  const refresh = async () => {
    const res = await fetch("/api/employees", { headers: await authHeader() });
    const json = await res.json();
    if (res.ok) setList(json.employees || []);
    const { data: cs } = await supabase.from("courses").select("id, title").order("sort_order", { ascending: true });
    const { data: en } = await supabase.from("enrollments").select("user_id, course_id");
    setCourses(cs || []);
    setEnrollments(en || []);
  };

  useEffect(() => { if (!loading) refresh(); }, [loading]);

  const create = async (e) => {
    e.preventDefault();
    setMsg(null); setBusy(true);
    const res = await fetch("/api/employees", { method: "POST", headers: await authHeader(), body: JSON.stringify(form) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setMsg({ type: "err", text: json.error || "Could not create employee." }); return; }
    setMsg({ type: "ok", text: `${form.full_name} can now log in with that email and password.` });
    setForm({ full_name: "", email: "", team: "", password: "" });
    refresh();
  };

  const remove = async (emp) => {
    if (!confirm(`Remove ${emp.full_name}? They will no longer be able to log in.`)) return;
    const res = await fetch("/api/employees", { method: "DELETE", headers: await authHeader(), body: JSON.stringify({ id: emp.id }) });
    const json = await res.json();
    if (!res.ok) { setMsg({ type: "err", text: json.error || "Could not remove." }); return; }
    setMsg({ type: "ok", text: `${emp.full_name} removed.` });
    refresh();
  };

  const isAssigned = (userId, courseId) => enrollments.some((e) => e.user_id === userId && e.course_id === courseId);

  const toggleAssign = async (userId, courseId) => {
    if (isAssigned(userId, courseId)) {
      setEnrollments(enrollments.filter((e) => !(e.user_id === userId && e.course_id === courseId)));
      await supabase.from("enrollments").delete().eq("user_id", userId).eq("course_id", courseId);
    } else {
      setEnrollments([...enrollments, { user_id: userId, course_id: courseId }]);
      await supabase.from("enrollments").insert({ user_id: userId, course_id: courseId });
    }
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Team</h1>
        <p className="sub">Create employee logins and assign them training.</p>
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Add a new employee</div>
          <form onSubmit={create}>
            <div className="grid2">
              <label className="field"><span>Full name</span>
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
              <label className="field"><span>Team (optional)</span>
                <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="SMB Sales" /></label>
              <label className="field"><span>Email (their login)</span>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
              <label className="field"><span>Temporary password</span>
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 6 characters" required minLength={6} /></label>
            </div>
            <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create employee"}</button>
          </form>
        </div>

        <div className="card">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Team</th><th></th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={4} className="mini" style={{ padding: 20 }}>No employees yet. Add your first one above.</td></tr>}
              {list.map((emp) => (
                <Fragment key={emp.id}>
                  <tr>
                    <td><div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="avatar">{emp.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}</div>
                      <b>{emp.full_name}</b></div></td>
                    <td className="mini">{emp.email}</td>
                    <td>{emp.team || <span className="mini">—</span>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn ghost" onClick={() => setAssignFor(assignFor === emp.id ? null : emp.id)}>Assign</button>
                      <button className="btn danger" onClick={() => remove(emp)}>Remove</button>
                    </td>
                  </tr>
                  {assignFor === emp.id && (
                    <tr>
                      <td colSpan={4} style={{ background: "var(--input-bg)" }}>
                        <div className="mini" style={{ marginBottom: 8, fontWeight: 700 }}>Assign courses to {emp.full_name.split(" ")[0]}</div>
                        {courses.length === 0 ? <span className="mini">No courses yet — create some first.</span> : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {courses.map((c) => (
                              <button key={c.id} className={`chipbtn ${isAssigned(emp.id, c.id) ? "on" : ""}`} onClick={() => toggleAssign(emp.id, c.id)}>
                                {isAssigned(emp.id, c.id) ? "✓ " : ""}{c.title}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
