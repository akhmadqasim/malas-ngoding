import { Sun, Clouds, CloudRain, Moon, MapPin } from "../icons.ts";
export function WeatherIcon({kind}:{kind:string}) {
 const Icon = kind === "auto" ? MapPin : kind === "night" || kind === "malam" ? Moon : kind.includes("rain") || kind === "hujan" ? CloudRain : kind === "cloudy" || kind === "berawan" ? Clouds : Sun;
 return <Icon aria-hidden />;
}
