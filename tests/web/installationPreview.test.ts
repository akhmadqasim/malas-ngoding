import {expect,test} from "bun:test";
import {installationSlots} from "../../src/web/map/installationPreview.ts";
import {projectedFootprint,pointInRings} from "../../src/web/map/footprintLayout.ts";
test("preview module corners stay inside the roof with physical module spacing",()=>{
 const geometry={type:"Polygon",coordinates:[[[117,0],[117.00015,0],[117.00015,0.00012],[117,0.00012],[117,0]]]};
 const p=projectedFootprint(geometry)!, slots=installationSlots(geometry);
 expect(slots.length).toBeGreaterThan(1);
 for(const slot of slots){const x=(slot.at[0]-p.origin[0])*111195,y=(slot.at[1]-p.origin[1])*111195;
 for(const dx of [-0.56,0.56])for(const dy of [-1.11,1.11]){const c=Math.cos(p.angle),s=Math.sin(p.angle);expect(pointInRings(p.rings,[x+dx*c-dy*s,y+dx*s+dy*c])).toBe(true);}}
});
test("no modules are fabricated for missing or narrow roofs",()=>{
 expect(installationSlots({type:"Point",coordinates:[117,0]})).toEqual([]);
 expect(installationSlots({type:"Polygon",coordinates:[[[117,0],[117.000005,0],[117.000005,0.0001],[117,0.0001],[117,0]]]})).toEqual([]);
});
