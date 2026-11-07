import type { ImageLandmark } from './schemas';
import { MATH_CONFIG } from './config';
import { MathInputError, point2, point3, positive } from './mathValidation';
export interface Size { readonly width:number; readonly height:number }
declare const sourcePixels: unique symbol;
declare const displayPixels: unique symbol;
export type SourcePixel = {readonly x:number;readonly y:number;readonly [sourcePixels]:true};
export type DisplayPixel = {readonly x:number;readonly y:number;readonly [displayPixels]:true};
export interface ImageBasis { readonly longitudinal:{readonly x:number;readonly y:number}; readonly transverse:{readonly x:number;readonly y:number} }
export interface ContainFit { readonly video:Size; readonly viewport:Size; readonly scale:number; readonly ox:number; readonly oy:number; readonly mirrored:boolean }
export function validateSize(size:Size): void { positive(size.width,'width');positive(size.height,'height'); }
export function containFit(video:Size,viewport:Size,mirrored=true):ContainFit {
  validateSize(video);validateSize(viewport);
  const scale=Math.min(viewport.width/video.width,viewport.height/video.height);
  return {video:{...video},viewport:{...viewport},scale,ox:(viewport.width-scale*video.width)/2,oy:(viewport.height-scale*video.height)/2,mirrored};
}
export function sourcePixel(x:number,y:number):SourcePixel { point2({x,y});return {x,y} as SourcePixel; }
export function imageToPixels(p:ImageLandmark,video:Size):SourcePixel {
  point3(p,'image landmark');validateSize(video);return sourcePixel(p.x*video.width,p.y*video.height);
}
export function sourceToDisplay(p:SourcePixel,fit:ContainFit):DisplayPixel {
  point2(p); const f=containFit(fit.video,fit.viewport,fit.mirrored);
  return {x:f.ox+f.scale*(f.mirrored?f.video.width-p.x:p.x),y:f.oy+f.scale*p.y} as DisplayPixel;
}
/** Letterbox clicks are absence, not clamped target positions. Logical CSS pixels, independent of DPR. */
export function displayToSource(p:{x:number;y:number},fit:ContainFit):SourcePixel|null {
  point2(p); const f=containFit(fit.video,fit.viewport,fit.mirrored);
  const x=(p.x-f.ox)/f.scale,y=(p.y-f.oy)/f.scale;
  if(x<0||y<0||x>f.video.width||y>f.video.height)return null;
  return sourcePixel(f.mirrored?f.video.width-x:x,y);
}
export function canvasBackingSize(viewport:Size,devicePixelRatio:number):Size {
  validateSize(viewport);positive(devicePixelRatio,'device pixel ratio');
  return {width:Math.round(viewport.width*devicePixelRatio),height:Math.round(viewport.height*devicePixelRatio)};
}
export function imagePalmBasis(wrist:SourcePixel,middle:SourcePixel,index:SourcePixel,pinky:SourcePixel):ImageBasis {
  [wrist,middle,index,pinky].forEach(p=>point2(p));
  const normalize=(x:number,y:number)=>{const l=Math.hypot(x,y);if(l<MATH_CONFIG.vectorEpsilonPixels)throw new MathInputError('Degenerate image palm axis (pixels)');return {x:x/l,y:y/l};};
  const a=normalize(middle.x-wrist.x,middle.y-wrist.y),dx=pinky.x-index.x,dy=pinky.y-index.y,dot=dx*a.x+dy*a.y;
  return {longitudinal:a,transverse:normalize(dx-dot*a.x,dy-dot*a.y)};
}
