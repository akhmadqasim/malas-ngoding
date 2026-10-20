const REGION_IDS = [
  "balikpapan",
  "samarinda",
  "bontang",
  "berau",
  "paser",
  "kutai-kartanegara",
  "kutai-barat",
  "kutai-timur",
  "penajam-paser-utara",
  "mahakam-ulu",
] as const;

const ALIASES: Record<string, string> = {
  kukar: "kutai-kartanegara",
  kubar: "kutai-barat",
  kutim: "kutai-timur",
  ppu: "penajam-paser-utara",
  mahulu: "mahakam-ulu",
  bpp: "balikpapan",
  smd: "samarinda",
};

const PREFIX_WORDS = new Set(["kabupaten", "kab", "kota"]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w !== "" && !PREFIX_WORDS.has(w))
    .join("-");
}

export function resolveRegion(text: string): string | null {
  const key = normalise(text);
  if (key === "") return null;
  if (Object.hasOwn(ALIASES, key)) return ALIASES[key] ?? null;
  return (REGION_IDS as readonly string[]).includes(key) ? key : null;
}
