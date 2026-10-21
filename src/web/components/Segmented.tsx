import { ToggleButton, ToggleButtonGroup, Tooltip } from "@heroui/react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING } from "../motion.ts";

export interface SegmentedOption<K extends string> {
  key: K;
  label: ReactNode;
  /** Tooltip text, for an option whose label needs a word of explanation. */
  title?: string;
}

interface Props<K extends string> {
  /** Id of the visible label that names the group. */
  labelledBy: string;
  options: readonly SegmentedOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Motion `layoutId` of the sliding marker; unique per control on the page. */
  indicatorId: string;
}

/**
 * One choice out of a few (HeroUI ToggleButtonGroup, single selection: a radiogroup of radios with arrow
 * keys). The chosen option is marked by an accent block that slides between options with the control
 * spring (00-direction section 6).
 */
export function Segmented<K extends string>({ labelledBy, options, value, onChange, indicatorId }: Props<K>) {
  return (
    <ToggleButtonGroup
      aria-labelledby={labelledBy}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [key] = [...keys];
        if (key !== undefined && key !== value) onChange(String(key) as K);
      }}
      size="sm"
      className="segmented"
    >
      {options.map((o) => {
        const button = (
          <ToggleButton key={o.key} id={o.key}>
            {({ isSelected }) => (
              <>
                {isSelected && <motion.span layoutId={indicatorId} className="segmented__indicator" transition={SPRING.control} aria-hidden />}
                <span className="segmented__label">{o.label}</span>
              </>
            )}
          </ToggleButton>
        );
        return o.title ? (
          <Tooltip key={o.key}>
            {button}
            <Tooltip.Content placement="top">{o.title}</Tooltip.Content>
          </Tooltip>
        ) : (
          button
        );
      })}
    </ToggleButtonGroup>
  );
}
