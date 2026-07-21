import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// public/404.html (GitHub Pages has no server-side rewrites) bounces a
// reloaded deep link here as ?redirect=<original path>. Restore it before
// App's first render reads window.location, so a reloaded /tide/... URL
// resolves exactly like a fresh load of it.
const redirect = new URLSearchParams(location.search).get("redirect");
if (redirect) {
  history.replaceState(null, "", redirect);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
