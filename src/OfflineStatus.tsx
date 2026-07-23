import type { ReactNode } from "react";
import type { OfflineSyncView } from "./useOfflineSync";

export function OfflineStatus({ view, onOpen }: { view: OfflineSyncView; onOpen: () => void }) {
  const pct = view.total > 0 ? Math.round((view.ready / view.total) * 100) : 0;

  let label: string;
  let body: ReactNode;
  if (view.complete) {
    label = "Offline ready";
    body = <span className="offline-icon" aria-hidden="true">✓</span>;
  } else if (view.paused) {
    label = "Paused";
    body = <span className="offline-meter-label">Paused</span>;
  } else if (!view.online) {
    label = "Waiting for signal";
    body = <span className="offline-meter-label">Waiting for signal</span>;
  } else {
    label = `Downloading ${pct}%`;
    body = (
      <span className="offline-meter" aria-hidden="true">
        <span className="offline-meter-fill" style={{ width: `${pct}%` }} />
        <span className="offline-meter-pct">{pct}%</span>
      </span>
    );
  }

  return (
    <button className="offline-status" onClick={onOpen} aria-label={`Offline downloads — ${label}`}>
      {body}
    </button>
  );
}
