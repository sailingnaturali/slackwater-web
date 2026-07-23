import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EventList } from "./EventList";
import { stations, type Station, type TideState } from "./tides";
import type { ChsStation } from "./chsStations";
import type { CurrentState } from "./chs/current";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const station = stations.find((s) => /friday harbor/i.test(s.name)) as Station;
const today = new Date("2026-07-20T19:00:00Z");

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
    container.remove();
  }
  root = null;
  container = null;
});

function render(
  now: Date,
  spies: { onPageDay?: (d: number) => void; onToday?: () => void; onScrub?: (t: Date) => void },
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <EventList
        station={station}
        now={now}
        today={today}
        units="imperial"
        onPageDay={spies.onPageDay ?? (() => {})}
        onToday={spies.onToday ?? (() => {})}
        onScrub={spies.onScrub ?? (() => {})}
      />,
    );
  });
  return container;
}

function click(label: string) {
  const btn = container!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("EventList day paging drives the shared instant", () => {
  it("labels the day from `now` vs `today`, not internal offset", () => {
    render(today, {});
    expect(container!.textContent).toContain("Today");

    render(new Date(today.getTime() + 86_400_000), {});
    expect(container!.textContent).toContain("Tomorrow");
  });

  it("pages by asking the parent to move `now`", () => {
    const deltas: number[] = [];
    render(today, { onPageDay: (d) => deltas.push(d) });
    click("Next day");
    click("Previous day");
    expect(deltas).toEqual([1, -1]);
  });

  it("resets to live via onToday", () => {
    let reset = 0;
    render(new Date(today.getTime() + 86_400_000), { onToday: () => reset++ });
    click("Today");
    expect(reset).toBe(1);
  });

  it("clicking a row moves the shared instant onto that event's time", () => {
    const scrubbed: Date[] = [];
    render(today, { onScrub: (t) => scrubbed.push(t) });
    const row = container!.querySelector<HTMLButtonElement>(".event-row")!;
    const stamp = row.querySelector("time")!.getAttribute("datetime")!;
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(scrubbed).toHaveLength(1);
    expect(scrubbed[0].toISOString()).toBe(stamp);
  });
});

describe("EventList merges a gate's companion tide turns", () => {
  // A derived gate (Malibu Rapids) and its Point Atkinson tide, on 2026-07-20
  // local (Vancouver). currentDayEventsFromState and dayEventsFromState both
  // carry sun rows, so the merge must not double sunrise/sunset.
  const gate: ChsStation = {
    kind: "chs",
    series: "current",
    provider: "chs",
    id: "chs-malibu",
    slug: "chs-malibu",
    name: "Malibu Rapids",
    context: "Princess Louisa Inlet",
    latitude: 50.2,
    longitude: -123.8,
    aliases: [],
    timezone: "America/Vancouver",
  };
  const slack1 = new Date("2026-07-20T15:00:00Z");
  const slack2 = new Date("2026-07-20T22:00:00Z");
  const currentState = {
    signed: 2.1,
    speed: 2.1,
    phase: "flood",
    setDegrees: 45,
    floodDirection: 45,
    ebbDirection: 225,
    nextSlack: { time: slack2, kind: "slack" },
    following: null,
    derived: true,
    events: [
      { time: slack1, kind: "slack" },
      { time: slack2, kind: "slack" },
    ],
    timeline: [],
  } as unknown as CurrentState;
  const tideState: TideState = {
    level: 3,
    rising: true,
    next: { time: new Date("2026-07-20T20:42:00Z"), level: 3.9, high: true },
    extremes: [
      { time: new Date("2026-07-20T08:04:00Z"), level: 1.4, high: false },
      { time: new Date("2026-07-20T20:42:00Z"), level: 3.9, high: true },
    ],
    timeline: [],
  };

  it("lists high/low turns alongside slacks, with sunrise/sunset shown once", () => {
    const now = new Date("2026-07-20T19:00:00Z");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <EventList
          station={gate}
          now={now}
          today={now}
          units="imperial"
          state={tideState}
          currentState={currentState}
          onPageDay={() => {}}
          onToday={() => {}}
          onScrub={() => {}}
        />,
      );
    });
    const text = container!.textContent ?? "";
    expect(text).toContain("High"); // tide turn merged in
    expect(text).toContain("Low");
    expect(text).toContain("Slack"); // gate's own current events still there
    // The tide turns must not drag a second sunrise/sunset row in.
    expect((text.match(/Rise/g) ?? []).length).toBe(1);
    expect((text.match(/Set/g) ?? []).length).toBe(1);
  });
});
