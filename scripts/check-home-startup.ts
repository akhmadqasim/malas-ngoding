import {launchBrowser} from './chromium.ts';
const browser=await launchBrowser();
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}), page=await context.newPage();
 await page.goto('http://localhost:3000/?cahaya=day');
 await page.getByRole('button',{name:/Sudah punya akun/}).click();
 await page.getByRole('button',{name:'Masuk sebagai warga demo'}).click();
 await page.getByRole('region',{name:'Dashboard rumah pribadi'}).waitFor();
 if(await page.getByRole('button',{name:'Lewati intro'}).count())throw new Error('Login still launches globe intro');
 await page.evaluate(()=>sessionStorage.clear());
 await page.reload();await page.getByRole('region',{name:'Dashboard rumah pribadi'}).waitFor();
 if(await page.locator('.intro,.landing').count())throw new Error('Restored account replays onboarding');
 await page.route('**/api/me/home',route=>route.fulfill({status:503,json:{error:'Uji koneksi'}}));
 await page.reload();await page.getByRole('button',{name:'Coba lagi',exact:true}).waitFor();
 if(await page.locator('.mapboxgl-map').count())throw new Error('Failed home fetch opened map or globe');
 await page.unroute('**/api/me/home');await page.getByRole('button',{name:'Coba lagi',exact:true}).click();
 await page.getByRole('region',{name:'Dashboard rumah pribadi'}).waitFor();
 console.log(JSON.stringify({welcomeLoginDirect:true,refreshWithoutSessionStorage:true,noRepeatedGlobe:true,homeFailureRetry:true}));
 await context.close();
}finally{await browser.close();}
