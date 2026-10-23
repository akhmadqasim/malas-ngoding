/** Meteorological bearing names where the wind comes FROM, clockwise from north. */
export function windPose(fromDeg: number, rotorAngle = 0) {
  const bearing = ((fromDeg % 360) + 360) % 360;
  const radians = bearing * Math.PI / 180;
  return { towerRotation: [0, 0, bearing] as [number, number, number], rotorRotation: [0, rotorAngle, bearing] as [number, number, number],
    hub: [9 * Math.sin(radians), 9 * Math.cos(radians), 102] as [number, number, number], toDeg: (bearing + 180) % 360 };
}

export function compassName(degrees: number): string {
  const names = ["Utara", "Timur laut", "Timur", "Tenggara", "Selatan", "Barat daya", "Barat", "Barat laut"];
  return names[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
}
export interface WindReading {
  speedMs: number;
  fromDeg: number;
  heightM: 10;
  time: string;
}
export interface WindResponse {
  current: { wind: WindReading };
  stale: boolean;
  fetchedAt: string;
  source: "Open-Meteo";
}
