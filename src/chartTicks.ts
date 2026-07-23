/**
 * Bi-hourly x-axis ticks for a day chart.
 *
 * Steps whole hours (UTC whole hours == local whole hours in every Salish Sea
 * zone) and keeps the even *local* hours, so a DST day shows the hours that
 * actually occur instead of drifting off the local clock.
 */
export function hourTicks(
  t0: number,
  t1: number,
  timezone: string,
): { t: number; label: string }[] {
  const HOUR = 3_600_000;
  const ticks: { t: number; label: string }[] = [];
  for (let t = Math.ceil(t0 / HOUR) * HOUR; t <= t1; t += HOUR) {
    const label = new Date(t)
      .toLocaleTimeString("en-CA", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: timezone,
      })
      .slice(0, 2);
    if (Number(label) % 2 === 0) ticks.push({ t, label });
  }
  return ticks;
}
