import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import VersusCountdown from "../src/components/VersusCountdown.jsx";
import "../src/styles/tokens.css";

function Preview() {
  const [show, setShow] = useState(false);
  const [finished, setFinished] = useState(false);
  return <main style={{ minHeight: "100dvh", display: "grid", placeContent: "center", textAlign: "center", gap: 20, background: "#faf8f1", padding: 24 }}>
    <span style={{ fontSize: 12, letterSpacing: ".2em" }}>KITCHEN PATH / VERSUS</span>
    <h1 style={{ margin: 0 }}>{finished ? "Let’s cook!" : "A little friendly heat."}</h1>
    <p style={{ margin: 0 }}>双人比赛开场 · Mia vs Leo · 3 → 2 → 1</p>
    <button className="btn btn-primary" onClick={() => setShow(true)}>{finished ? "再看一次" : "播放赛前倒计时"}</button>
    <small>这是独立预览，不会创建或修改你的比赛。</small>
    {show && <VersusCountdown cooks={[{ name: "Mia" }, { name: "Leo" }]} title="Mapo tofu & chicken noodle soup"
      onCancel={() => setShow(false)} onComplete={() => { setShow(false); setFinished(true); }} />}
  </main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><Preview /></React.StrictMode>);
