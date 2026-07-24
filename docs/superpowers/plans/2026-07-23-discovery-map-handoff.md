# Discovery-map session handoff

Prompt for the session executing the discovery-map plan, written 2026-07-23 while
the NOAA-currents plan executes concurrently in another session. If the currents
work is already merged when you read this, the coordination section collapses:
branch from main, import `isNoaaCurrent` directly, no rebase dance.

---

Execute the discovery-map plan for slackwater-web.

Read these first, in order:

1. `docs/superpowers/plans/2026-07-23-discovery-map.md` — the plan you are executing
   (5 tasks, M1–M5). It is on the `noaa-currents` branch, not main.
2. `docs/superpowers/specs/2026-07-23-discovery-map-design.md` — the approved spec.
3. `../slackwater/docs/land-tiles-problem.md` — measured ground truth for the land
   layer (pipeline, sizes, composition gotchas).

Setup:

- Repo: `/Users/clarkbw/src/sailingnaturali/slackwater-web`
- Work in a git worktree on a new branch `discovery-map`, branched FROM
  `noaa-currents` (that branch carries the plan and will also receive the
  NOAA-currents feature work another session is executing right now).
- Use superpowers:subagent-driven-development to execute the plan task-by-task.

Coordination with the concurrent NOAA-currents session (important):

- The currents session is working on the `noaa-currents` branch in the main
  checkout. Do not commit to `noaa-currents` and do not touch these files:
  `scripts/build-currents.mjs`, `src/noaaCurrents*`, `src/currentsBundle.test.ts`,
  `src/place.ts`, `src/chs/*`, `src/StationList.tsx`, `data/noaa-currents.json`.
- Plan Task M2 imports `isNoaaCurrent` from `./noaaCurrents` — that module may not
  exist on your branch yet. Do NOT import it. Inline the check instead:

  ```ts
  const isCurrentKind = (s: Candidate) =>
    ("kind" in s && (s.kind === "chs" ? isChsCurrent(s) : s.kind === "noaa-current"));
  ```

  and leave a one-line comment to swap in the real `isNoaaCurrent` import when this
  branch is rebased onto the finished noaa-currents work. Everything else in M2
  stands as written.
- Do Task M4 (App.tsx wiring) LAST, and immediately before starting it, rebase
  your branch onto the latest `noaa-currents` (fetch first — it moves as the other
  session commits). If App.tsx conflicts: the currents session's changes govern;
  re-apply the map branch on top and re-run the full suite.
- If the rebase brings in `src/noaaCurrents.ts`, swap the M2 inline check for the
  real import at that point.

Execution notes:

- Toolchain for M1 is installed: tippecanoe, ogr2ogr, pmtiles at `/opt/homebrew/bin`.
  The land-polygons source download is ~700 MB — run it in a way that survives the
  subagent returning (nohup + a monitor, not a subagent-local background job).
- M2 Step 1 and M1 Step 3 need network; everything else is offline.
- The smoke test may need a headless-WebGL Chrome flag; the record-web-gif skill's
  notes cover the exact flag if you hit a blank canvas.
- House rules: this is the Mac Studio — commit and push completed work to the
  `discovery-map` branch without asking. Never push to main or to noaa-currents.
  No outbound text (issues, PRs, comments) without Bryan's explicit go.
- Run the final whole-branch review when all 5 tasks are done, then STOP and
  report: leave the branch unmerged. It merges only after noaa-currents does.
