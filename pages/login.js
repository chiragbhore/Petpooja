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
    <div className="center-screen" style={{ position: "relative" }}>
      <div style={{ position: "absolute", top: 20, right: 20 }}><ThemeToggle /></div>
      <div className="card pad" style={{ width: 380 }}>
        <img src="/petpooja.png" alt="Petpooja" className="logo-lg" />
        <h1 className="page" style={{ fontSize: 22 }}>Sign in to PitchLab</h1>
        <p className="sub" style={{ marginBottom: 20 }}>Petpooja Sales Training portal</p>

        {err && <div className="msg err">{err}</div>}

        <form onSubmit={submit}>
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
          <button className="btn primary full" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mini" style={{ marginTop: 16, textAlign: "center" }}>
          No account? Ask your admin to create one for you.
        </p>
      </div>
    </div>
  );
}
