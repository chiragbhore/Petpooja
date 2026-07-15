import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("pitchlab-theme") || "light";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("pitchlab-theme", next);
  };

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Toggle light or dark theme">
      {theme === "light" ? "🌙 Dark" : "☀️ Light"}
    </button>
  );
}
