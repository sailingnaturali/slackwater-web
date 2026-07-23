import type { OfflineSyncView } from "./useOfflineSync";

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The offline-downloads control on the Settings row. It answers three questions
 * at a glance: what it is (an offline/download icon + label), whether it's
 * working/errored/done (icon + tone), and how long the offline data is good for
 * (a "through <date>" when covered, an expiry warning when stale).
 */
export function OfflineStatus({ view, onOpen }: { view: OfflineSyncView; onOpen: () => void }) {
  const pct = view.total > 0 ? Math.round((view.ready / view.total) * 100) : 0;
  const coverage = view.syncedThrough ?? (view.complete ? view.through : null);

  let icon: string;
  let text: string;
  let tone: "ok" | "warn" | "muted";
  let meter = false;

  if (view.paused) {
    icon = "⏸";
    text = "Paused";
    tone = "muted";
  } else if (view.complete || (view.syncedThrough && !view.expired)) {
    // Fresh offline coverage — reassure even if a background top-up is running.
    icon = "✓";
    text = coverage ? `Offline · ${fmt(coverage)}` : "Offline ready";
    tone = "ok";
  } else if (view.active && view.online) {
    // First sync, no usable coverage yet: show progress.
    icon = "↓";
    text = `Downloading ${pct}%`;
    tone = view.failed > 0 ? "warn" : "ok";
    meter = true;
  } else if (view.expired) {
    icon = "⚠";
    text = "Offline expired · reconnect";
    tone = "warn";
  } else if (view.failed > 0) {
    // Stalled with failures and no coverage — the red, needs-attention state.
    icon = "⚠";
    text = `${view.failed} failed`;
    tone = "warn";
    meter = true;
  } else if (!view.online) {
    icon = "⚠";
    text = "Waiting for signal";
    tone = "warn";
  } else {
    icon = "↓";
    text = "Offline downloads";
    tone = "muted";
  }

  return (
    <button
      className={`offline-status ${tone}`}
      onClick={onOpen}
      aria-label={`Offline downloads — ${text}`}
    >
      <span className="offline-status-icon" aria-hidden="true">
        {icon}
      </span>
      {meter && (
        <span className={view.failed > 0 ? "offline-meter warn" : "offline-meter"} aria-hidden="true">
          <span className="offline-meter-fill" style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="offline-status-text" aria-hidden="true">
        {text}
      </span>
    </button>
  );
}
