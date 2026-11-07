import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {parseTelemetryJson} from '../src/lib/schemas';
const status=(page:Page)=>page.locator('section[aria-labelledby="status"]');
async function replay(page:Page){
 await page.clock.install({time:new Date('2026-11-07T12:00:00Z')});await page.goto('/#session');await page.clock.pauseAt(new Date('2026-11-07T12:00:01Z'));
 await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('synthetic_replay');await page.getByRole('button',{name:'Start replay adapter',exact:true}).click();
 await expect(page.getByRole('button',{name:'Calibrate synthetic palm',exact:true})).toBeEnabled();
}
async function desk(page:Page,mode:'fused'|'kinematic_only'){
 await page.getByRole('combobox',{name:'Exercise',exact:true}).selectOption(`desk_tap:${mode}`);await page.getByRole('button',{name:'Calibrate synthetic palm',exact:true}).click();await page.clock.runFor(3100);
 const canvas=page.locator('canvas');const bounds=await canvas.boundingBox();if(!bounds)throw Error('Missing canvas');
 await canvas.click({position:{x:bounds.width*.5,y:bounds.height*153/360}});
 await page.getByRole('button',{name:'Capture resting fingertip',exact:true}).click();await page.clock.runFor(600);
 for(let i=0;i<3;i++){await page.getByRole('button',{name:'Record one lift / return',exact:true}).click();await tap(page);await page.getByRole('button',{name:'Save this cycle',exact:true}).click();}
 await page.getByRole('button',{name:'Finish visual calibration',exact:true}).click();
 if(mode==='fused'){for(let i=0;i<3;i++){await page.getByRole('button',{name:'Record timing tap',exact:true}).click();await tap(page);await page.getByRole('button',{name:'Save timing pair',exact:true}).click();}await page.getByRole('button',{name:'Finish timing calibration',exact:true}).click();}
 await expect(status(page)).toContainText('Calibration: valid');
}
async function tap(page:Page){await page.getByRole('button',{name:'Replay one lift / tap',exact:true}).click();await page.clock.runFor(800);}
async function exported(page:Page){const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export validated JSON',exact:true}).click();const file=await download;const stream=await file.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));return parseTelemetryJson(Buffer.concat(chunks).toString('utf8'));}

test('air flow, view replacement, validated export, reset and restart; requests contain no media',async({page},testInfo)=>{
 const requests:{url:string;method:string;bytes:number}[]=[];page.on('request',r=>requests.push({url:r.url(),method:r.method(),bytes:r.postDataBuffer()?.length??0}));
 await replay(page);await page.getByRole('button',{name:'Calibrate synthetic palm',exact:true}).click();await page.clock.runFor(3100);await page.getByRole('button',{name:'Start synthetic trial',exact:true}).click();await page.clock.runFor(3100);
 await page.getByLabel('Compact workstation').check();await expect(status(page)).toContainText('running:');await page.clock.runFor(15100);
 const result=await exported(page);expect(result).toMatchObject({source:'synthetic_replay',exercise:'air_targets',status:'completed',durationSeconds:15});if(result.exercise!=='air_targets')throw Error();expect(result.metrics.completedReps).toBeGreaterThan(0);expect(result.metrics.baselineComparison).toBeNull();
 await page.getByRole('button',{name:'Reset',exact:true}).click();await expect(page.getByRole('button',{name:'Export validated JSON',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Calibrate synthetic palm',exact:true}).click();await page.clock.runFor(3100);await expect(status(page)).toContainText('Calibration: valid');await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Start replay adapter',exact:true}).click();await expect(status(page)).toContainText('ready:');
 expect(requests.every(r=>new URL(r.url).origin==='http://127.0.0.1:4176'&&r.method==='GET'&&r.bytes===0)).toBe(true);await testInfo.attach('request-metadata.json',{body:JSON.stringify(requests,null,2),contentType:'application/json'});
});
for(const mode of ['fused','kinematic_only'] as const)test(`full ${mode} desk calibration, fixed trial, exactly-once score and export`,async({page})=>{
 await replay(page);await desk(page,mode);await page.getByRole('button',{name:'Start synthetic trial',exact:true}).click();await page.clock.runFor(3100);await tap(page);await expect(page.getByLabel('Accepted desk taps')).toHaveText('1');await page.clock.runFor(1000);await expect(page.getByLabel('Accepted desk taps')).toHaveText('1');await tap(page);await expect(page.getByLabel('Accepted desk taps')).toHaveText('2');await page.clock.runFor(13500);
 const r=await exported(page);expect(r).toMatchObject({source:'synthetic_replay',sensorMode:mode,status:'completed',durationSeconds:15,metrics:{acceptedTapCount:2,verifiedTapCount:mode==='fused'?2:0,kinematicTapCount:mode==='fused'?0:2,frequencyHz:2/15,earlyHz:.4,lateHz:0,rateChangePct:-100,rhythmJitterMs:null,meanAcousticRms:mode==='fused'?.2:null}});
 await page.getByRole('button',{name:'Reset',exact:true}).click();await expect(status(page)).toContainText('Calibration: not_started');await desk(page,mode);await page.getByRole('button',{name:'Start synthetic trial',exact:true}).click();await page.clock.runFor(3500);await page.getByRole('button',{name:'Stop',exact:true}).click();expect(await exported(page)).toMatchObject({status:'aborted',sensorMode:mode,metrics:{earlyHz:null,lateHz:null,rateChangePct:null}});
});
test('hidden tab and sensor changes abort; fresh calibration is required',async({page})=>{
 await replay(page);await desk(page,'fused');await page.getByRole('button',{name:'Start synthetic trial',exact:true}).click();await page.clock.runFor(3500);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});expect(await exported(page)).toMatchObject({status:'aborted',sensorMode:'fused'});await expect(status(page)).toContainText('Tab hidden');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await page.getByRole('button',{name:'Reset',exact:true}).click();await desk(page,'fused');await page.getByRole('button',{name:'Start synthetic trial',exact:true}).click();await page.clock.runFor(3500);await page.getByRole('combobox',{name:'Exercise',exact:true}).selectOption('desk_tap:kinematic_only');expect(await exported(page)).toMatchObject({status:'aborted',sensorMode:'fused'});await expect(status(page)).toContainText('Sensor selection: kinematic_only');await expect(page.getByRole('button',{name:'Start synthetic trial',exact:true})).toBeDisabled();
});
test('device denial, retry, labeled fallback and missing-asset recovery through real adapters',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{throw new DOMException('Browser test denied device','NotAllowedError');}});});await page.goto('/#session');await page.getByRole('combobox',{name:'Exercise',exact:true}).selectOption('desk_tap:fused');await page.getByRole('button',{name:'Start / retry microphone (keep quiet)',exact:true}).click();await expect(status(page)).toContainText('Microphone: unavailable');await expect(status(page)).toContainText('Sensor selection: fused');
 await page.getByRole('button',{name:'Start camera',exact:true}).click();await expect(status(page)).toContainText('error:');await expect(status(page)).toContainText('denied');await page.getByRole('button',{name:'Start camera',exact:true}).click();await expect(status(page)).toContainText('error:');
 await page.getByRole('combobox',{name:'Exercise',exact:true}).selectOption('desk_tap:kinematic_only');await expect(status(page)).toContainText('kinematic_only');await expect(page.getByRole('button',{name:'Start kinematic trial',exact:true})).toBeDisabled();
 await page.route('**/models/hand_landmarker.task',route=>route.fulfill({status:404,body:'Not found'}));await page.getByRole('button',{name:'Start camera',exact:true}).click();await expect(status(page)).toContainText('error:');await expect(page.getByRole('status').filter({hasText:/^Assets:/})).toContainText('missing');await page.unroute('**/models/hand_landmarker.task');await page.getByRole('button',{name:'Start camera',exact:true}).click();await expect(status(page)).toContainText('denied');
 await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('synthetic_replay');await page.getByRole('button',{name:'Start replay adapter',exact:true}).click();await expect(status(page)).toContainText('ready:');await expect(page.getByText('Synthetic replay — no live camera or microphone evidence',{exact:true})).toBeVisible();
});

