// A door, not a lock.
//
// The app is laid out for a desktop viewport and nothing else: the
// schedule is a wide timeline, the live cook puts several lanes side by
// side, and none of it reflows. On a phone it does not degrade, it
// breaks — so a phone gets told that instead of being shown a mess.
//
// Deliberately NOT user-agent sniffing. What actually matters is the
// viewport and the pointer, which is also what a resized desktop window
// and a tablet report honestly, while UA strings lie routinely.
//
// There is an escape hatch on purpose (see OVERRIDE). Someone holding a
// tablet at a demo should be able to look anyway, and a hard block would
// be the kind of thing that ends a judge's interest in ten seconds.
import { useEffect, useState } from "react";
import "./DesktopOnly.css";

// Narrower than this and the schedule's lanes overlap. A phone in
// landscape can clear 800px, hence the pointer half: a coarse pointer at
// tablet width is a touch device, whatever its pixel count claims.
const QUERY = "(max-width: 900px), (pointer: coarse) and (max-width: 1180px)";

// ?anyway=1 keeps working for the rest of the tab's life.
const OVERRIDE_PARAM = "anyway";
const OVERRIDE_KEY = "kitchen-path.small-screen-ok";

function overridden() {
  try {
    if (new URLSearchParams(window.location.search).has(OVERRIDE_PARAM)) {
      sessionStorage.setItem(OVERRIDE_KEY, "1");
      return true;
    }
    return sessionStorage.getItem(OVERRIDE_KEY) === "1";
  } catch {
    return false; // blocked storage: the button below still works
  }
}

export function DesktopOnly({ children }) {
  const [tooSmall, setTooSmall] = useState(() => window.matchMedia(QUERY).matches);
  const [allowed, setAllowed] = useState(overridden);

  // Rotating a tablet or dragging a window narrow should change the
  // answer, not leave whichever one happened to be true at load.
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e) => setTooSmall(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!tooSmall || allowed) return children;

  const allow = () => {
    try {
      sessionStorage.setItem(OVERRIDE_KEY, "1");
    } catch {
      // Fine — state below still lets them through for this page load.
    }
    setAllowed(true);
  };

  return (
    <div className="kp-desktop-only">
      <div className="kp-desktop-only__card">
        <img
          className="kp-desktop-only__goose"
          src={`${import.meta.env.BASE_URL}avatars/unclaimed.png`}
          alt=""
          width="96"
          height="96"
        />
        <h1>This kitchen needs a bigger screen</h1>
        <p>
          Kitchen Path lays its schedule and live cook out across a wide
          timeline, and that layout has not been built for phones yet.
          Open this on a laptop or desktop in Chrome.
        </p>
        <p className="kp-desktop-only__aside">
          It also wants a microphone and WebGPU for the agent&rsquo;s voice,
          both of which behave best there.
        </p>
        <button type="button" className="kp-desktop-only__anyway" onClick={allow}>
          Show me anyway
        </button>
      </div>
    </div>
  );
}
