import { CircleInfo, Compass, House, Minus, Plus } from "@gravity-ui/icons";
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
        <Plus aria-hidden />
      </Tool>
      <Tool label="Perkecil" onPress={() => map?.zoomOut()}>
        <Minus aria-hidden />
      </Tool>
      <Separator className="map-tools__rule" />
      <Tool label="Hadapkan ke utara" onPress={() => map?.resetNorth()}>
        {/* Gravity's compass needle points north-east; turned back 45° it points to north on the map. */}
        <Compass aria-hidden style={{ transform: `rotate(${-bearing - 45}deg)` }} />
      </Tool>
      <Tool label="Kembali ke seluruh Kalimantan Timur" onPress={backToProvince}>
        <House aria-hidden />
      </Tool>
      <Separator className="map-tools__rule" />
      <Popover>
        <Tooltip>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Tentang peta ini" className="map-tool">
            <CircleInfo aria-hidden />
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
