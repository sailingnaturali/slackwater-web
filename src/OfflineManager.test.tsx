// src/OfflineManager.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineManager } from "./OfflineManager";
import type { OfflineSyncView } from "./useOfflineSync";
import type { ChsStation } from "./chsStations";
import type { StationJob } from "./offlineSync";

function gate(id: string, series: "tide" | "current"): ChsStation {
  return {
    kind: "chs", series, provider: "chs", id, slug: id, name: id.replace("chs-", ""),
    context: "", latitude: 48, longitude: -123, aliases: [], timezone: "America/Vancouver",
  };
}
const jobs: StationJob[] = [
  { station: gate("chs-malibu", "current"), status: "ready" },
  { station: gate("chs-victoria", "tide"), status: "failed" },
];
function view(over: Partial<OfflineSyncView> = {}): OfflineSyncView {
  return {
    jobs, total: 2, ready: 1, paused: false, online: true, complete: false,
    through: new Date("2026-07-30T00:00:00Z"),
    pauseAll() {}, resumeAll() {}, pause() {}, restart() {}, restartAll() {}, clearCache() {},
    ...over,
  };
}

describe("OfflineManager", () => {
  it("groups stations and shows a restart affordance for a failed one", () => {
    const html = renderToStaticMarkup(<OfflineManager open view={view()} onClose={() => {}} />);
    expect(html).toContain("Currents");
    expect(html).toContain("Tides");
    expect(html).toContain("malibu");
    expect(html).toContain("victoria");
    expect(html).toContain("Restart");
    expect(html).toContain("Clear cache");
  });

  it("offers Resume all when paused", () => {
    const html = renderToStaticMarkup(<OfflineManager open view={view({ paused: true })} onClose={() => {}} />);
    expect(html).toContain("Resume all");
  });
});
