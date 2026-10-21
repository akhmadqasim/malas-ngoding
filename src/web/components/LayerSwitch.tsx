import { Switch } from "@heroui/react";
import type { ReactNode } from "react";

/** An on/off switch with its label (HeroUI Switch: a labelled `role="switch"`, Space toggles it). */
export function LayerSwitch({ label, on, onChange }: { label: ReactNode; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Switch isSelected={on} onChange={onChange} size="sm" className="layer-switch">
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  );
}
