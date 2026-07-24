import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { UpdateToast } from "./UpdateToast";
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
    <UpdateToast />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  // Warm the land tiles into the runtime Range cache (see vite.config.ts) so
  // the /map view has coastline offline even if it was never opened online
  // first. A non-ranged fetch caches the full 200 body that RangeRequestsPlugin
  // later slices into the 206 partials pmtiles asks for. It only lands in the
  // cache once the SW *controls* this page — on a first-ever load that isn't
  // until clientsClaim fires `controllerchange`, so warm on that too, not just
  // `ready` (which resolves before control on the first load).
  const warm = () => {
    fetch("/land.pmtiles").catch(() => {});
  };
  navigator.serviceWorker.ready.then(() => {
    if (navigator.serviceWorker.controller) warm();
    else navigator.serviceWorker.addEventListener("controllerchange", warm, { once: true });
  });
}
