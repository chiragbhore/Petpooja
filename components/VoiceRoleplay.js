import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/* ---------- small audio helpers ---------- */
function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
function base64FromBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function bytesFromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

export default function VoiceRoleplay({ scenario, onClose }) {
  const [state, setState] = useState("idle"); // idle | connecting | live | ended | error
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [report, setReport] = useState(null);
  const [scoring, setScoring] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reconnectingUI, setReconnectingUI] = useState(false);

  const sessionRef = useRef(null);
  const inCtxRef = useRef(null);
  const outCtxRef = useRef(null);
  const streamRef = useRef(null);
  const procRef = useRef(null);
  const nextPlayRef = useRef(0);
  const activeSourcesRef = useRef([]);
  const transcriptRef = useRef([]);
  const curInRef = useRef("");
  const curOutRef = useRef("");
  const recorderRef = useRef(null);
  const recChunksRef = useRef([]);
  const recDestRef = useRef(null);
  const tokenRef = useRef(null);
  const modelRef = useRef(null);
  const resumeHandleRef = useRef(null);
  const reconnectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const intentionallyClosedRef = useRef(false);
  const keepAliveRef = useRef(null);
  const timerRef = useRef(null);
  const callStartTimeRef = useRef(0);
  const userIdRef = useRef(null);
  const lastAudioInRef = useRef(0);

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };
  };

  const logEvent = (event, detail) => {
    const secs = callStartTimeRef.current ? Math.round((Date.now() - callStartTimeRef.current) / 1000) : 0;
    console.log("[PitchLab]", event, detail || "", "at", secs + "s");
    supabase.from("voice_call_logs").insert({
      user_id: userIdRef.current,
      scenario_id: scenario?.id || null,
      event,
      detail: detail ? String(detail).slice(0, 500) : null,
      elapsed_seconds: secs,
    }).then(() => {}).catch(() => {});
  };

  const cleanup = () => {
    intentionallyClosedRef.current = true;
    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { procRef.current && procRef.current.disconnect(); } catch {}
    try { streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
    try { inCtxRef.current && inCtxRef.current.state !== "closed" && inCtxRef.current.close(); } catch {}
    try { sessionRef.current && sessionRef.current.close(); } catch {}
    try { recorderRef.current && recorderRef.current.state !== "inactive" && recorderRef.current.stop(); } catch {}
    activeSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    activeSourcesRef.current = [];
    reconnectingRef.current = false;
    setReconnectingUI(false);
    sessionRef.current = null;
  };

  useEffect(() => () => cleanup(), []);

  const playChunk = (b64) => {
    const bytes = bytesFromBase64(b64);
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;
    const ctx = outCtxRef.current;
    const buf = ctx.createBuffer(1, float32.length, 24000);
    buf.copyToChannel(float32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    if (recDestRef.current) src.connect(recDestRef.current);
    const now = ctx.currentTime;
    const start = Math.max(now, nextPlayRef.current);
    src.start(start);
    nextPlayRef.current = start + buf.duration;
    setSpeaking(true);
    activeSourcesRef.current.push(src);
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
      if (nextPlayRef.current <= ctx.currentTime + 0.05) setSpeaking(false);
    };
  };

  const stopPlaybackForInterruption = () => {
    activeSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    activeSourcesRef.current = [];
    if (outCtxRef.current) nextPlayRef.current = outCtxRef.current.currentTime;
    setSpeaking(false);
    curOutRef.current = "";
  };

  const proactiveReconnect = () => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    setReconnectingUI(true);
    logEvent("reconnect_attempt", "proactive (GoAway warning)");
    const oldSession = sessionRef.current;
    connectGemini()
      .then((s) => {
        sessionRef.current = s;
        reconnectingRef.current = false;
        setReconnectingUI(false);
        logEvent("reconnect_ok", "proactive");
        try { oldSession && oldSession.close(); } catch {}
      })
      .catch((err) => {
        logEvent("reconnect_failed", "proactive: " + (err?.message || err));
        reconnectingRef.current = false;
        setReconnectingUI(false);
      });
  };

  const connectGemini = async () => {
    console.log("[PitchLab] connectGemini() called - attempt #" + reconnectAttemptsRef.current + ", resumeHandle:", resumeHandleRef.current);
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: tokenRef.current, httpOptions: { apiVersion: "v1alpha" } });
    let mySession = null;

    const session = await ai.live.connect({
      model: modelRef.current,
      callbacks: {
        onopen: () => {
          logEvent("connected");
          reconnectAttemptsRef.current = 0;
        },
        onmessage: (msg) => {
          const audio = msg.data;
          if (audio) playChunk(audio);
          const sc = msg.serverContent;
          if (sc?.interrupted) {
            logEvent("interrupted");
            stopPlaybackForInterruption();
          }
          if (sc?.inputTranscription?.text) curInRef.current += sc.inputTranscription.text;
          if (sc?.outputTranscription?.text) curOutRef.current += sc.outputTranscription.text;
          if (sc?.turnComplete) {
            if (curInRef.current.trim()) transcriptRef.current.push({ role: "REP", text: curInRef.current.trim() });
            if (curOutRef.current.trim()) transcriptRef.current.push({ role: "PROSPECT", text: curOutRef.current.trim() });
            curInRef.current = ""; curOutRef.current = "";
          }
          if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate?.newHandle) {
            resumeHandleRef.current = msg.sessionResumptionUpdate.newHandle;
          }
          if (msg.goAway) {
            logEvent("go_away_notice", "timeLeft: " + msg.goAway.timeLeft);
            proactiveReconnect();
          }
        },
        onerror: (e) => {
          if (sessionRef.current && sessionRef.current !== mySession) return;
          logEvent("error", e?.message || e);
          if (intentionallyClosedRef.current) return;
          setError(e?.message || "Connection error. The free voice line may be busy - try again in a moment.");
          setState("error");
          cleanup();
        },
        onclose: (ev) => {
          if (sessionRef.current && sessionRef.current !== mySession) return;
          logEvent("connection_closed", ev?.reason || "");
          if (intentionallyClosedRef.current) return;
          if (reconnectingRef.current) return;
          if (reconnectAttemptsRef.current >= 5) {
            logEvent("reconnect_giveup", "5 attempts exhausted");
            setError("Lost the connection and couldn't reconnect. Please end the call and start a new one.");
            setState("error");
            return;
          }
          reconnectAttemptsRef.current += 1;
          reconnectingRef.current = true;
          setReconnectingUI(true);
          logEvent("reconnect_attempt", "reactive (unexpected close): " + (ev?.reason || ""));
          connectGemini()
            .then((s) => {
              sessionRef.current = s;
              reconnectingRef.current = false;
              setReconnectingUI(false);
              logEvent("reconnect_ok", "reactive");
            })
            .catch((err) => {
              logEvent("reconnect_failed", "reactive: " + (err?.message || err));
              reconnectingRef.current = false;
              setReconnectingUI(false);
              setError("Lost the connection and couldn't reconnect. Please end the call and start a new one.");
              setState("error");
            });
        },
      },
      config: {
        responseModalities: ["AUDIO"],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: resumeHandleRef.current ? { handle: resumeHandleRef.current } : {},
      },
    });
    mySession = session;
    return session;
  };

  const start = async () => {
    setError("");
    setState("connecting");
    intentionallyClosedRef.current = false;
    reconnectAttemptsRef.current = 0;
    resumeHandleRef.current = null;
    setElapsed(0);
    callStartTimeRef.current = Date.now();
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      userIdRef.current = authSession?.user?.id || null;
      logEvent("call_start");

      const res = await fetch("/api/live-token", {
        method: "POST", headers: await authHeader(), body: JSON.stringify({ scenarioId: scenario.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not start the call.");
      tokenRef.current = json.token;
      modelRef.current = json.model;

      const outCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      outCtxRef.current = outCtx;
      nextPlayRef.current = 0;
      const recDest = outCtx.createMediaStreamDestination();
      recDestRef.current = recDest;

      const session = await connectGemini();
      sessionRef.current = session;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const inCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      inCtxRef.current = inCtx;
      const source = inCtx.createMediaStreamSource(stream);
      const proc = inCtx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      proc.onaudioprocess = (ev) => {
        if (!sessionRef.current || reconnectingRef.current) return;
        const input = ev.inputBuffer.getChannelData(0);
        const pcm = floatTo16BitPCM(input);
        const b64 = base64FromBytes(new Uint8Array(pcm.buffer));
        try {
          sessionRef.current.sendRealtimeInput({ audio: { data: b64, mimeType: "audio/pcm;rate=16000" } });
          lastAudioInRef.current = Date.now();
        } catch {}
      };
      source.connect(proc);
      proc.connect(inCtx.destination);

      try {
        const micSrc = outCtx.createMediaStreamSource(stream);
        micSrc.connect(recDest);
      } catch {}

      try {
        recChunksRef.current = [];
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
        const recorder = new MediaRecorder(recDest.stream, { mimeType: mime });
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recChunksRef.current.push(e.data); };
        recorder.start(1000);
        recorderRef.current = recorder;
      } catch {}

      keepAliveRef.current = setInterval(() => {
        if (inCtxRef.current && inCtxRef.current.state !== "running") inCtxRef.current.resume().catch(() => {});
        if (outCtxRef.current && outCtxRef.current.state !== "running") outCtxRef.current.resume().catch(() => {});
      }, 15000);

      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      setState("live");
    } catch (e) {
      setError(e.message || "Could not start the call.");
      setState("error");
      cleanup();
    }
  };

  const end = async () => {
    logEvent("call_ended_by_user");
    let blob = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      blob = await new Promise((resolve) => {
        recorderRef.current.onstop = () => resolve(new Blob(recChunksRef.current, { type: "audio/webm" }));
        try { recorderRef.current.stop(); } catch { resolve(null); }
      });
    }

    cleanup();
    setState("ended");
    setSpeaking(false);
    if (curInRef.current.trim()) transcriptRef.current.push({ role: "REP", text: curInRef.current.trim() });
    if (curOutRef.current.trim()) transcriptRef.current.push({ role: "PROSPECT", text: curOutRef.current.trim() });

    const transcript = transcriptRef.current.map((t) => `${t.role}: ${t.text}`).join("\n");
    if (transcript.length < 20) return;

    setScoring(true);
    try {
      const headers = await authHeader();
      let uploadPromise = Promise.resolve(null);
      if (blob && blob.size > 0) {
        uploadPromise = (async () => {
          const { data: { session } } = await supabase.auth.getSession();
          const fileName = `${session.user.id}/${scenario.id}-${Date.now()}.webm`;
          const { error: upErr } = await supabase.storage.from("call-recordings").upload(fileName, blob, {
            contentType: "audio/webm", upsert: false,
          });
          if (upErr) { console.warn("Recording upload failed:", upErr.message); return null; }
          return fileName;
        })();
      }

      const scorePromise = fetch("/api/score-roleplay-v6", {
        method: "POST", headers,
        body: JSON.stringify({ scenarioId: scenario.id, transcript }),
      }).then((r) => r.json().then((json) => ({ ok: r.ok, json })));

      const [{ ok, json }, recordingPath] = await Promise.all([scorePromise, uploadPromise]);

      if (!ok || !json.saved) {
        setError(json.error || "Could not generate the report. Please try again.");
        setScoring(false);
        return;
      }
      setReport(json.report);
      setScoring(false);

      if (recordingPath && json.report?.id) {
        fetch("/api/attach-recording", {
          method: "POST", headers,
          body: JSON.stringify({ resultId: json.report.id, recordingPath }),
        }).then((r) => r.json()).then((j) => {
          if (j.recording_url) setReport((prev) => prev && { ...prev, recording_url: j.recording_url });
        }).catch(() => {});
      }
      return;
    } catch (e) {
      console.error("Roleplay scoring/upload failed:", e);
      setError("Something went wrong generating the report: " + (e && e.message ? e.message : "unknown error"));
    }
    setScoring(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}
         onClick={() => { cleanup(); onClose(); }}>
      <div className="card pad" style={{ width: report ? 620 : 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <b>{scenario.title}</b>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(state === "connecting" || state === "live") && (
              <span className="pill red" style={{ fontVariantNumeric: "tabular-nums" }}>⏱ {formatDuration(elapsed)}</span>
            )}
            <span style={{ cursor: "pointer", color: "#9aa0aa" }} onClick={() => { cleanup(); onClose(); }}>✕</span>
          </div>
        </div>

        {report ? (
          <div id="printable-report" className="scroll" style={{ maxHeight: "72vh", overflowY: "auto", paddingRight: 4 }}>
            <div className="grid2" style={{ marginBottom: 12 }}>
              <div className="tile"><div className="kpi-label">Overall Score</div><div className="kpi">{report.overall}/100</div></div>
              <div className="tile"><div className="kpi-label">Priority Action</div><div style={{ fontSize: 13 }}>{report.priority_action}</div></div>
            </div>
            <div className="tile" style={{ marginBottom: 12 }}>
              <div className="kpi-label">Executive Summary</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{report.executive_summary}</div>
            </div>
            {report.progress_note && (
              <div className="tile" style={{ marginBottom: 12 }}>
                <div className="kpi-label">Progress Note</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{report.progress_note}</div>
              </div>
            )}

            {report.vas_coverage?.length > 0 && (
              <div className="tile" style={{ marginBottom: 12 }}>
                <div className="kpi-label">Opportunity Coverage</div>
                <div className="mini" style={{ marginBottom: 6 }}>Did the rep catch these real operational pain points and pitch the right product?</div>
{report.vas_coverage.filter(v => !v.identified).length > 0 && (
                    <div className="mini" style={{ marginBottom: 8, fontWeight: 700, color: "var(--red-dark)" }}>
                      {report.vas_coverage.filter(v => !v.identified).length} of {report.vas_coverage.length} services not explained: {report.vas_coverage.filter(v => !v.identified).map(v => v.service_name).join(", ")}
                    </div>
                  )}
                {report.vas_coverage.map((v, i) => (
                  <div key={i} className="row-between" style={{ padding: "6px 0", borderTop: i > 0 ? "1px solid var(--line)" : "none" }}>
                    <div style={{ fontSize: 13 }}>
                      <b>{v.service_name}</b> — <span className="mini">{v.comment}</span>
                    </div>
                    <span className={`pill ${v.identified ? "" : "gray"}`} style={v.identified ? { background: "#e8f6ee", color: "#15803d" } : {}}>
                      {v.identified ? "✓ Caught" : "Missed"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {report.stage_coverage?.length > 0 && (
              <div className="tile" style={{ marginBottom: 12 }}>
                <div className="kpi-label">Process Adherence</div>
                <div className="mini" style={{ marginBottom: 6 }}>Did the rep cover each required pitch section, in order, before moving on?</div>
                {report.stage_coverage.map((v, i) => (
                  <div key={i} className="row-between" style={{ padding: "6px 0", borderTop: i > 0 ? "1px solid var(--line)" : "none" }}>
                    <div style={{ fontSize: 13 }}><b>{v.section_title}</b> — <span className="mini">{v.comment}</span></div>
                    <span className={`pill ${v.covered ? "" : "gray"}`} style={v.covered ? { background: "#e8f6ee", color: "#15803d" } : {}}>
                      {v.covered ? (v.followed_order ? "✓ Covered" : "✓ Covered (out of order)") : "Missed"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {report.strengths?.length > 0 && (
              <div className="tile" style={{ marginBottom: 12, background: "#e8f6ee", borderColor: "#cdead9" }}>
                <div className="kpi-label" style={{ color: "#15803d" }}>Strengths</div>
                {report.strengths.map((s, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}>✓ {s}</div>)}
              </div>
            )}
            {report.improvements?.length > 0 && (
              <div className="tile" style={{ marginBottom: 12, background: "#fdeaec", borderColor: "#f0c9cd" }}>
                <div className="kpi-label" style={{ color: "var(--red-dark)" }}>Areas of Improvement</div>
                {report.improvements.map((s, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}>✕ {s}</div>)}
              </div>
            )}

            <div className="kpi-label" style={{ margin: "16px 0 8px" }}>Evaluation Feedback</div>
            <div className="grid2">
              {Object.entries(report.parameter_scores || {}).map(([name, v]) => (
                <div key={name} className="tile">
                  <div className="row-between"><b style={{ fontSize: 13 }}>{name}</b><span className="pill red">{v.score}%</span></div>
                  <div className="mini" style={{ marginTop: 6 }}>{v.comment}</div>
                </div>
              ))}
            </div>

            <div className="grid2" style={{ marginTop: 12 }}>
              <div className="tile"><div className="kpi-label">Empathy Score</div><div className="kpi" style={{ fontSize: 24 }}>{report.empathy_score}/100</div></div>
              <div className="tile"><div className="kpi-label">Adaptability Score</div><div className="kpi" style={{ fontSize: 24 }}>{report.adaptability_score}/100</div></div>
            </div>
            {report.ei_feedback && <div className="mini" style={{ marginTop: 8 }}>{report.ei_feedback}</div>}

            {report.coachable_moments?.length > 0 && (
              <>
                <div className="kpi-label" style={{ margin: "16px 0 8px" }}>Coachable Moments</div>
                {report.coachable_moments.map((m, i) => (
                  <div key={i} className="tile" style={{ marginBottom: 10 }}>
                    <div className="mini">Turn {m.turn}</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}><b>You said:</b> {m.said}</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}><b>Why it matters:</b> {m.why_it_matters}</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}><b>Better approach:</b> {m.better_approach}</div>
                  </div>
                ))}
              </>
            )}

            {report.recording_url && (
              <a href={report.recording_url} target="_blank" rel="noreferrer" className="btn outline full no-print" style={{ marginTop: 8 }}>
                ⬇ Download call recording
              </a>
            )}
            <button className="btn dark full no-print" style={{ marginTop: 8 }} onClick={() => window.print()}>
              ⬇ Download report as PDF
            </button>
            <button className="btn primary full no-print" style={{ marginTop: 8 }} onClick={() => { cleanup(); onClose(); }}>Done</button>
          </div>
        ) : (
          <div>
            <div style={{ border: "2px dashed var(--line)", borderRadius: 12, padding: 26, textAlign: "center" }}>
              <div style={{ fontSize: 40 }}>{reconnectingUI ? "🔄" : state === "live" ? (speaking ? "🔊" : "🎙️") : "📞"}</div>
              <div style={{ fontWeight: 700, marginTop: 8 }}>
                {state === "idle" && "Ready to practice"}
                {state === "connecting" && "Connecting the call…"}
                {state === "live" && reconnectingUI && "Reconnecting… one moment"}
                {state === "live" && !reconnectingUI && (speaking ? "Prospect is speaking…" : "Your turn — speak naturally")}
                {state === "ended" && (scoring ? "Scoring your call…" : "Call ended")}
                {state === "error" && "Couldn't connect"}
              </div>
              {state === "live" && reconnectingUI && <p className="mini" style={{ marginTop: 6 }}>Briefly reconnecting the voice line — this happens automatically every so often. Just a second.</p>}
              {state === "live" && !reconnectingUI && <p className="mini" style={{ marginTop: 6 }}>Talk into your mic like a real sales call. Click End when you're done.</p>}
              {error && <p className="mini" style={{ marginTop: 8, color: "var(--red-dark)" }}>{error}</p>}
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              {(state === "idle" || state === "error") && <button className="btn primary full" onClick={start}>Start call</button>}
              {(state === "connecting" || state === "live") && <button className="btn danger full" onClick={end}>End call</button>}
              {state === "ended" && !scoring && <button className="btn outline full" onClick={() => { cleanup(); onClose(); }}>Close</button>}
            </div>

            <div className="tile" style={{ marginTop: 14, textAlign: "left" }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <b>Scenario brief</b>
                <div style={{ display: "flex", gap: 6 }}>
                  <span className={`pill diff-${scenario.difficulty}`}>{scenario.difficulty}</span>
                  <span className="pill">{scenario.category || "General"}</span>
                </div>
              </div>
              <div className="mini" style={{ display: "grid", gap: 6, textAlign: "left" }}>
                {scenario.account_name && <div><b>Account:</b> {scenario.account_name}</div>}
                <div><b>Persona:</b> {scenario.persona}</div>
                {scenario.product && <div><b>Product:</b> {scenario.product}</div>}
                {scenario.traits && <div><b>Personality:</b> {scenario.traits}</div>}
                {scenario.objections && <div><b>Likely objections:</b> {scenario.objections}</div>}
                {scenario.goal && <div><b>Your goal:</b> {scenario.goal}</div>}
                {Array.isArray(scenario.demo_stages) && scenario.demo_stages.length > 0 && (
                  <div>
                    <b>Pitch sections to cover:</b>
                    <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {scenario.demo_stages.map((st, i) => <li key={i}>{st.title || `Section ${i + 1}`}</li>)}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
