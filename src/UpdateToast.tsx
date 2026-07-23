import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Offered, never forced: an auto-reload mid-passage would yank the chart out
 * from under someone reading it, so the new version waits for a tap.
 */
const CHECK_MS = 60 * 60 * 1000;

export function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // The browser only re-checks the worker on navigation, and an installed
      // PWA rarely navigates — so poll while online.
      setInterval(() => {
        if (navigator.onLine) registration.update();
      }, CHECK_MS);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="update-toast" role="status">
      <span>A new version of Slackwater is ready.</span>
      <button className="primary" onClick={() => updateServiceWorker(true)}>
        Update
      </button>
      <button className="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}
