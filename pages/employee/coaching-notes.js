import { useEffect, useState } from "react";
import { useProfile } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function MyCoachingNotes() {
  const { loading, me } = useProfile("employee");
  const [items, setItems] = useState([]); // [{call, notes: []}]

  useEffect(() => {
    if (loading || !me) return;
    (async () => {
      const { data: calls } = await supabase
        .from("roleplay_results").select("*").eq("user_id", me.id)
        .order("created_at", { ascending: false });
      if (!calls || calls.length === 0) { setItems([]); return; }

      const { data: scs } = await supabase.from("scenarios").select("id, title, account_name");
      const scMap = {}; (scs || []).forEach((s) => { scMap[s.id] = s; });

      const { data: allNotes } = await supabase
        .from("call_notes").select("*").in("result_id", calls.map((c) => c.id))
        .order("created_at", { ascending: true });

      const grouped = calls.map((c) => ({
        call: c,
        scenario: scMap[c.scenario_id],
        notes: (allNotes || []).filter((n) => n.result_id === c.id),
      })).filter((g) => g.notes.length > 0);

      setItems(grouped);
    })();
  }, [loading, me]);

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;

  return (
    <div className="shell">
      <Sidebar role="employee" me={me} />
      <main className="content">
        <h1 className="page">Coaching notes</h1>
        <p className="sub">Feedback your manager left on your practice calls.</p>

        {items.length === 0 ? (
          <div className="card pad mini">No coaching notes yet.</div>
        ) : (
          items.map(({ call, scenario, notes }) => (
            <div key={call.id} className="card pad" style={{ marginBottom: 16 }}>
              <div className="row-between">
                <b>{scenario?.title || "Scenario"}{scenario?.account_name ? ` · ${scenario.account_name}` : ""}</b>
                <span className={`pill ${call.overall >= 70 ? "red" : "gray"}`}>{call.overall}/100</span>
              </div>
              <div className="mini" style={{ marginBottom: 10 }}>{new Date(call.created_at).toLocaleDateString()}</div>
              {notes.map((n) => (
                <div key={n.id} className="tile" style={{ marginBottom: 8 }}>
                  <div className="row-between mini"><b>{n.author_name || "Manager"}</b><span>{new Date(n.created_at).toLocaleString()}</span></div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{n.note}</div>
                </div>
              ))}
            </div>
          ))
        )}
      </main>
    </div>
  );
}
