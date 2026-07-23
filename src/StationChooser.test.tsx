import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StationChooser } from "./StationChooser";
import { getPlaceStation } from "./savedStations";
import type { Place } from "./place";
import type { ResolvedStation } from "./tides";
import type { Candidate } from "./place";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const place: Place = { name: "Victoria", region: "BC", latitude: 48.4284, longitude: -123.3656 };

function station(fields: {
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
}): ResolvedStation {
  return {
    id: fields.slug,
    name: fields.name,
    latitude: fields.latitude,
    longitude: fields.longitude,
    timezone: "America/Los_Angeles",
    chartDatum: "MLLW",
    datumOffset: 0,
    source: "National Oceanic and Atmospheric Administration",
    sourceUrl: "https://example.com",
    constituents: [{ name: "M2", amplitude: 1, phase: 100 }],
    context: "Haro Strait",
    slug: fields.slug,
    aliases: [fields.slug],
  };
}

// Within 2km of `place`, so its quality is deterministically "good"
// regardless of the M2 gradient across the neighbourhood.
const kanaka = station({ name: "Kanaka Bay", slug: "kanaka-bay", latitude: 48.43, longitude: -123.36 });
const hanbury = station({ name: "Hanbury Point", slug: "hanbury-point", latitude: 48.6, longitude: -123.17 });
const fridayHarbor = station({ name: "Friday Harbor", slug: "friday-harbor", latitude: 48.53, longitude: -123.01 });

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: {
  current: ResolvedStation;
  alternatives: ResolvedStation[];
  onChoose?: (station: Candidate) => void;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onChoose = props.onChoose ?? (() => {});
  act(() => {
    root!.render(
      <StationChooser
        place={place}
        current={props.current}
        alternatives={props.alternatives}
        units="metric"
        onChoose={onChoose}
      />,
    );
  });
  return { onChoose };
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
    container.remove();
  }
  root = null;
  container = null;
});

describe("StationChooser", () => {
  it("renders the chooser when a place has several plausible stations", () => {
    mount({ current: kanaka, alternatives: [kanaka, hanbury, fridayHarbor] });
    expect(container!.querySelector(".chooser-toggle")).not.toBeNull();
  });

  it("renders nothing at all when a place has exactly one plausible station", () => {
    mount({ current: kanaka, alternatives: [kanaka] });
    expect(container!.innerHTML).toBe("");
  });

  it("shows the current match's distance and quality on the control itself", () => {
    mount({ current: kanaka, alternatives: [kanaka, hanbury, fridayHarbor] });
    const toggle = container!.querySelector(".chooser-toggle")!;
    expect(toggle.textContent).toContain("Kanaka Bay");
    expect(toggle.textContent).toContain("km");
    expect(toggle.textContent).toContain("good match");
  });

  it("opens to show every alternative with its own distance and quality", () => {
    mount({ current: kanaka, alternatives: [kanaka, hanbury, fridayHarbor] });
    act(() => {
      container!
        .querySelector(".chooser-toggle")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const options = container!.querySelectorAll(".chooser-option");
    expect(options.length).toBe(3);
    for (const option of Array.from(options)) {
      expect(option.textContent).toMatch(/km/);
      expect(option.textContent).toMatch(/good match|approximate|nearest station/);
    }
  });

  it("calls setPlaceStation with the place and slug when an alternative is picked", () => {
    mount({ current: kanaka, alternatives: [kanaka, hanbury, fridayHarbor] });
    act(() => {
      container!
        .querySelector(".chooser-toggle")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const target = Array.from(container!.querySelectorAll(".chooser-option")).find((el) =>
      el.textContent?.includes("Hanbury Point"),
    )!;
    act(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(getPlaceStation("Victoria")).toBe("hanbury-point");
  });

  it("passes the chosen station to onChoose", () => {
    let picked: Candidate | null = null;
    mount({
      current: kanaka,
      alternatives: [kanaka, hanbury, fridayHarbor],
      onChoose: (station) => (picked = station),
    });
    act(() => {
      container!
        .querySelector(".chooser-toggle")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const target = Array.from(container!.querySelectorAll(".chooser-option")).find((el) =>
      el.textContent?.includes("Friday Harbor"),
    )!;
    act(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(picked).not.toBeNull();
    expect(picked!.slug).toBe("friday-harbor");
  });
});
