import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineStatus } from "./OfflineStatus";
import type { OfflineSyncView } from "./useOfflineSync";

function view(over: Partial<OfflineSyncView>): OfflineSyncView {
  return {
    jobs: [], total: 4, ready: 1, paused: false, online: true, complete: false, failed: 0,
    active: true, through: new Date("2026-07-30T00:00:00Z"), syncedThrough: null, expired: false,
    pauseAll() {}, resumeAll() {}, pause() {}, restart() {}, restartAll() {}, clearCache() {},
    ...over,
  };
}

describe("OfflineStatus", () => {
  it("shows the download progress on a first sync with no coverage yet", () => {
    const html = renderToStaticMarkup(
      <OfflineStatus view={view({ ready: 1, total: 4, active: true, syncedThrough: null })} onOpen={() => {}} />,
    );
    expect(html).toContain("Downloading 25%");
    expect(html).toContain("offline-meter");
  });

  it("names how long offline data is good for once covered", () => {
    // Local date (no trailing Z) so the "Jul 30" label is timezone-stable.
    const covered = new Date("2026-07-30T12:00:00");
    const html = renderToStaticMarkup(
      <OfflineStatus view={view({ complete: true, active: false, syncedThrough: covered })} onOpen={() => {}} />,
    );
    expect(html).toContain("Offline · Jul 30");
    expect(html).toContain("offline-status ok");
  });

  it("warns to reconnect when the cached data has expired", () => {
    const html = renderToStaticMarkup(
      <OfflineStatus
        view={view({
          online: false,
          active: false,
          complete: false,
          syncedThrough: new Date("2026-07-01T00:00:00Z"),
          expired: true,
        })}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("expired");
    expect(html).toContain("offline-status warn");
  });

  it("goes red and names the failures when a first sync stalls", () => {
    const html = renderToStaticMarkup(
      <OfflineStatus
        view={view({ ready: 3, total: 5, failed: 2, active: false, syncedThrough: null })}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("2 failed");
    expect(html).toContain("offline-status warn");
    expect(html).toContain("offline-meter warn");
  });

  it("says waiting for signal when offline with nothing cached", () => {
    const html = renderToStaticMarkup(
      <OfflineStatus
        view={view({ online: false, active: false, complete: false, syncedThrough: null })}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("Waiting for signal");
  });

  it("shows Paused when the user paused the sync", () => {
    const html = renderToStaticMarkup(<OfflineStatus view={view({ paused: true })} onOpen={() => {}} />);
    expect(html).toContain("Paused");
  });
});
