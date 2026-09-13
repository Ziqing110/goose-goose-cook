import { Outlet } from "react-router-dom";
import SessionProgress from "../components/SessionProgress.jsx";

// Layout for every /session/* route: renders the in-session progress
// chrome once per session rather than once per page.
export default function SessionLayout() {
  return (
    <div className="session-shell">
      <SessionProgress />
      <Outlet />
    </div>
  );
}
