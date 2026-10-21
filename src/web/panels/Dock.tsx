import { Button, Disclosure } from "@heroui/react";
import type { RegionSummary } from "../../shared/types.ts";
import type { PlantCollection } from "../api.ts";
import { useSessionFlag } from "../components/useSessionFlag.ts";
import { Legend } from "./Legend.tsx";
import { MapControls } from "./MapControls.tsx";

/** The session key of the dock's open or closed state. */
export const DOCK_OPEN_KEY = "malas:dock-open";

/**
 * The bottom dock. Always in view: the column metric switch and the legend meter, what a presenter needs at
 * a glance. Behind one disclosure ("Lapisan dan tampilan"): the layer switches with the plant fuel key, the
 * light and the rain. It opens to the right of the legend, so the dock never grows taller than the legend
 * itself, and it remembers its state for the session.
 */
export function Dock({ plants, regions }: { plants: PlantCollection; regions: RegionSummary[] }) {
  const [open, setOpen] = useSessionFlag(DOCK_OPEN_KEY, false);
  return (
    <Disclosure className="dock" isExpanded={open} onExpandedChange={setOpen}>
      <Legend
        regions={regions}
        more={
          <Disclosure.Heading className="dock__heading">
            <Button slot="trigger" variant="ghost" size="sm" className="dock__trigger">
              Lapisan dan tampilan
              <Disclosure.Indicator className="dock__indicator" />
            </Button>
          </Disclosure.Heading>
        }
      />
      <Disclosure.Content className="dock__more">
        <MapControls plants={plants} />
      </Disclosure.Content>
    </Disclosure>
  );
}
