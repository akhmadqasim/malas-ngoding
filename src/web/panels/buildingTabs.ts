import type { BuildingEstimate } from "../../shared/types.ts";

/**
 * Props every building panel tab takes (Energi, Emisi, Surya, Cuaca): the estimate shown in the panel and
 * the point the user picked, as [lng, lat].
 */
export interface BuildingTabProps {
  building: BuildingEstimate;
  at: [number, number];
}
