/**
 * A station's kind, drawn — double wave for a current station, a dome over a
 * datum line for a tide station. The glyph's COLOUR is its live state and
 * never its kind: that separation is the whole point (see styles.css, semantic
 * layer). A green double wave is a current station at slack, which is the most
 * useful thing to spot while scrolling a mixed list.
 */
export type Tone = "rising" | "falling" | "flood" | "ebb" | "slack" | "unknown";

export function StationGlyph({ kind, tone }: { kind: "tide" | "current"; tone: Tone }) {
  return (
    <svg
      className={`station-glyph ${tone}`}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={kind === "current" ? "Current station" : "Tide station"}
    >
      {kind === "current" ? (
        <>
          <path d="M2 9c3-5 5-5 8 0s5 5 8 0 4-3 4-3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M2 16c3-5 5-5 8 0s5 5 8 0 4-3 4-3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".5" />
        </>
      ) : (
        <>
          <path d="M3 15c4-9 14-9 18 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M3 19h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".45" />
        </>
      )}
    </svg>
  );
}
