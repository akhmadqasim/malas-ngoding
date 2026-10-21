/**
 * The quiet "perkiraan" mark that follows every estimated number (after its unit). Italic and faint,
 * so the number stays the loudest thing; the hover title says what it means.
 */
export function Estimate() {
  return (
    <em className="est" title="Angka ini hasil perkiraan, bukan data meteran">
      perkiraan
    </em>
  );
}
