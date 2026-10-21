export interface Climatology {
  /** Peak sun hours (kWh/m2/day) for January to December. */
  pshByMonth: number[];
  pshYear: number;
}
export type NasaLookup = (lat: number, lng: number) => Promise<Climatology>;

const TIMEOUT_MS = 6000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/**
 * Round to 0.1 degree (about 11 km): our cache key. This is not NASA POWER's own grid, which is coarser,
 * so neighbouring keys often come back with the same values.
 */
export function roundClimatologyCoord(v: number): number {
  return Math.round(v * 10) / 10;
}

export function climatologyKey(lat: number, lng: number): string {
  return `${roundClimatologyCoord(lat).toFixed(1)},${roundClimatologyCoord(lng).toFixed(1)}`;
}

/** Valid irradiance: finite and positive. NASA marks missing data as -999. */
const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 12;

/**
 * Monthly and annual all-sky surface shortwave irradiance (ALLSKY_SFC_SW_DWN, kWh/m2/day = peak sun hours)
 * from the NASA POWER climatology endpoint. Throws on network errors, timeouts, non-2xx answers and
 * incomplete data. Error messages never contain the request URL.
 */
export function createNasaLookup(opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): NasaLookup {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  return async (lat, lng) => {
    const url =
      "https://power.larc.nasa.gov/api/temporal/climatology/point" +
      `?parameters=ALLSKY_SFC_SW_DWN&community=RE&format=JSON` +
      `&longitude=${roundClimatologyCoord(lng)}&latitude=${roundClimatologyCoord(lat)}`;

    let res: Response;
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new Error(timedOut ? "NASA POWER: request timed out" : "NASA POWER: request failed");
    }
    if (!res.ok) throw new Error(`NASA POWER: HTTP ${res.status}`);

    let body: { properties?: { parameter?: { ALLSKY_SFC_SW_DWN?: Record<string, unknown> } } };
    try {
      body = await res.json();
    } catch {
      throw new Error("NASA POWER: response is not JSON");
    }
    const data = body.properties?.parameter?.ALLSKY_SFC_SW_DWN;
    if (!data) throw new Error("NASA POWER: response has no ALLSKY_SFC_SW_DWN");

    const pshByMonth = MONTHS.map((m) => data[m]);
    if (!pshByMonth.every(valid)) throw new Error("NASA POWER: monthly data incomplete");
    const pshYear = valid(data.ANN) ? data.ANN : pshByMonth.reduce((a, b) => a + b, 0) / 12;
    return { pshByMonth, pshYear };
  };
}
