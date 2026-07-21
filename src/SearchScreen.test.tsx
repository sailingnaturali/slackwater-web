import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Search } from "./SearchScreen";
import { resolvedStations } from "./tides";
import { POPULAR_SLUGS } from "./data/popular";

// react-dom/client's createRoot renders outside React's own act() batching
// unless told this is a test environment — without it, act() still runs
// synchronously but warns on every call.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = new Date("2026-07-20T19:00:00Z");
const fridayHarbor = resolvedStations.find((s) => s.slug === "friday-harbor")!;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: Partial<React.ComponentProps<typeof Search>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onSelect = props.onSelect ?? (() => {});
  const onCancel = props.onCancel ?? (() => {});
  act(() => {
    root!.render(
      <Search
        stations={resolvedStations}
        units="imperial"
        now={now}
        selectedId={fridayHarbor.id}
        onSelect={onSelect}
        onCancel={onCancel}
        {...props}
      />,
    );
  });
  return { onSelect, onCancel };
}

function type(value: string) {
  const input = container!.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
    container.remove();
  }
  root = null;
  container = null;
});

describe("Search screen", () => {
  it("shows POPULAR on an empty query", () => {
    mount();
    expect(container!.textContent).toContain("Popular");
    const cards = container!.querySelectorAll(".station-card");
    expect(cards.length).toBe(POPULAR_SLUGS.length);
  });

  it("narrows results as you type", () => {
    mount();
    type("friday");
    const cards = container!.querySelectorAll(".station-card-name");
    const names = Array.from(cards).map((c) => c.textContent);
    expect(names).toEqual(["Friday Harbor"]);
  });

  it("shows nothing left rather than everything for a nonsense query", () => {
    mount();
    type("zzzzqqq");
    expect(container!.querySelectorAll(".station-card").length).toBe(0);
    expect(container!.textContent).toContain("No stations match");
  });

  it("calls onCancel when Cancel is clicked", () => {
    let cancelled = false;
    mount({ onCancel: () => (cancelled = true) });
    const cancel = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    )!;
    act(() => cancel.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(cancelled).toBe(true);
  });

  it("calls onSelect with the chosen station when a result is picked", () => {
    let picked: string | null = null;
    mount({ onSelect: (s) => (picked = s.slug) });
    type("everett");
    const card = container!.querySelector(".station-card")!;
    act(() => card.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(picked).toBe("everett");
  });
});
