// The one screen built for a phone, because it is the only screen a
// phone will ever see. Implements "Mobile Blocked.dc.html" from the
// design project.
//
// The app is laid out for a desktop viewport and nothing else: the
// schedule is a wide timeline, the live cook puts several lanes side by
// side, and none of it reflows. On a phone it does not degrade, it
// breaks — so a phone gets told that, in a layout that fits.
//
// Deliberately NOT user-agent sniffing. What matters is the viewport and
// the pointer, which a resized desktop window and a tablet both report
// honestly, while UA strings lie routinely.
import { useEffect, useState } from "react";
import gooseInAJar from "../assets/goose-in-a-jar.png";
import { devMobilePreview } from "../dev/preview.js";
import "./DesktopOnly.css";

// Below this the schedule's lanes overlap and the live cook's columns
// collapse into each other. A phone in landscape clears 900px easily,
// hence the pointer half: a coarse pointer at tablet width is a touch
// device whatever its pixel count claims.
//
// NOT a 1920 test, even though the copy asks for 1080p. A 1080p laptop
// at 150% OS scaling reports 1280 CSS pixels, and most laptops land
// between 1280 and 1512 — a literal 1920 cutoff would turn away the very
// machines this demo is built for. Block on what actually breaks;
// recommend the rest in words.
const QUERY = "(max-width: 900px), (pointer: coarse) and (max-width: 1180px)";

// No visible override in the design, but ?anyway=1 still lets the team
// (or a judge on a tablet) through, and sticks for the tab.
const OVERRIDE_PARAM = "anyway";
const OVERRIDE_KEY = "kitchen-path.small-screen-ok";

const COPIED_MS = 2200;

// The frame ?preview=mobile draws, matching the design canvas mock.
const PREVIEW_SIZE = { w: 390, h: 844 };

function overridden() {
  try {
    if (new URLSearchParams(window.location.search).has(OVERRIDE_PARAM)) {
      sessionStorage.setItem(OVERRIDE_KEY, "1");
      return true;
    }
    return sessionStorage.getItem(OVERRIDE_KEY) === "1";
  } catch {
    return false; // blocked storage: the param still works for this load
  }
}

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

export function DesktopOnly({ children }) {
  const [tooSmall, setTooSmall] = useState(() => window.matchMedia(QUERY).matches);
  const [allowed] = useState(overridden);
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState(viewport);

  // Rotating a tablet or dragging a window narrow should change the
  // answer, not leave whichever one happened to be true at load. The
  // readout below tracks the same events, so it never goes stale.
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e) => setTooSmall(e.matches);
    const onResize = () => setSize(viewport());
    mq.addEventListener("change", onChange);
    window.addEventListener("resize", onResize);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);

  // The practical next step from a phone is getting this URL onto a
  // laptop, so make that one tap. Origin + pathname deliberately: it
  // drops ?anyway=1, so a copied link does not carry the override to
  // whoever opens it next.
  const copyLink = async () => {
    const link = window.location.origin + window.location.pathname;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard needs a secure context and can still be refused.
      // Selecting the text is the fallback that always works.
      window.prompt("Copy this link:", link);
    }
  };

  // ?preview=mobile (dev only) shows this screen in a phone-sized frame
  // on a desktop, so it can be reviewed without a device or a resized
  // window. Checked before the size gate, which would otherwise hide it
  // on the very screen doing the reviewing.
  if (devMobilePreview()) {
    return (
      <div className="kp-gate-preview">
        <div className="kp-gate-preview__device">
          <GateScreen size={PREVIEW_SIZE} copied={copied} onCopy={copyLink} framed />
        </div>
        <p className="kp-gate-preview__note">
          Dev preview at {PREVIEW_SIZE.w} × {PREVIEW_SIZE.h}. Drop
          <code>?preview=mobile</code> to use the app.
        </p>
      </div>
    );
  }

  if (!tooSmall || allowed) return children;

  return <GateScreen size={size} copied={copied} onCopy={copyLink} />;
}

function GateScreen({ size, copied, onCopy, framed = false }) {
  return (
    <main className={framed ? "kp-gate kp-gate--framed" : "kp-gate"}>
      <span className="kp-gate__wordmark">Goose! Goose! Cook!</span>

      <img
        className="kp-gate__goose"
        src={gooseInAJar}
        alt="A goose squashed inside a jar, wearing a chef toque"
        width="220"
        height="246"
      />

      <h1 className="kp-gate__title">Too cramped in here.</h1>
      <p className="kp-gate__lede">
        Goose needs a bigger kitchen. Open this on a desktop, 1080p or larger.
      </p>

      <div className="kp-gate__actions">
        <button type="button" className="kp-gate__copy" onClick={onCopy}>
          {copied ? "Copied. Honk!" : "Copy link"}
        </button>
        <span className="kp-gate__readout">
          Your screen: {size.w} × {size.h}
        </span>
      </div>
    </main>
  );
}
