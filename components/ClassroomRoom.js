import { useEffect, useRef } from "react";

// Embeds a free Jitsi Meet video room. No account needed for participants —
// only the very first person into a brand-new room (the host/admin) may be
// asked to sign in with Google/GitHub once, as Jitsi's free-tier spam guard.
export default function ClassroomRoom({ roomName, displayName, onClose }) {
  const containerRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      if (cancelled) return;
      if (!window.JitsiMeetExternalAPI) return;
      const api = new window.JitsiMeetExternalAPI("meet.jit.si", {
        roomName: "pitchlab-" + roomName,
        parentNode: containerRef.current,
        width: "100%",
        height: "100%",
        userInfo: { displayName: displayName || "Trainee" },
        configOverwrite: { prejoinPageEnabled: false, disableDeepLinking: true },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, SHOW_WATERMARK_FOR_GUESTS: false },
      });
      apiRef.current = api;
      api.addEventListener("readyToClose", () => { if (onClose) onClose(); });
    };

    if (window.JitsiMeetExternalAPI) {
      load();
    } else {
      const script = document.createElement("script");
      script.src = "https://meet.jit.si/external_api.js";
      script.async = true;
      script.onload = load;
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (apiRef.current) { try { apiRef.current.dispose(); } catch {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 100, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#14161a" }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Live classroom</span>
        <button className="btn danger" onClick={onClose}>Leave</button>
      </div>
      <div ref={containerRef} style={{ flex: 1 }} />
    </div>
  );
}
