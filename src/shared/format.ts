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
