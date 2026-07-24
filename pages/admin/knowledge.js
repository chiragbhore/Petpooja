import { useEffect, useState } from "react";
import { useProfile, hasPermission } from "../../lib/useProfile";
import { supabase } from "../../lib/supabaseClient";
import Sidebar from "../../components/Sidebar";

export default function AdminKnowledge() {
  const { loading, me } = useProfile(["admin", "trainer"]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ name: "", key_facts: "" });
  const [msg, setMsg] = useState(null);

  const load = async () => {
    const { data } = await supabase.from("product_knowledge").select("*").order("sort_order", { ascending: true });
    setProducts(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  const add = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (!form.name.trim() || !form.key_facts.trim()) { setMsg("Fill in both the product name and its details."); return; }
    const { error } = await supabase.from("product_knowledge").insert({
      name: form.name, key_facts: form.key_facts, sort_order: products.length,
    });
    if (error) { setMsg(error.message); return; }
    setForm({ name: "", key_facts: "" });
    load();
  };

  const del = async (id) => { if (confirm("Remove this product from the knowledge base?")) { await supabase.from("product_knowledge").delete().eq("id", id); load(); } };

  if (loading) return <div className="center-screen"><div className="mini">Loading…</div></div>;
  if (me.role === "trainer" && !hasPermission(me, "knowledge")) {
    return <div className="center-screen"><div className="mini">You don't have access to this section — ask your admin to grant it.</div></div>;
  }

  return (
    <div className="shell">
      <Sidebar role={me.role} me={me} />
      <main className="content">
        <h1 className="page">Product knowledge base</h1>
        <p className="sub">
          What you add here is what the AI prospect actually knows. During roleplay it will challenge
          reps with follow-up questions on any product they mention — the more real detail you give it,
          the sharper those questions get. Add at least 2 products for cross-questioning to feel real.
        </p>
        {msg && <div className="msg err">{msg}</div>}

        <div className="card pad" style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Add a product</div>
          <form onSubmit={add}>
            <label className="field"><span>Product name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Petpooja POS — Core Billing" required /></label>
            <label className="field"><span>Key facts, features, pricing structure, common objections</span>
              <textarea rows={6} value={form.key_facts} onChange={(e) => setForm({ ...form, key_facts: e.target.value })}
                placeholder={"e.g.\n- Handles dine-in, delivery, and takeaway billing in one screen\n- Syncs inventory in real time across outlets\n- Setup takes under a day, no separate hardware needed\n- Common objection: \"my current system already works fine\""} />
            </label>
            <button className="btn primary">Add product</button>
          </form>
        </div>

        {products.map((p) => (
          <div key={p.id} className="card pad" style={{ marginBottom: 12 }}>
            <div className="row-between">
              <b>{p.name}</b>
              <button className="btn danger" onClick={() => del(p.id)}>Remove</button>
            </div>
            <div className="mini" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{p.key_facts}</div>
          </div>
        ))}
        {products.length === 0 && <div className="mini">No products added yet — the AI has no knowledge base to test reps on until you add some.</div>}
      </main>
    </div>
  );
}