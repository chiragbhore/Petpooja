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

export default function VoiceRoleplay({ scenario, onClose }) {
  const [state, setState] = useState("idle"); // idle | connecting | live | ended | error
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [report, setReport] = useState(null);
  const [scoring, setScoring] = useState(false);

  const sessionRef = useRef(null);
  const inCtxRef = useRef(null);
  const outCtxRef = useRef(null);
  const streamRef = useRef(null);
  const procRef = useRef(null);
  const nextPlayRef = useRef(0);
  const transcriptRef = useRef([]); // {role, text}
  const curInRef = useRef("");
  const curOutRef = useRef("");
  const recorderRef = useRef(null);
  const recChunksRef = useRef([]);
  const recDestRef = useRef(null); // MediaStreamDestination mixing mic + prospect audio

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };
  };

  const cleanup = () => {
    try { procRef.current && procRef.current.disconnect(); } catch {}
    try { streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
    try { inCtxRef.current && inCtxRef.current.close(); } catch {}
    try { sessionRef.current && sessionRef.current.close(); } catch {}
    try { recorderRef.current && recorderRef.current.state !== "inactive" && recorderRef.current.stop(); } catch {}
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
    src.onended = () => { if (nextPlayRef.current <= ctx.currentTime + 0.05) setSpeaking(false); };
  };

  const start = async () => {
    setError("");
    setState("connecting");
    try {
      // 1) get a short-lived token from our server
      const res = await fetch("/api/live-token", {
        method: "POST", headers: await authHeader(), body: JSON.stringify({ scenarioId: scenario.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not start the call.");

      // 2) connect to Gemini Live with the token
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: json.token, httpOptions: { apiVersion: "v1alpha" } });

      const outCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      outCtxRef.current = outCtx;
      nextPlayRef.current = 0;
      const recDest = outCtx.createMediaStreamDestination();
      recDestRef.current = recDest;

      const session = await ai.live.connect({
        model: json.model,
        callbacks: {
          onopen: () => {},
          onmessage: (msg) => {
            const audio = msg.data; // concatenated inline audio (base64) if present
            if (audio) playChunk(audio);
            const sc = msg.serverContent;
            if (sc?.inputTranscription?.text) curInRef.current += sc.inputTranscription.text;
            if (sc?.outputTranscription?.text) curOutRef.current += sc.outputTranscription.text;
            if (sc?.turnComplete) {
              if (curInRef.current.trim()) transcriptRef.current.push({ role: "REP", text: curInRef.current.trim() });
              if (curOutRef.current.trim()) transcriptRef.current.push({ role: "PROSPECT", text: curOutRef.current.trim() });
              curInRef.current = ""; curOutRef.current = "";
            }
          },
          onerror: (e) => { setError(e?.message || "Connection error. The free voice line may be busy — try again in a moment."); setState("error"); cleanup(); },
          onclose: () => {},
        },
        config: {
          responseModalities: ["AUDIO"],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
      sessionRef.current = session;

      // 3) capture microphone → stream PCM16 @ 16kHz
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const inCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      inCtxRef.current = inCtx;
      const source = inCtx.createMediaStreamSource(stream);
      const proc = inCtx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      proc.onaudioprocess = (ev) => {
        if (!sessionRef.current) return;
        const input = ev.inputBuffer.getChannelData(0);
        const pcm = floatTo16BitPCM(input);
        const b64 = base64FromBytes(new Uint8Array(pcm.buffer));
        try {
          sessionRef.current.sendRealtimeInput({ audio: { data: b64, mimeType: "audio/pcm;rate=16000" } });
        } catch {}
      };
      source.connect(proc);
      proc.connect(inCtx.destination);

      // mix the rep's mic into the same recording as the prospect's voice
      try {
        const micSrc = outCtx.createMediaStreamSource(stream);
        micSrc.connect(recDest);
      } catch {}

      // start recording the mixed call audio
      try {
        recChunksRef.current = [];
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
        const recorder = new MediaRecorder(recDest.stream, { mimeType: mime });
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recChunksRef.current.push(e.data); };
        recorder.start(1000);
        recorderRef.current = recorder;
      } catch {}

      setState("live");
    } catch (e) {
      setError(e.message || "Could not start the call.");
      setState("error");
      cleanup();
    }
  };

  const end = async () => {
    // grab the recorder's final chunk before we tear everything down
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
    if (transcript.length < 20) return; // nothing to score

    setScoring(true);
    try {
      const headers = await authHeader();

      // 1) upload the recording (best-effort — scoring still proceeds if this fails)
      let recordingPath = null;
      if (blob && blob.size > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        const fileName = `${session.user.id}/${scenario.id}-${Date.now()}.webm`;
        const { error: upErr } = await supabase.storage.from("call-recordings").upload(fileName, blob, {
          contentType: "audio/webm", upsert: false,
        });
        if (!upErr) recordingPath = fileName;
      }

      // 2) score the call against the audit parameters
      const res = await fetch("/api/score-roleplay", {
        method: "POST", headers,
        body: JSON.stringify({ scenarioId: scenario.id, transcript, recordingPath }),
      });
      const json = await res.json();
      if (json.saved) setReport(json.report);
    } catch {}
    setScoring(false);
  };

  const authHeaderNote = null; // (kept for clarity; auth handled inline above)

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,22,26,.5)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}
         onClick={() => { cleanup(); onClose(); }}>
      <div className="card pad" style={{ width: report ? 620 : 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <b>{scenario.title}</b>
          <span style={{ cursor: "pointer", color: "#9aa0aa" }} onClick={() => { cleanup(); onClose(); }}>✕</span>
        </div>

        {report ? (
          <div className="scroll" style={{ maxHeight: "72vh", overflowY: "auto", paddingRight: 4 }}>
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
              <a href={report.recording_url} target="_blank" rel="noreferrer" className="btn outline full" style={{ marginTop: 8 }}>
                ⬇ Download call recording
              </a>
            )}
            <button className="btn primary full" style={{ marginTop: 8 }} onClick={() => { cleanup(); onClose(); }}>Done</button>
          </div>
        ) : (
          <div>
            <div style={{ border: "2px dashed var(--line)", borderRadius: 12, padding: 26, textAlign: "center" }}>
              <div style={{ fontSize: 40 }}>{state === "live" ? (speaking ? "🔊" : "🎙️") : "📞"}</div>
              <div style={{ fontWeight: 700, marginTop: 8 }}>
                {state === "idle" && "Ready to practice"}
                {state === "connecting" && "Connecting the call…"}
                {state === "live" && (speaking ? "Prospect is speaking…" : "Your turn — speak naturally")}
                {state === "ended" && (scoring ? "Scoring your call…" : "Call ended")}
                {state === "error" && "Couldn't connect"}
              </div>
              {state === "live" && <p className="mini" style={{ marginTop: 6 }}>Talk into your mic like a real sales call. Click End when you're done.</p>}
              {error && <p className="mini" style={{ marginTop: 8, color: "var(--red-dark)" }}>{error}</p>}
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              {(state === "idle" || state === "error") && <button className="btn primary full" onClick={start}>Start call</button>}
              {(state === "connecting" || state === "live") && <button className="btn danger full" onClick={end}>End call</button>}
              {state === "ended" && !scoring && <button className="btn outline full" onClick={() => { cleanup(); onClose(); }}>Close</button>}
            </div>

            <div className="mini" style={{ marginTop: 14 }}>
              <b>Scenario brief</b><br />
              Persona: {scenario.persona}<br />
              {scenario.goal && <>Goal: {scenario.goal}</>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
