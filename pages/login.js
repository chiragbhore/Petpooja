import { useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import ThemeToggle from "../components/ThemeToggle";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErr(error.message || "Could not sign in. Check your email and password.");
      setBusy(false);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();
    router.replace(profile?.role === "admin" ? "/admin" : "/employee");
  };

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-logo">
          <img src="/petpooja.png" alt="Petpooja" />
          <span>PitchLab</span>
        </div>

        <div className="auth-brand-mid">
          <p className="eyebrow" style={{ color: "rgba(255,255,255,.7)" }}>Sales training portal</p>
          <h1 className="auth-headline">Practice the pitch.<br />Close the restaurant.</h1>
          <p className="auth-lede">
            Live AI voice roleplay, instant scored feedback, and coaching on every objection —
            so your first real call isn't your first practice.
          </p>

          <div className="wave" aria-hidden="true">
            {Array.from({ length: 40 }).map((_, i) => (
              <span key={i} style={{ animationDelay: `${(i % 10) * 0.08}s` }} />
            ))}
          </div>

          <div className="auth-chips">
            <div className="auth-chip"><b>7</b><span>audit parameters</span></div>
            <div className="auth-chip"><b>Live</b><span>AI voice calls</span></div>
            <div className="auth-chip"><b>Instant</b><span>pitch reports</span></div>
          </div>
        </div>

        <p className="auth-brand-foot">Petpooja · Restaurant POS · Sales enablement</p>
      </aside>

      <main className="auth-form-wrap">
        <form className="auth-card" onSubmit={submit}>
          <h2 className="auth-title">Sign in to PitchLab</h2>
          <p className="sub" style={{ marginBottom: 24 }}>Welcome back — let's get practicing.</p>

          {err && <div className="auth-err">{err}</div>}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@petpooja.com"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          <button className="btn block" disabled={busy} style={{ marginTop: 6, padding: "12px 18px" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="auth-help">No account? Ask your admin to create one for you.</p>
        </form>
      </main>

      <div className="theme-fab"><ThemeToggle /></div>
    </div>
  );
}
