import {launchBrowser} from './chromium.ts';
const browser=await launchBrowser();
const origin='http://localhost:3000';
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
let writes=0;page.on('request',r=>{if(/\/api\/(?:me\/home|me\/solar-applications|pemda\/solar-applications)/.test(r.url())&&!['GET','HEAD'].includes(r.method()))writes++;});
const sessions:Partial<Record<'warga'|'pemda',Awaited<ReturnType<typeof context.cookies>>>>={};
async function login(role:'warga'|'pemda'){
 if(sessions[role]){await context.clearCookies();await context.addCookies(sessions[role]!);}else{
 const result=await context.request.post(`${origin}/api/auth/demo`,{headers:{origin},data:{role}});if(!result.ok())throw new Error(`Demo login ${result.status()}`);sessions[role]=await context.cookies();}
 await page.goto(`${origin}/?cahaya=day`);
 if(role==='warga')await page.getByRole('button',{name:'Pasang panel',exact:true}).click();
 else {await page.locator('.dashboard-nav').getByRole('button',{name:/^Laporan PLTS/}).click();await page.getByRole('button',{name:/Pengajuan pemasangan baru/}).click();await page.getByRole('button',{name:/PLTS demo/}).first().click();}
}
async function click(name:string){await page.getByRole('button',{name,exact:true}).click();}
try{
 await login('warga');await page.getByLabel('Saya ingin mencoba pengajuan survei untuk rumah ini.',{exact:true}).check();await click('Ajukan survei demo');
 await page.locator('.prototype-timeline [aria-current="step"]').filter({hasText:'Pengajuan diterima'}).waitFor({state:'attached'});
 await page.reload();await click('Pasang panel');await page.locator('.prototype-timeline [aria-current="step"]').filter({hasText:'Pengajuan diterima'}).waitFor({state:'attached'});
 await login('pemda');await click('Jadwalkan survei demo');await page.getByLabel('Jadwal demo (WITA)',{exact:true}).fill('2027-01-10T09:00');await click('Simpan jadwal demo');await click('Terbitkan hasil survei demo');
 await login('warga');await click('Setujui rancangan demo');
 await login('pemda');await click('Jadwalkan pemasangan demo');await page.getByLabel('Jadwal demo (WITA)',{exact:true}).fill('2027-01-12T09:00');await click('Simpan jadwal demo');await click('Mulai pemasangan demo');await click('Selesaikan dan uji sistem demo');
 await page.screenshot({path:'output/prototype-installation-admin.png'});
 await login('warga');await page.waitForFunction(()=>((window as any).__malasMap?.getSource('home-installation-preview')?._data?.features?.length??0)>0);await click('Buka pemantauan simulasi');await page.getByText('Kapasitas demo ·',{exact:false}).waitFor();await page.locator('.citizen-content').evaluate(e=>e.scrollTop=0);await page.waitForTimeout(1200);await page.screenshot({path:'output/prototype-installation-citizen.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('.citizen-content').evaluate(e=>e.scrollTop=0);await page.waitForTimeout(1200);await page.waitForTimeout(800);await page.screenshot({path:'output/prototype-installation-mobile.png'});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow');
 if(writes)throw new Error(`Unexpected database mutations: ${writes}`);if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({fullLifecycle:true,refresh:true,roleHandoff:true,mobile:true,databaseWrites:writes,errors}));
}finally{await context.close();await browser.close();}
