import {launchBrowser} from './chromium.ts';
const b=await launchBrowser(),errors:string[]=[];
try {
 const c=await b.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();let writes=0;p.on('request',r=>{if(r.url().includes('/api/me/home')&&r.method()!=='GET')writes++;});p.on('pageerror',e=>errors.push(e.message));
 await c.request.post('http://localhost:3000/api/auth/demo',{data:{role:'warga'},headers:{origin:'http://localhost:3000'}});
 await p.goto('http://localhost:3000/?cahaya=day');await p.getByRole('region',{name:'Dashboard rumah pribadi'}).waitFor();
 await p.getByRole('button',{name:'Manfaat untuk saya',exact:true}).click();await p.getByRole('button',{name:'Lihat pilihan panel di atap'}).click();
 await p.getByRole('region',{name:'Simulasi pemasangan panel surya'}).waitFor();
 await p.waitForFunction(()=>{const m=(window as any).__malasMap;return m.getSource('home-installation-preview')?._data.features.length>0;});
 const slider=p.getByRole('slider',{name:'Jumlah panel pratinjau'});const max=Number(await slider.getAttribute('max'));const target=Math.min(2,max);
 const response=p.waitForResponse(r=>r.url().includes('/api/solar/simulate')&&r.request().postDataJSON()?.panelCount===target);
 if(target>1)await p.getByRole('button',{name:'Tambah panel',exact:true}).click();else await p.getByRole('button',{name:'Putar pemasangan'}).click();
 if(target>1){const result=await (await response).json();if(result.panels!==target)throw new Error('Model calculation uses wrong panel count');}
 await p.waitForFunction(n=>(window as any).__malasMap.getSource('home-installation-preview')._data.features.length===n,target);await p.waitForTimeout(1600);
 await p.screenshot({path:'output/installation-desktop.png'});
 await p.getByRole('button',{name:'Sebelum',exact:true}).click();await p.waitForFunction(()=>!(window as any).__malasMap.getLayer('home-installation-preview'));
 await p.getByRole('button',{name:'Sesudah',exact:true}).click();await p.waitForFunction(()=>Boolean((window as any).__malasMap.getLayer('home-installation-preview')));
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(1300);
 if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Installation preview overflows mobile');
 await p.screenshot({path:'output/installation-mobile.png'});
 await p.emulateMedia({reducedMotion:'reduce'});await p.getByRole('button',{name:'Putar pemasangan'}).click();
 await p.getByRole('button',{name:'Tutup simulasi pemasangan'}).click();await p.waitForFunction(()=>!(window as any).__malasMap.getSource('home-installation-preview'));
 if(writes||errors.length)throw new Error(JSON.stringify({writes,errors}));
 console.log(JSON.stringify({roofPreview:true,panels:target,calculationMatches:true,beforeAfter:true,mobile:true,reducedMotion:true,cleanup:true,writesToHome:writes,errors}));
 await c.close();
}finally{await b.close();}
