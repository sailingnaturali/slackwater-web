export type Units = "imperial" | "metric";

export const toFeet = (metres: number) => metres * 3.28084;
export const toNauticalMiles = (km: number) => km / 1.852;

/** Strip a negative zero, which appears whenever a tide sits just below datum. */
const unsign = (n: number) => (Object.is(n, -0) || Math.abs(n) < 0.05 ? Math.abs(n) : n);

export function formatHeight(metres: number, units: Units): string {
  return units === "imperial"
    ? unsign(toFeet(metres)).toFixed(1)
    : unsign(metres).toFixed(2);
}

export function formatDistance(km: number, units: Units): string {
  const value = units === "imperial" ? toNauticalMiles(km) : km;
  return value < 10 ? value.toFixed(1) : Math.round(value).toString();
}

export const heightUnit = (units: Units) => (units === "imperial" ? "ft" : "m");
export const distanceUnit = (units: Units) => (units === "imperial" ? "nm" : "km");
