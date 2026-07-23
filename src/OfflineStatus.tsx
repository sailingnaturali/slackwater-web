import type { ReactNode } from "react";
import type { OfflineSyncView } from "./useOfflineSync";

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The offline-downloads control on the Settings row. It answers three questions
 * at a glance: what it is (an offline/download icon + label), whether it's
 * working/errored/done (icon + tone), and how long the offline data is good for
 * (a "through <date>" when covered, an expiry warning when stale).
 *
 * While downloading it shows only the fixed-width bar with the download icon
 * pinned right — no words, no climbing percentage — so nothing jumps as it fills.
 */
export function OfflineStatus({ view, onOpen }: { view: OfflineSyncView; onOpen: () => void }) {
  const pct = view.total > 0 ? Math.round((view.ready / view.total) * 100) : 0;
  const coverage = view.syncedThrough ?? (view.complete ? view.through : null);

  const icon = (glyph: string) => (
    <span className="offline-status-icon" aria-hidden="true">
      {glyph}
    </span>
  );
  const text = (t: string) => (
    <span className="offline-status-text" aria-hidden="true">
      {t}
    </span>
  );
  const bar = (warn: boolean) => (
    <span className={warn ? "offline-meter warn" : "offline-meter"} aria-hidden="true">
      <span className="offline-meter-fill" style={{ width: `${pct}%` }} />
    </span>
  );

  let tone: "ok" | "warn" | "muted";
  let label: string; // aria description (the visible label may be shorter/absent)
  let body: ReactNode;

  if (view.paused) {
    tone = "muted";
    label = "Paused";
    body = (
      <>
        {icon("⏸")}
        {text("Paused")}
      </>
    );
  } else if (view.complete || (view.syncedThrough && !view.expired)) {
    // Fresh offline coverage — reassure even if a background top-up is running.
    tone = "ok";
    label = coverage ? `Offline · ${fmt(coverage)}` : "Offline ready";
    body = (
      <>
        {icon("✓")}
        {text(label)}
      </>
    );
  } else if (view.active && view.online) {
    // First sync in progress: just the bar + download icon on the right. No
    // text/percentage, so nothing shifts as it fills.
    tone = view.failed > 0 ? "warn" : "ok";
    label = `Downloading ${pct}%`;
    body = (
      <>
        {bar(view.failed > 0)}
        {icon("↓")}
      </>
    );
  } else if (view.expired) {
    tone = "warn";
    label = "Offline expired · reconnect";
    body = (
      <>
        {icon("⚠")}
        {text(label)}
      </>
    );
  } else if (view.failed > 0) {
    // Stalled with failures and no coverage — the red, needs-attention state.
    tone = "warn";
    label = `${view.failed} failed`;
    body = (
      <>
        {icon("⚠")}
        {text(label)}
      </>
    );
  } else if (!view.online) {
    tone = "warn";
    label = "Waiting for signal";
    body = (
      <>
        {icon("⚠")}
        {text(label)}
      </>
    );
  } else {
    tone = "muted";
    label = "Offline downloads";
    body = (
      <>
        {icon("↓")}
        {text("Offline downloads")}
      </>
    );
  }

  return (
    <button
      className={`offline-status ${tone}`}
      onClick={onOpen}
      aria-label={`Offline downloads — ${label}`}
    >
      {body}
    </button>
  );
}
