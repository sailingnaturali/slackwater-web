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

// IWLS caps at 3 requests/second and 30/minute per IP (signalk-currents
// docs/chs-api.md). A 429 comes back WITHOUT CORS headers, so the browser
// rejects it as a CORS error and the app never even sees the status — the only
// defence is not tripping the limit. A shared token bucket gates every IWLS
// request: burst up to `capacity` for snappy on-demand loads, refill one token
// per `refillMs` so sustained bulk prefetch stays under the cap. Refill is
// timestamp-based, so idle time replenishes and an occasional on-demand load
// is never throttled.
export function createRateLimiter(capacity: number, refillMs: number): () => Promise<void> {
  let tokens = capacity;
  let last = Date.now();
  const queue: (() => void)[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  function refill() {
    const gained = Math.floor((Date.now() - last) / refillMs);
    if (gained > 0) {
      tokens = Math.min(capacity, tokens + gained);
      last += gained * refillMs;
    }
  }
  function drain() {
    refill();
    while (tokens > 0 && queue.length) {
      tokens--;
      queue.shift()!();
    }
    if (!queue.length && timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  return function acquire(): Promise<void> {
    refill();
    if (tokens > 0 && queue.length === 0) {
      tokens--;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      queue.push(resolve);
      if (!timer) timer = setInterval(drain, refillMs);
    });
  };
}

// 3 burst (≤3/s), one token every 2.5s (~24/min, safely under the 30/min cap).
const acquireIwls = createRateLimiter(3, 2500);
const rateLimitedFetch: typeof fetch = async (input, init) => {
  await acquireIwls();
  return globalThis.fetch(input, init);
};

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
  fetchFn: typeof fetch = rateLimitedFetch,
): Promise<IwlsSample[]> {
  const url = `${IWLS_BASE}/stations/${stationId}/data?time-series-code=${seriesCode}` +
    `&from=${from.toISOString()}&to=${to.toISOString()}`;
  return getJson<IwlsSample[]>(url, fetchFn);
}

export function fetchStationList(fetchFn: typeof fetch = rateLimitedFetch): Promise<IwlsStationMeta[]> {
  return getJson<IwlsStationMeta[]>(`${IWLS_BASE}/stations`, fetchFn);
}

export interface IwlsStationMetadata {
  id: string;
  officialName: string;
  floodDirection?: number;
  ebbDirection?: number;
}

export function fetchStationMeta(
  stationId: string, fetchFn: typeof fetch = rateLimitedFetch,
): Promise<IwlsStationMetadata> {
  return getJson<IwlsStationMetadata>(`${IWLS_BASE}/stations/${stationId}/metadata`, fetchFn);
}
