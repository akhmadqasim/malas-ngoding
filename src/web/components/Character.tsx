export type CharacterRole = "warga" | "pemda" | "teknisi";
const NAMES: Record<CharacterRole, string> = { warga: "Pendamping warga", pemda: "Pendamping pemda", teknisi: "Teknisi energi" };
/** Shared, production-ready character cutouts. Decorative by default; accessible name only when meaningful. */
export function Character({ role, variant = "avatar", labelled = false }: { role: CharacterRole; variant?: "avatar" | "guide"; labelled?: boolean }) {
  return <span className={`character character--${variant}`} data-character={role}><img src={`/characters/${role}.png`} alt={labelled ? NAMES[role] : ""} width="512" height="768" loading="lazy" decoding="async" /></span>;
}
