import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EventList } from "./EventList";
import { stations, type Station } from "./tides";

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
