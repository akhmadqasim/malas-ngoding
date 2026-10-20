const LOCALE = "id-ID";

function safe(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export function fmtNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safe(n));
}

export function fmtKwh(n: number): string {
  return `${fmtNumber(n)} kWh`;
}

export function fmtKg(n: number): string {
  const v = safe(n);
  // Round first so 999.6 kg shows as "1,0 ton", not "1.000 kg".
  if (Math.abs(Math.round(v)) >= 1000) return `${fmtNumber(v / 1000, 1)} ton`;
  return `${fmtNumber(v)} kg`;
}

export function fmtRupiah(n: number): string {
  const v = safe(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9 || Math.round((abs / 1e6) * 10) / 10 >= 1000) {
    return `${sign}Rp ${fmtNumber(abs / 1e9, 1)} M`;
  }
  if (abs >= 1e6) return `${sign}Rp ${fmtNumber(abs / 1e6, 1)} jt`;
  return `${sign}Rp ${fmtNumber(abs)}`;
}

const COMPACT_UNITS = [
  { size: 1e9, word: "miliar", digits: 2 },
  { size: 1e6, word: "juta", digits: 1 },
  { size: 1e3, word: "ribu", digits: 1 },
] as const;

/** Large numbers in words a layperson reads at a glance: `1,38 miliar`, `346,4 juta`, `865,3 ribu`. */
export function fmtCompact(n: number): string {
  const v = safe(n);
  const abs = Math.abs(v);
  const roundAt = (size: number, digits: number) => Math.round((abs / size) * 10 ** digits) / 10 ** digits;
  for (const [i, unit] of COMPACT_UNITS.entries()) {
    // Use the bigger unit when the smaller one would round up to 1.000 (999,96 juta prints as 1,00 miliar).
    const smaller = COMPACT_UNITS[i + 1] ?? { size: 1, digits: 0 };
    if (abs >= unit.size || roundAt(smaller.size, smaller.digits) >= 1000) {
      return `${v < 0 ? "-" : ""}${fmtNumber(abs / unit.size, unit.digits)} ${unit.word}`;
    }
  }
  return fmtNumber(v);
}
