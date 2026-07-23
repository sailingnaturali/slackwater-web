import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineStatus } from "./OfflineStatus";
import type { OfflineSyncView } from "./useOfflineSync";

function view(over: Partial<OfflineSyncView>): OfflineSyncView {
  return {
    jobs: [], total: 4, ready: 1, paused: false, online: true, complete: false,
    through: new Date("2026-07-30T00:00:00Z"),
    pauseAll() {}, resumeAll() {}, pause() {}, restart() {}, restartAll() {}, clearCache() {},
    ...over,
  };
}

describe("OfflineStatus", () => {
  it("shows a percentage meter while syncing", () => {
    const html = renderToStaticMarkup(<OfflineStatus view={view({ ready: 1, total: 4 })} onOpen={() => {}} />);
    expect(html).toContain("25%");
    expect(html).toContain("offline-meter");
  });

  it("shows the ready icon when complete", () => {
    const html = renderToStaticMarkup(
      <OfflineStatus view={view({ ready: 4, total: 4, complete: true })} onOpen={() => {}} />,
    );
    expect(html).toContain("✓");
    expect(html).toContain("Offline ready");
  });

  it("says waiting for signal when offline mid-sync", () => {
    const html = renderToStaticMarkup(
      <OfflineStatus view={view({ online: false, complete: false })} onOpen={() => {}} />,
    );
    expect(html).toContain("Waiting for signal");
  });
});
