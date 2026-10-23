import type { Map as MapboxMap, GeoJSONSource, TargetFeature } from "mapbox-gl";
import { roofPlacement, type FootprintGeometry } from "./footprintLayout.ts";
import { setArchitectureRoofs } from "./architecture.ts";
export const PREVIEW_PV = "home-installation-preview";
/** Each module has its real 1.12 × 2.22 m footprint, with clearance inside a conservative roof square. */
export function installationSlots(geometry: FootprintGeometry) {
 const roof = roofPlacement(geometry, 24); if (!roof) return [];
 const cols = Math.floor(roof.width/1.3), rows = Math.floor(roof.width/2.4);
 const angle = roof.projected.angle, c=Math.cos(angle), s=Math.sin(angle);
 const origin=roof.projected.origin, at=roof.at;
 const sx=111195*Math.cos(origin[1]*Math.PI/180);
 const center=[(at[0]-origin[0])*sx,(at[1]-origin[1])*111195];
 return Array.from({length:cols*rows},(_,i)=>{
  const x=(i%cols-(cols-1)/2)*1.3, y=(Math.floor(i/cols)-(rows-1)/2)*2.4;
  return {at:roof.projected.toLngLat([center[0]!+x*c-y*s,center[1]!+x*s+y*c]),angle:roof.angle};
 });
}
export function clearInstallation(map:MapboxMap) {
 if(map.getLayer(PREVIEW_PV))map.removeLayer(PREVIEW_PV);
 if(map.getSource(PREVIEW_PV))map.removeSource(PREVIEW_PV);
 setArchitectureRoofs(map,"preview",[]);
}
/** An explicitly temporary model layer. No home, installation record, or government source is written. */
export function renderInstallation(map:MapboxMap, feature:TargetFeature, count:number, progress=1) {
 const slots=installationSlots(feature.geometry).slice(0,Math.max(0,Math.floor(count)));
 if(!slots.length){clearInstallation(map);return;}

 const height=Math.max(3,Number(feature.properties?.height)||3);
 const data={type:"FeatureCollection" as const,features:slots.map((slot,i)=>({type:"Feature" as const,geometry:{type:"Point" as const,coordinates:slot.at},properties:{rotation:[0,0,slot.angle],translation:[0,0,height+0.25+Math.max(0,1-Math.min(1,Math.max(0,progress*1.4-i/Math.max(1,slots.length)*0.4)))*5]}}))};
 const source=map.getSource(PREVIEW_PV) as GeoJSONSource|undefined;
 if(source){source.setData(data);return;}
 if(feature.id!=null)setArchitectureRoofs(map,"preview",[{id:feature.id,roof:"flat"}]);
 if(!map.hasModel("preview-panel"))map.addModel("preview-panel","/models/preview-panel.glb");
 map.addSource(PREVIEW_PV,{type:"geojson",data});
 map.addLayer({id:PREVIEW_PV,type:"model",source:PREVIEW_PV,slot:"middle",minzoom:16,layout:{"model-id":"preview-panel","model-allow-density-reduction":false},paint:{"model-type":"common-3d","model-elevation-reference":"ground","model-translation":["get","translation"],"model-rotation":["get","rotation"],"model-cast-shadows":true}});
}
