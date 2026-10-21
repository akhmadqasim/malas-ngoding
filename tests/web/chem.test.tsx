import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { chem } from "../../src/web/components/Chem.tsx";

const html = (text: string) => renderToStaticMarkup(<>{chem(text)}</>);

describe("chem sets CO2 with a real subscript", () => {
  test("every CO2 gets a subscript 2", () => {
    expect(html("Emisi CO2")).toBe('Emisi CO<span class="sub">2</span>');
    expect(html("ton CO2 per tahun, CO2/kWh")).toBe('ton CO<span class="sub">2</span> per tahun, CO<span class="sub">2</span>/kWh');
  });
  test("text without CO2 is unchanged", () => {
    expect(html("Listrik terpakai")).toBe("Listrik terpakai");
  });
});
