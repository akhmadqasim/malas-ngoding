import type { BuildingEstimate, BuildingType } from "../../shared/types.ts";

/**
 * Props every building panel tab takes (Energi, Emisi, Surya, Cuaca): the estimate shown in the panel and
 * the point the user picked, as [lng, lat].
 */
export interface BuildingTabProps {
  building: BuildingEstimate;
  at: [number, number];
}

/** Building types in the order the type picker lists them, with their Indonesian names. */
export const BUILDING_TYPE_LABELS: Record<BuildingType, string> = {
  rumah: "Rumah",
  ruko: "Ruko",
  kantor: "Kantor",
  pemerintahan: "Kantor pemerintahan",
  sekolah: "Sekolah",
  kampus: "Kampus",
  rumah_sakit: "Rumah sakit",
  hotel: "Hotel",
  mal: "Mal",
  ibadah: "Tempat ibadah",
  gudang: "Gudang",
  industri: "Industri",
};

export const BUILDING_TYPES = Object.keys(BUILDING_TYPE_LABELS) as BuildingType[];
