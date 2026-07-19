export default function ClassroomRoom({ roomUrl, onClose }) {
  if (!roomUrl) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 100, display: "grid", placeItems: "center" }}>
        <div style={{ color: "#fff", textAlign: "center" }}>
          <p>This session doesn't have a video room yet.</p>
          <button className="btn danger" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 100, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#14161a" }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Live classroom</span>
        <button className="btn danger" onClick={onClose}>Leave</button>
      </div>
      <iframe
        src={roomUrl}
        allow="camera; microphone; fullscreen; display-capture; autoplay"
        style={{ flex: 1, border: "none", width: "100%" }}
        title="Live classroom"
      />
    </div>
  );
}
