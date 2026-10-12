import { test, expect } from '@playwright/test';
const api='http://localhost:3000/api/v1';
test('authenticated package authoring publishes a real offer usable by registration',async({page,context})=>{
 await page.goto('/');
 await page.getByLabel('Email',{exact:true}).fill('admin@example.test');
 await page.getByLabel('Kata sandi',{exact:true}).fill(process.env.SEED_PASSWORD!);
 const login=async()=>{
  const pending=page.waitForResponse(r=>r.url()===`${api}/auth/sign-in/email` && r.request().method()==='POST');
  await page.getByRole('button',{name:'Masuk ke akun'}).click();return pending;
 };
 let response=await login();
 if(response.status()===429){
  const seconds=Number(response.headers()['x-retry-after']);
  expect(Number.isFinite(seconds)&&seconds>0&&seconds<=10).toBe(true);
  await new Promise(resolve=>setTimeout(resolve,seconds*1000+100));response=await login();
 }
 expect(response.status()).toBe(200);
 await expect(page.getByText('AKUN TERHUBUNG',{exact:true})).toBeVisible();
 const me=(await (await context.request.get(`${api}/me`)).json()).data;
 const branchId=me.branchAccess[0].branchId;
 let n=0;
 const command=async(method:'POST'|'PATCH',path:string,data:object)=>{
  const result=await context.request.fetch(`${api}${path}`,{method,headers:{Origin:'http://localhost:5173','Idempotency-Key':`browser-plan-${++n}`},data});
  expect(result.ok(),await result.text()).toBe(true);return (await result.json()).data;
 };
 let p=(await command('POST','/plans',{branchId,draft:{}})).plan;
 const path=`/plans/${p.id}?branchId=${branchId}`;
 p=(await command('PATCH',path,{version:p.version,draft:{name:'Browser authored plan',price:{amount:'300000.00',currency:'IDR'},duration:{value:1,unit:'month'},benefits:[]}})).plan;
 const publication=await command('POST',`/plans/${p.id}/publish?branchId=${branchId}`,{version:p.version});
 expect(publication.plan.status).toBe('published');
 const offer=publication.publishedVersion;
 const selected=await context.request.get(`${api}/plan-versions/${offer.id}?branchId=${branchId}`);
 expect(selected.status()).toBe(200);expect((await selected.json()).data.price.amount).toBe('300000.00');
 let registration=(await command('POST','/registrations',{branchId,planVersionId:offer.id,identity:{fullName:'Package Browser Synthetic',phone:'+62819999555555',address:'Test only',birthDate:'2000-01-01'}})).registration;
 registration=(await command('POST',`/registrations/${registration.id}/submit`,{version:registration.version})).registration;
 expect(registration.status).toBe('pending_review');
 registration=(await command('POST',`/registrations/${registration.id}/review`,{version:registration.version,decision:'approve'})).registration;
 expect(registration.orderId).toBeTruthy();expect(registration.offer.id).toBe(offer.id);
 expect((await (await context.request.get(`${api}/me`)).json()).data.entitlements).toEqual([]);
});
