import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { handFrame } from '../src/lib/__tests__/helpers';

/** Artificial device and inference boundary. Verifies UI wiring, never real camera accuracy. */
async function artificialCamera(page:Page,delayMs=0) {
  const fixture=handFrame();
  await page.addInitScript(({fixture,delayMs})=>{
    const root=()=>document.documentElement;
    const pose=()=>root().dataset.pose??'open';
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>new MediaStream()});
    HTMLVideoElement.prototype.play=async function(){
      Object.defineProperties(this,{videoWidth:{configurable:true,value:640},videoHeight:{configurable:true,value:480},readyState:{configurable:true,value:2}});
    };
    HTMLVideoElement.prototype.requestVideoFrameCallback=function(callback){
      return window.setTimeout(()=>{const t=performance.now();callback(t,{captureTime:t,mediaTime:t/1000,presentationTime:t} as VideoFrameCallbackMetadata);},50);
    };
    HTMLVideoElement.prototype.cancelVideoFrameCallback=id=>clearTimeout(id);
    const bitmap=window.createImageBitmap;
    window.createImageBitmap=((source:ImageBitmapSource)=>bitmap(source instanceof HTMLVideoElement?document.createElement('canvas'):source)) as typeof createImageBitmap;
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<typeof draw>){
      if(args[0] instanceof HTMLVideoElement)return;
      return draw.apply(this,args);
    } as typeof draw;
    window.Worker=class {
      onmessage:((event:MessageEvent)=>void)|null=null;
      onerror=null;onmessageerror=null;
      postMessage(request:{type:string;sequence:number;captureTimeMs:number;bitmap?:ImageBitmap}){
        request.bitmap?.close();
        let data;
        if(request.type==='init')data={type:'initialized'};
        else if(request.type==='probe')data={type:'ready',delegate:'GPU',fallbackReason:null,probeDurationMs:1};
        else if(request.type==='dispose'){root().dataset.workerDisposed='true';data={type:'disposed'};}
        else {
          const world=fixture.worldLandmarks.map(p=>({x:p.x,y:p.y,z:p.z}));
          if(pose()==='curl')for(const base of [5,9,13,17]){
            const pip=world[base+1]!;world[base+2]={x:pip.x,y:pip.y,z:.025};world[base+3]={x:pip.x,y:pip.y-.025,z:.025};
          }
          const angle=pose()==='tilt'?25*Math.PI/180:0;
          const sample={...fixture,sequence:request.sequence,captureTimeMs:request.captureTimeMs,
            worldLandmarks:world.map(p=>({x:p.x,y:p.y*Math.cos(angle)-p.z*Math.sin(angle),z:p.y*Math.sin(angle)+p.z*Math.cos(angle)})),
            imageLandmarks:fixture.imageLandmarks.map(p=>({...p,y:.8-(.8-p.y)*2}))};
          data={type:'sample',sample:pose()==='absent'?{sequence:request.sequence,captureTimeMs:request.captureTimeMs,selectedHand:'Right',validity:'absent',reason:'no_hand'}:sample,durationMs:1};
        }
        if(request.type==='frame'&&delayMs)setTimeout(()=>this.onmessage?.(new MessageEvent('message',{data})),delayMs);
        else queueMicrotask(()=>this.onmessage?.(new MessageEvent('message',{data})));
      }
      terminate(){}
    } as unknown as typeof Worker;
  },{fixture,delayMs});
}
async function hold(page:Page,pose:string,ms:number) {
  await page.evaluate(pose=>{document.documentElement.dataset.pose=pose;},pose);
  await page.clock.runFor(ms);
}

for(const delay of [0,90])test(`automatic camera cycles advance sets and all tasks with ${delay} ms inference delay`,async({page})=>{
  await artificialCamera(page,delay);
  await page.clock.install();await page.goto('/#session');
  await page.getByRole('button',{name:'Guided routine',exact:true}).click();
  await expect(page.getByRole('button',{name:'Record repetition',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Next',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await expect(page.getByRole('button',{name:'Start camera',exact:true})).toBeDisabled();
  await hold(page,'curl',600);
  await hold(page,'open',1300);
  await expect(page.getByLabel('Movement guidance')).toContainText('Hold open');
  await expect(page.getByLabel('Motion sequence')).toContainText('Next');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(delay===90)await page.screenshot({path:'/private/tmp/itap-guided-motion.png',fullPage:true});
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await hold(page,'open',2200);await expect(page.getByText('0 / 5',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await hold(page,'curl',650);
  // Tracking loss clears an incomplete hold instead of awarding a rep on return.
  await hold(page,'open',1100);await hold(page,'absent',300);await hold(page,'open',2200);await hold(page,'curl',650);
  await expect(page.getByText('0 / 5',{exact:true})).toBeVisible();
  for(let i=0;i<10;i++){
    await hold(page,'open',2350);await hold(page,'curl',650);
    if(i===4)await expect(page.getByText('Set 2 / 2',{exact:true})).toBeVisible();
  }
  await expect(page.getByRole('heading',{name:'Make a Fist',exact:true})).toBeVisible();
  await expect(page.getByText('0 / 5',{exact:true})).toBeVisible();
  await hold(page,'open',650);
  for(let i=0;i<10;i++){await hold(page,'curl',850);await hold(page,'open',650);}
  await expect(page.getByRole('heading',{name:'Wrist Extension',exact:true})).toBeVisible();
  await expect(page.getByText('Palm-tilt estimate · support your forearm',{exact:true})).toBeVisible();
  for(const name of ['Wrist Extension','Wrist Flexion']){
    await expect(page.getByRole('heading',{name:name,exact:true})).toBeVisible();
    await hold(page,'open',1300);
    for(let i=0;i<20;i++){await hold(page,'tilt',850);await hold(page,'open',650);}
  }
  await expect(page).toHaveURL(/#exercises$/);
  await expect(page.getByText('4 of 4 exercises completed',{exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-worker-disposed','true');
});
