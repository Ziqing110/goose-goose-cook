import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { DesktopOnly } from "./components/DesktopOnly.jsx";
import { AppStateProvider } from "./state/AppStateContext.jsx";
import "./styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* BASE_URL is "/" in dev and "/goose-goose-cook/" in the Pages build
        (see vite.config.js), so routes are declared without the prefix in
        either case. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/* Outside the provider, not just outside App: AppStateProvider
          fetches kitchens and sessions on mount, and a phone that is
          only going to be turned away should not create a session or
          bill an API call first. */}
      <DesktopOnly>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </DesktopOnly>
    </BrowserRouter>
  </React.StrictMode>
);
