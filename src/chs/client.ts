// src/chs/client.ts
export const IWLS_BASE = "https://api-iwls.dfo-mpo.gc.ca/api/v1";

export interface IwlsSample { eventDate: string; value: number; qualifier?: string }
export interface IwlsStationMeta {
  id: string;
  officialName: string;
  latitude: number;
  longitude: number;
  timeSeries: { code: string }[];
  datums?: { code: string; offset: number }[];
}

const MAX_ATTEMPTS = 4;

async function getJson<T>(url: string, fetchFn: typeof fetch): Promise<T> {
  let delay = 1000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetchFn(url);
    if (res.ok) return (await res.json()) as T;
    // 429 and 5xx are transient; retry with backoff. 4xx (bar 429) is not.
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt === MAX_ATTEMPTS) {
      throw new Error(`IWLS ${res.status} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(delay, 60_000)));
    delay *= 2;
  }
  throw new Error("unreachable");
}

export function fetchSeries(
  stationId: string, seriesCode: string, from: Date, to: Date,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<IwlsSample[]> {
  const url = `${IWLS_BASE}/stations/${stationId}/data?time-series-code=${seriesCode}` +
    `&from=${from.toISOString()}&to=${to.toISOString()}`;
  return getJson<IwlsSample[]>(url, fetchFn);
}

export function fetchStationList(fetchFn: typeof fetch = globalThis.fetch): Promise<IwlsStationMeta[]> {
  return getJson<IwlsStationMeta[]>(`${IWLS_BASE}/stations`, fetchFn);
}

export interface IwlsStationMetadata {
  id: string;
  officialName: string;
  floodDirection?: number;
  ebbDirection?: number;
}

export function fetchStationMeta(
  stationId: string, fetchFn: typeof fetch = globalThis.fetch,
): Promise<IwlsStationMetadata> {
  return getJson<IwlsStationMetadata>(`${IWLS_BASE}/stations/${stationId}/metadata`, fetchFn);
}
