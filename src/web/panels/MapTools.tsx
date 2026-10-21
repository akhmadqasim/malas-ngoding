import { CircleInfo, Compass, House, Minus, Plus } from "@gravity-ui/icons";
import { Button, Popover, Separator, Toolbar, Tooltip } from "@heroui/react";
import type { Map as MapboxMap } from "mapbox-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { flyToProvince } from "../map/camera.ts";
import { useAppStore } from "../store.ts";

/**
 * Turns the compass needle with the map. Written straight to the element on every `rotate` frame: through
 * React state the whole toolbar, tooltips and popover would re-render 60 times a second during the sway.
 */
function useCompassNeedle(map: MapboxMap | null) {
  const needle = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!map) return;
    // Gravity's compass needle points north-east; turned back 45 degrees it points to north on the map.
    const update = () => {
      if (needle.current) needle.current.style.transform = `rotate(${-map.getBearing() - 45}deg)`;
    };
    update();
    map.on("rotate", update);
    return () => {
      map.off("rotate", update);
    };
  }, [map]);
  return needle;
}

/** Phones lay the tools out in a row (styles.css), so the arrow keys follow: Left and Right there. */
function useToolbarOrientation(): "horizontal" | "vertical" {
  const query = "(max-width: 720px)";
  const [row, setRow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setRow(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return row ? "horizontal" : "vertical";
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
  const needle = useCompassNeedle(map);
  const orientation = useToolbarOrientation();

  const backToProvince = () => {
    const store = useAppStore.getState();
    // With a region open, closing it flies back (MapView); otherwise fly back from wherever the view is.
    if (store.selectedRegionId) store.selectRegion(null);
    else if (map) flyToProvince(map);
  };

  return (
    <Toolbar aria-label="Alat peta" orientation={orientation} className="map-tools">
      <Tool label="Perbesar" onPress={() => map?.zoomIn()}>
        <Plus aria-hidden />
      </Tool>
      <Tool label="Perkecil" onPress={() => map?.zoomOut()}>
        <Minus aria-hidden />
      </Tool>
      <Separator className="map-tools__rule" />
      <Tool label="Hadapkan ke utara" onPress={() => map?.resetNorth()}>
        <Compass aria-hidden ref={needle} />
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
            <p className="map-about__note">Angka per wilayah adalah perkiraan. Cara menghitungnya dijelaskan di bawah.</p>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </Toolbar>
  );
}
