import { useLocation } from "react-router-dom";

// Routes rendered in the v4 design system (styles/design-v4.css). The
// class is applied at the shell root by AppShell so shell chrome that
// sits outside the routed page (SessionProgress, VoiceBar) re-themes
// with it; components with v4-only markup check the same hook.
//
// TODO(design discussion): this per-route split is deliberate and
// temporary. It lets the conversation page ship the v4 look while Home
// (main) restyles the same shared components its own way. Shared chrome
// (SessionProgress, VoiceBar, Icon/KpIcon) should look and behave the
// same across the entire site; once the team agrees on one version,
// apply it globally and remove this route list and the hook.
export const DESIGN_V4_ROUTES = ["/session/conversation"];

export function useDesignV4() {
  const { pathname } = useLocation();
  return DESIGN_V4_ROUTES.includes(pathname);
}
