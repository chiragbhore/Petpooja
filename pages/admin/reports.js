import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

const PAGE_SIZE = 10;

export default function AdminReports() {
  const { loading, me } = useProfile("admin");
  const [calls, setCalls] = useState([]);
  const [employees, setEmployees] = useState({}); // id -> { full_name, team }
  const [scenarios, setScenarios] = useState({});
  const [searchText, setSearchText] = useState("");
  const [filterEmp, setFilterEmp] = useState("all");
  const [filterTeam, setFilterTeam] = useState("all");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const [{ data: rows }, { data: emps }, { data: scs }] = await Promise.all([
        supabase.from("roleplay_results").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name, team").eq("role", "employee"),
        supabase.from("scenarios").select("id, title"),
      ]);
      const empMap = {}; (emps || []).forEach((e) => { empMap[e.id] = { full_name: e.full_name, team: e.team || "" }; });
      const scMap = {}; (scs || []).forEach((s) => { scMap[s.id] = s.title; });
      setEmployees(empMap);
      setScenarios(scMap);
      setCalls(rows || []);
    })();
  }, [loading]);

  const openReport = async (call) => {
    let url = null;
    if (call.recording_path) {
      const { data } = await supabase.storage.from("call-recordings").createSignedUrl(call.recording_path, 3600);
      url = data?.signedUrl || null;
    }
    setOpen({ ...call, recording_url: url });
  };

  useEffect(() => { setPage(1); }, [filterEmp, filterTeam, scoreFilter, sortBy, dateFrom, dateTo, searchText]);

  const teamOptions = Array.from(new Set(Object.values(employees).map((e) => e.team).filter(Boolean))).sort();

  const inScoreBand = (score) => {
    if (scoreFilter === "all") return true;
    if (scoreFilter === "high") return score >= 70;
    if (scoreFilter === "mid") return score >= 50 && score < 70;
    if (scoreFilter === "low") return score < 50;
    return true;
  };

  const inDateRange = (createdAt) => {
    if (!dateFrom && !dateTo) return true;
    const d = new Date(createdAt);
    if (dateFrom && d < new Date(dateFrom + "T00:00:00")) return false;
    if (dateTo && d > new Date(dateTo + "T23:59:59")) return false;
    return true;
  };

  const filtered = calls
    .filter((c) => filterEmp === "all" || c.user_id === filterEmp)
    .filter((c) => filterTeam === "all" || (employees[c.user_id]?.team || "") === filterTeam)
    .filter((c) => inScoreBand(c.overall || 0))
    .filter((c) => inDateRange(c.created_at))
    .filter((c) => !searchText.trim() || (employees[c.user_id]?.full_name || "").toLowerCase().includes(searchText.trim().toLowerCase()));

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "score_desc") return (b.overall || 0) - (a.overall || 0);
    if (sortBy === "score_asc") return (a.overall || 0) - (b.overall || 0);
    if (sortBy === "date_asc") return new Date(a.created_at) - new Date(b.created_at);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const avg = filtered.length ? Math.round(filtered.reduce((a, c) => a + (c.overall || 0), 0) / filtered.length) : 0;

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = sorted.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const exportCsv = () => {
    const header = ["Employee", "Team", "Scenario", "Date & Time", "Score"];
    const lines = sorted.map((c) => [
      (employees[c.user_id]?.full_name || "").replace(/,/g, " "),
      (employees[c.user_id]?.team || "").replace(/,/g, " "),
      (scenarios[c.scenario_id] || "Scenario").replace(/,/g, " "),
      new Date(c.created_at).toLocaleDateString() + " " + new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      c.overall,
    ].join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const teamPart = filterTeam !== "all" ? "-" + filterTeam.replace(/\s+/g, "_") : "";
    a.download = `call-reports${teamPart}.csv`;
    a.click();
  };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="admin" me={me} />
      <main className="content">
        <h1 className="page">Call reports</h1>
        <p className="sub">Every roleplay call across your team, with the full AI pitch report.</p>

        <div className="grid3" style={{ marginBottom: 16 }}>
          <div className="tile"><div className="kpi">{filtered.length}</div><div className="kpi-label">Calls</div></div>
          <div className="tile"><div className="kpi">{avg}</div><div className="kpi-label">Average score</div></div>
          <div className="tile"><div className="kpi">{filtered.filter((c) => c.recording_path).length}</div><div className="kpi-label">Recordings available</div></div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <label className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
            <span>🔍 Search employee</span>
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Type a name…" />
          </label>
          <label className="field" style={{ maxWidth: 200, marginBottom: 0 }}>
            <span>Team</span>
            <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)}>
              <option value="all">All teams</option>
              {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
            <span>Filter by employee</span>
            <select value={filterEmp} onChange={(e) => setFilterEmp(e.target.value)}>
              <option value="all">All employees</option>
              {Object.entries(employees).map(([id, e]) => <option key={id} value={id}>{e.full_name}</option>)}
            </select>
          </label>
          <label className="field" style={{ maxWidth: 200, marginBottom: 0 }}>
            <span>Score</span>
            <select value={scoreFilter} onChange={(e) => setScoreFilter(e.target.value)}>
              <option value="all">All scores</option>
              <option value="high">70 - 100 (Strong)</option>
              <option value="mid">50 - 69 (Needs work)</option>
              <option value="low">Below 50 (Weak)</option>
            </select>
          </label>
          <label className="field" style={{ maxWidth: 160, marginBottom: 0 }}>
            <span>From date</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="field" style={{ maxWidth: 160, marginBottom: 0 }}>
            <span>To date</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {(dateFrom || dateTo) && (
            <button className="btn ghost" style={{ marginBottom: 0 }} onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear dates</button>
          )}
          <label className="field" style={{ maxWidth: 220, marginBottom: 0 }}>
            <span>Sort by</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="score_desc">Highest score first</option>
              <option value="score_asc">Lowest score first</option>
            </select>
          </label>
          <button className="btn outline" onClick={exportCsv} style={{ marginBottom: 0 }}>⬇ Export CSV{filterTeam !== "all" ? ` (${filterTeam})` : ""}</button>
        </div>

        <div className="card">
          <table className="table">
            <thead><tr><th>Employee</th><th>Team</th><th>Scenario</th><th>Date</th><th>Score</th><th></th></tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={6} className="mini" style={{ padding: 20 }}>No calls match this filter.</td></tr>}
              {pageRows.map((c) => (
                <tr key={c.id}>
                  <td><b>{employees[c.user_id]?.full_name || "—"}</b></td>
                  <td className="mini">{employees[c.user_id]?.team || "—"}</td>
                  <td>{scenarios[c.scenario_id] || "Scenario"}</td>
                  <td className="mini">
                    {new Date(c.created_at).toLocaleDateString()}
                    <br />
                    {new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td><span className={`pill ${c.overall >= 70 ? "red" : "gray"}`}>{c.overall}/100</span></td>
                  <td style={{ textAlign: "right" }}><button className="btn ghost" onClick={() => openReport(c)}>View report</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length > 0 && (
          <div className="row-between" style={{ marginTop: 14 }}>
            <div className="mini">
              Showing {(pageSafe - 1) * PAGE_SIZE + 1}-{Math.min(pageSafe * PAGE_SIZE, sorted.length)} of {sorted.length}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn outline sm" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}>← Prev</button>
              <span className="mini">Page {pageSafe} of {totalPages}</span>
              <button className="btn outline sm" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)}>Next →</button>
            </div>
          </div>
        )}

        {open && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }} onClick={() => setOpen(null)}>
            <div id="printable-report" className="card pad scroll" style={{ width: 620, maxWidth: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div className="row-between no-print" style={{ marginBottom: 10 }}>
                <b>{employees[open.user_id]?.full_name} — {scenarios[open.scenario_id] || "Scenario"}</b>
                <span style={{ cursor: "pointer", color: "#9aa0aa" }} onClick={() => setOpen(null)}>✕</span>
              </div>
              <div className="grid2" style={{ marginBottom: 12 }}>
                <div className="tile"><div className="kpi-label">Overall Score</div><div className="kpi">{open.overall}/100</div></div>
                <div className="tile"><div className="kpi-label">Priority Action</div><div style={{ fontSize: 13 }}>{open.priority_action}</div></div>
              </div>
              <div className="tile" style={{ marginBottom: 12 }}>
                <div className="kpi-label">Executive Summary</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{open.executive_summary}</div>
              </div>
              {open.progress_note && (
                <div className="tile" style={{ marginBottom: 12 }}>
                  <div className="kpi-label">Progress Note</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{open.progress_note}</div>
                </div>
              )}

              {open.vas_coverage?.length > 0 && (
                <div className="tile" style={{ marginBottom: 12 }}>
                  <div className="kpi-label">Opportunity Coverage</div>
                  <div className="mini" style={{ marginBottom: 6 }}>Did the rep catch these real operational pain points and pitch the right product?</div>
                  {open.vas_coverage.filter((v) => !v.identified).length > 0 && (
                    <div className="mini" style={{ marginBottom: 8, fontWeight: 700, color: "var(--red-dark)" }}>
                      {open.vas_coverage.filter((v) => !v.identified).length} of {open.vas_coverage.length} services not explained: {open.vas_coverage.filter((v) => !v.identified).map((v) => v.service_name).join(", ")}
                    </div>
                  )}
                  {open.vas_coverage.map((v, i) => (
                    <div key={i} className="row-between" style={{ padding: "6px 0", borderTop: i > 0 ? "1px solid var(--line)" : "none" }}>
                      <div style={{ fontSize: 13 }}><b>{v.service_name}</b> — <span className="mini">{v.comment}</span></div>
                      <span className={`pill ${v.identified ? "" : "gray"}`} style={v.identified ? { background: "#e8f6ee", color: "#15803d" } : {}}>
                        {v.identified ? "✓ Caught" : "Missed"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {open.stage_coverage?.length > 0 && (
                <div className="tile" style={{ marginBottom: 12 }}>
                  <div className="kpi-label">Process Adherence</div>
                  <div className="mini" style={{ marginBottom: 6 }}>Did the rep cover each required pitch section, in order, before moving on?</div>
                  {open.stage_coverage.map((v, i) => (
                    <div key={i} className="row-between" style={{ padding: "6px 0", borderTop: i > 0 ? "1px solid var(--line)" : "none" }}>
                      <div style={{ fontSize: 13 }}><b>{v.section_title}</b> — <span className="mini">{v.comment}</span></div>
                      <span className={`pill ${v.covered ? "" : "gray"}`} style={v.covered ? { background: "#e8f6ee", color: "#15803d" } : {}}>
                        {v.covered ? (v.followed_order ? "✓ Covered" : "✓ Covered (out of order)") : "Missed"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {open.strengths?.length > 0 && (
                <div className="tile" style={{ marginBottom: 12, background: "#e8f6ee", borderColor: "#cdead9" }}>
                  <div className="kpi-label" style={{ color: "#15803d" }}>Strengths</div>
                  {open.strengths.map((s, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}>✓ {s}</div>)}
                </div>
              )}
              {open.improvements?.length > 0 && (
                <div className="tile" style={{ marginBottom: 12, background: "#fdeaec", borderColor: "#f0c9cd" }}>
                  <div className="kpi-label" style={{ color: "var(--red-dark)" }}>Areas of Improvement</div>
                  {open.improvements.map((s, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}>✕ {s}</div>)}
                </div>
              )}
              <div className="kpi-label" style={{ margin: "16px 0 8px" }}>Evaluation Feedback</div>
              <div className="grid2">
                {Object.entries(open.parameter_scores || {}).map(([name, v]) => (
                  <div key={name} className="tile">
                    <div className="row-between"><b style={{ fontSize: 13 }}>{name}</b><span className="pill red">{v.score}%</span></div>
                    <div className="mini" style={{ marginTop: 6 }}>{v.comment}</div>
                  </div>
                ))}
              </div>
              <div className="grid2" style={{ marginTop: 12 }}>
                <div className="tile"><div className="kpi-label">Empathy Score</div><div className="kpi" style={{ fontSize: 24 }}>{open.empathy_score}/100</div></div>
                <div className="tile"><div className="kpi-label">Adaptability Score</div><div className="kpi" style={{ fontSize: 24 }}>{open.adaptability_score}/100</div></div>
              </div>
              {open.coachable_moments?.length > 0 && (
                <>
                  <div className="kpi-label" style={{ margin: "16px 0 8px" }}>Coachable Moments</div>
                  {open.coachable_moments.map((m, i) => (
                    <div key={i} className="tile" style={{ marginBottom: 10 }}>
                      <div className="mini">Turn {m.turn}</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}><b>They said:</b> {m.said}</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}><b>Why it matters:</b> {m.why_it_matters}</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}><b>Better approach:</b> {m.better_approach}</div>
                    </div>
                  ))}
                </>
              )}
              {open.recording_url ? (
                <a href={open.recording_url} target="_blank" rel="noreferrer" className="btn outline full no-print" style={{ marginTop: 14 }}>⬇ Download call recording</a>
              ) : (
                <div className="mini no-print" style={{ marginTop: 14 }}>Recording unavailable (older than 30 days, or none was captured).</div>
              )}
              <button className="btn dark full no-print" style={{ marginTop: 8 }} onClick={() => window.print()}>⬇ Download report as PDF</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
