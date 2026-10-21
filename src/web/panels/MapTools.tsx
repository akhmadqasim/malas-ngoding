import { Button, Popover, Separator, Toolbar, Tooltip } from "@heroui/react";
import type { Map as MapboxMap } from "mapbox-gl";
import { type ReactNode, useEffect, useState } from "react";
import { flyToProvince } from "../map/camera.ts";
import { useAppStore } from "../store.ts";

/** The map's bearing, updated as the camera turns (for the compass needle). */
function useMapBearing(map: MapboxMap | null): number {
  const [bearing, setBearing] = useState(() => map?.getBearing() ?? 0);
  useEffect(() => {
    if (!map) return;
    const update = () => setBearing(map.getBearing());
    update();
    map.on("rotate", update);
    return () => {
      map.off("rotate", update);
    };
  }, [map]);
  return bearing;
}

/** One tool: an icon button with its name as a tooltip (on hover and on keyboard focus). */
function Tool({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} onPress={onPress} className="map-tool">
        {children}
      </Button>
      <Tooltip.Content placement="left">{label}</Tooltip.Content>
    </Tooltip>
  );
}

const icon = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true } as const;

/**
 * Our own map tools, in place of Mapbox's controls: zoom in and out, back to north, back to the whole
 * province, and where the map comes from. A vertical toolbar (arrow keys move between tools); every tool has
 * a tooltip. The Mapbox wordmark and attribution stay on the map itself (MapView).
 */
export function MapTools() {
  const map = useAppStore((s) => s.map);
  const bearing = useMapBearing(map);

  const backToProvince = () => {
    const store = useAppStore.getState();
    // With a region open, closing it flies back (MapView); otherwise fly back from wherever the view is.
    if (store.selectedRegionId) store.selectRegion(null);
    else if (map) flyToProvince(map);
  };

  return (
    <Toolbar aria-label="Alat peta" orientation="vertical" className="map-tools">
      <Tool label="Perbesar" onPress={() => map?.zoomIn()}>
        <svg {...icon}>
          <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
        </svg>
      </Tool>
      <Tool label="Perkecil" onPress={() => map?.zoomOut()}>
        <svg {...icon}>
          <path d="M3.5 8h9" strokeLinecap="round" />
        </svg>
      </Tool>
      <Separator className="map-tools__rule" />
      <Tool label="Hadapkan ke utara" onPress={() => map?.resetNorth()}>
        {/* A compass needle that points to north on the map: the dark half is north. */}
        <svg {...icon} style={{ transform: `rotate(${-bearing}deg)` }}>
          <path d="M8 2 10.4 8H5.6Z" fill="currentColor" stroke="none" />
          <path d="M5.6 8h4.8L8 14Z" strokeLinejoin="round" strokeWidth={1.2} />
        </svg>
      </Tool>
      <Tool label="Kembali ke seluruh Kalimantan Timur" onPress={backToProvince}>
        <svg {...icon}>
          <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </Tool>
      <Separator className="map-tools__rule" />
      <Popover>
        <Tooltip>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Tentang peta ini" className="map-tool">
            <svg {...icon}>
              <circle cx="8" cy="8" r="6" />
              <path d="M8 7.25v4" strokeLinecap="round" />
              <circle cx="8" cy="5" r="0.9" fill="currentColor" stroke="none" />
            </svg>
          </Button>
          <Tooltip.Content placement="left">Tentang peta ini</Tooltip.Content>
        </Tooltip>
        <Popover.Content placement="left bottom" className="map-about">
          <Popover.Dialog aria-label="Tentang peta ini">
            <Popover.Heading className="map-about__title">Tentang peta ini</Popover.Heading>
            <p>
              Peta dasar ©{" "}
              <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">
                Mapbox
              </a>{" "}
              dan ©{" "}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                kontributor OpenStreetMap
              </a>
              .
            </p>
            <p>Data wilayah: BPS Kalimantan Timur, Kementerian ESDM dan PLN.</p>
            <p>Data pembangkit: Global Energy Monitor, WRI dan Kementerian ESDM; sebagian lokasinya perkiraan.</p>
            <p className="map-about__note">Angka per wilayah adalah perkiraan. Cara hitungnya ada di rincian setiap wilayah.</p>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </Toolbar>
  );
}
