import { useLocation } from "react-router-dom";

// Routes rendered in the v4 design system (styles/design-v4.css). The
// class is applied at the shell root by AppShell so shell chrome that
// sits outside the routed page (SessionProgress, VoiceBar) re-themes
// with it; components with v4-only markup check the same hook.
export const DESIGN_V4_ROUTES = ["/session/conversation"];

export function useDesignV4() {
  const { pathname } = useLocation();
  return DESIGN_V4_ROUTES.includes(pathname);
}
