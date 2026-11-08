import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { handFrame } from '../src/lib/__tests__/helpers';
import { containFit, sourcePixel, sourceToDisplay } from '../src/lib/coordinates';

// Artificial inference and compact microphone events exercise the production controller/UI.
// Real AudioWorklet loading and DSP are checked separately in audio.spec.ts.
async function devices(page:Page) {
  const fixture=handFrame(),dip=fixture.worldLandmarks[7]!,angle=41*Math.PI/180;
  fixture.worldLandmarks[8]={...fixture.worldLandmarks[8]!,x:dip.x+.025*Math.sin(angle),y:dip.y+.025*Math.cos(angle)};
  await page.addInitScript(fixture=>{
    const root=()=>document.documentElement;
    const track={stop(){},getSettings:()=>({sampleRate:48000}),addEventListener(){},removeEventListener(){}};
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async(c:MediaStreamConstraints)=>c.audio?{getTracks:()=>[track],getAudioTracks:()=>[track]}:new MediaStream()});
    window.AudioContext=class {
      state='running';sampleRate=48000;destination={};onstatechange=null;
      get currentTime(){return performance.now()/1000;}
      audioWorklet={addModule:async()=>{}};resume=async()=>{};close=async()=>{};
      createMediaStreamSource(){return {connect(){},disconnect(){}};}
    } as unknown as typeof AudioContext;
    window.AudioWorkletNode=class {
      port={onmessage:null as ((event:unknown)=>void)|null,close(){},postMessage:(command:{epoch:number})=>{
        this.epoch=command.epoch;root().dataset.microphoneResets=String(Number(root().dataset.microphoneResets??0)+1);
        queueMicrotask(()=>this.port.onmessage?.({data:{type:'level',epoch:this.epoch,sampleTimeMs:performance.now(),blockFrames:128,status:{phase:'ready',reason:'Artificial quiet calibration',rms:0,noiseRms:0,thresholdRms:.04,elapsedMs:1500}}}));
      }};
      epoch=0;sequence=0;onprocessorerror=null;connect(){}disconnect(){}
      constructor(){Object.assign(window,{testImpulse:()=>this.port.onmessage?.({data:{type:'impulse',epoch:this.epoch,impulse:{sequence:this.sequence++,sampleTimeMs:performance.now()-25,rms:.2}}})});}
    } as unknown as typeof AudioWorkletNode;
    HTMLVideoElement.prototype.play=async function(){Object.defineProperties(this,{videoWidth:{configurable:true,value:1000},videoHeight:{configurable:true,value:1000},readyState:{configurable:true,value:2}});};
    HTMLVideoElement.prototype.requestVideoFrameCallback=function(callback){return window.setTimeout(()=>{const t=performance.now();callback(t,{captureTime:t,mediaTime:t/1000,presentationTime:t} as VideoFrameCallbackMetadata);},50);};
    HTMLVideoElement.prototype.cancelVideoFrameCallback=id=>clearTimeout(id);
    const bitmap=window.createImageBitmap;
    window.createImageBitmap=((source:ImageBitmapSource)=>bitmap(source instanceof HTMLVideoElement?document.createElement('canvas'):source)) as typeof createImageBitmap;
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<typeof draw>){if(!(args[0] instanceof HTMLVideoElement))draw.apply(this,args);} as typeof draw;
    window.Worker=class {
      onmessage:((event:MessageEvent)=>void)|null=null;onerror=null;onmessageerror=null;
      postMessage(request:{type:string;sequence:number;captureTimeMs:number;bitmap?:ImageBitmap}){
        request.bitmap?.close();let data;
        if(request.type==='init')data={type:'initialized'};
        else if(request.type==='probe')data={type:'ready',delegate:'GPU',fallbackReason:null,probeDurationMs:1};
        else if(request.type==='dispose')data={type:'disposed'};
        else data={type:'sample',durationMs:1,sample:{...fixture,sequence:request.sequence,captureTimeMs:request.captureTimeMs,imageLandmarks:fixture.imageLandmarks.map((p,i)=>({...p,x:p.x+Number(root().dataset.shift??0)/1000,y:p.y-(i===8?Number(root().dataset.lift??0)/1000:0)}))}};
        if(request.type==='frame'&&root().dataset.lost==='true')data={type:'sample',durationMs:1,sample:{sequence:request.sequence,captureTimeMs:request.captureTimeMs,validity:'absent',selectedHand:'Right',reason:'no_hand'}};
        queueMicrotask(()=>this.onmessage?.(new MessageEvent('message',{data})));
      }terminate(){}
    } as unknown as typeof Worker;
  },fixture);
}
async function move(page:Page,lift=0,shift?:number){await page.evaluate(({lift,shift})=>{document.documentElement.dataset.lift=String(lift);if(shift!==undefined)document.documentElement.dataset.shift=String(shift);},{lift,shift});await page.clock.runFor(50);}
async function place(page:Page,x:number){const canvas=page.locator('canvas'),bounds=await canvas.boundingBox();if(!bounds)throw Error('Missing viewport');const p=sourceToDisplay(sourcePixel(x,665),containFit({width:1000,height:1000},bounds,true));await canvas.click({position:p});}
async function confirm(page:Page){const next=page.locator('.desk-wizard').getByRole('button',{name:'Confirm and continue',exact:true});await expect(next).toBeEnabled();await next.click();}
async function visual(page:Page){await confirm(page);await page.getByRole('button',{name:'Capture resting fingertip',exact:true}).click();await page.clock.runFor(600);await confirm(page);await expect(page.getByRole('button',{name:'Finish visual calibration',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Record one lift / return',exact:true}).click();await page.getByRole('button',{name:'Save this cycle',exact:true}).click();await expect(page.locator('.desk-wizard')).toContainText('That recording was too short');await expect(page.locator('.desk-wizard').getByRole('button',{name:'Confirm and continue',exact:true})).toBeDisabled();for(let i=0;i<3;i++){await page.getByRole('button',{name:'Record one lift / return',exact:true}).click();for(const lift of [0,0,0,15,30,30,15,0,0,0])await move(page,lift);await page.getByRole('button',{name:'Save this cycle',exact:true}).click();}await page.getByRole('button',{name:'Finish visual calibration',exact:true}).click();await expect(page.locator('.desk-step-success')).toContainText('Task complete');await confirm(page);}
async function tap(page:Page,shift:number){await move(page,0,shift);for(const lift of [30,15,0,0])await move(page,lift);await page.evaluate(()=>(window as unknown as {testImpulse():void}).testImpulse());await page.clock.runFor(400);}

test('two-pad setup and alternating fused taps display the correct side without moving-wrist rejection',async({page},testInfo)=>{
  await devices(page);await page.clock.install();await page.goto('/#session');
  await page.getByRole('button',{name:'Set up desk taps',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Desk layout',exact:true})).toHaveValue('left_right');
  await expect(page.locator('.desk-wizard').getByRole('button',{name:'Confirm and continue',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Start camera',exact:true}).click();await confirm(page);
  await page.getByRole('button',{name:'Start / retry microphone (keep quiet)',exact:true}).click();await confirm(page);
  await page.getByRole('button',{name:'Calibrate palm / begin setup',exact:true}).click();await page.clock.runFor(3100);await confirm(page);
  await expect(page.locator('section[aria-labelledby="status"]')).toContainText('DIP estimate: 41.0°');
  await place(page,500);await visual(page);await expect(page.getByRole('heading',{name:'Place the right pad',exact:true})).toBeVisible();
  await move(page,0,-250);await place(page,250);await visual(page);
  for(let i=0;i<3;i++){await page.getByRole('button',{name:'Record timing tap',exact:true}).click();await tap(page,i%2?-250:0);await page.getByRole('button',{name:'Save timing pair',exact:true}).click();}
  await page.getByRole('button',{name:'Finish timing calibration',exact:true}).click();await confirm(page);await expect(page.locator('.desk-wizard')).toContainText('Setup confirmed');await page.locator('.session-grid').screenshot({path:testInfo.outputPath('setup-complete-desktop.png')});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('.session-grid').screenshot({path:testInfo.outputPath('setup-complete-narrow.png')});await page.setViewportSize({width:1280,height:720});
  await page.getByRole('button',{name:'Start fused trial',exact:true}).click();await page.clock.runFor(3100);
  await tap(page,0);await expect(page.getByLabel('Last tap side',{exact:true})).toHaveText('left');
  await tap(page,-250);await expect(page.getByLabel('Last tap side',{exact:true})).toHaveText('right');
  await expect(page.getByLabel('Left pad taps',{exact:true})).toHaveText('1');await expect(page.getByLabel('Right pad taps',{exact:true})).toHaveText('1');
  await move(page,0,-125);await page.evaluate(()=>(window as unknown as {testImpulse():void}).testImpulse());await page.clock.runFor(400);
  await expect(page.getByLabel('Recognized table taps',{exact:true})).toHaveText('2');
  await tap(page,0);await expect(page.getByLabel('Left pad taps',{exact:true})).toHaveText('2');
  await page.getByRole('region',{name:'Table tap recognition'}).screenshot({path:testInfo.outputPath('left-right-taps.png')});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('region',{name:'Table tap recognition'}).screenshot({path:testInfo.outputPath('left-right-narrow.png')});
  await page.clock.runFor(15000);await expect(page.locator('section[aria-labelledby="results"]')).toContainText('completed');
});

test('fixed synthetic replay exposes a single ring and labels left/right as live-camera setup',async({page})=>{
  await page.goto('/#session');await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('synthetic_replay');
  await page.getByRole('button',{name:'Set up desk taps',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Desk layout',exact:true})).toHaveValue('single');
  await expect(page.locator('option[value="left_right"]')).toBeDisabled();
});

test('guided setup returns to palm calibration after tracking loss and resets confirmations on restart',async({page})=>{
  await devices(page);await page.clock.install();await page.goto('/#session');await page.getByRole('button',{name:'Set up desk taps',exact:true}).click();
  await page.getByRole('button',{name:'Start camera',exact:true}).click();await confirm(page);
  await page.getByRole('button',{name:'Start / retry microphone (keep quiet)',exact:true}).click();await confirm(page);
  await page.getByRole('button',{name:'Calibrate palm / begin setup',exact:true}).click();await page.clock.runFor(3100);await confirm(page);
  await place(page,500);await confirm(page);await page.getByRole('button',{name:'Capture resting fingertip',exact:true}).click();await page.clock.runFor(600);await confirm(page);
  const resets=await page.locator('html').getAttribute('data-microphone-resets');
  await page.evaluate(()=>{document.documentElement.dataset.lost='true';});await page.clock.runFor(100);
  await expect(page.locator('html')).toHaveAttribute('data-microphone-resets',resets!);
  await expect(page.getByRole('heading',{name:'Check your microphone',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Calibrate your hand position',exact:true})).toBeVisible();
  await expect(page.locator('.desk-wizard').getByRole('button',{name:'Confirm and continue',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Restart setup',exact:true}).click();await expect(page.getByRole('heading',{name:'Position your camera',exact:true})).toBeVisible();
});
