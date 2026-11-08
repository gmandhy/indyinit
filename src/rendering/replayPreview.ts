import { FRAME_CONFIG, TARGET_FEEDBACK_CONFIG } from '../lib/config';
import type { FrameBuffer } from '../engine/contracts';
import type { Size } from '../lib/coordinates';
import { containFit, imageToPixels, sourceToDisplay } from '../lib/coordinates';
/** Canvas-only presentation of source geometry; collision/scoring stay in the pure engine. */
export function drawReplayPreview(context:CanvasRenderingContext2D,buffer:FrameBuffer,viewport:Size,nowMs?:number) {
  context.clearRect(0,0,viewport.width,viewport.height);
  const fit=containFit(buffer.video??{width:640,height:360},viewport,true),sample=buffer.current;
  const media=buffer.media;
  if(media&&media.readyState>=2){
    context.save();context.translate(fit.ox+fit.scale*fit.video.width,fit.oy);context.scale(-1,1);
    context.drawImage(media,0,0,fit.scale*fit.video.width,fit.scale*fit.video.height);context.restore();
  }
  context.strokeStyle='#789';context.strokeRect(fit.ox,fit.oy,fit.scale*fit.video.width,fit.scale*fit.video.height);
  // A placed ring remains visible when the hand is absent. Rendering is read-only;
  // presentation highlight duration never changes candidate eligibility.
  const desk=buffer.desk;
  if(desk?.pads)for(const pad of desk.pads){
    const p=sourceToDisplay(pad.region.center,fit),recent=nowMs!==undefined&&desk.lastAccepted?.pad===pad.id&&nowMs-desk.lastAccepted.atMs>=0&&nowMs-desk.lastAccepted.atMs<=TARGET_FEEDBACK_CONFIG.candidateHighlightMs;
    context.strokeStyle=recent?'#087f5b':'#165dc0';context.lineWidth=recent?4:2;
    context.beginPath();context.arc(p.x,p.y,pad.region.radiusPixels*fit.scale,0,Math.PI*2);context.stroke();
    context.fillStyle='#ffffff';context.fillRect(p.x-28,p.y+pad.region.radiusPixels*fit.scale+3,56,20);
    context.fillStyle='#123';context.fillText(`${pad.id==='left'?'Left':'Right'}${recent?' · tap':''}`,p.x-18,p.y+pad.region.radiusPixels*fit.scale+18);
  }
  if(desk?.region&&!desk.pads?.some(p=>p.region.center.x===desk.region!.center.x&&p.region.center.y===desk.region!.center.y)){
    const p=sourceToDisplay(desk.region.center,fit),recent=nowMs!==undefined&&desk.lastAccepted!==null&&nowMs-desk.lastAccepted.atMs>=0&&nowMs-desk.lastAccepted.atMs<=TARGET_FEEDBACK_CONFIG.candidateHighlightMs;
    context.lineWidth=recent?4:2;context.strokeStyle=recent?'#087f5b':desk.visual?.phase==='contactCandidate'?'#a60':'#165dc0';
    context.beginPath();context.arc(p.x,p.y,desk.region.radiusPixels*fit.scale,0,Math.PI*2);context.stroke();
    context.fillStyle='#165dc0';context.fillText(recent?(desk.lastAccepted?.mode==='fused'?'Accepted fused coincidence':'Accepted kinematic tap'):`Desk ring: ${desk.visual?.phase??'setup'}`,fit.ox+8,fit.oy+36);
  }
  if(desk?.lastAccepted?.position){const contact=sourceToDisplay(desk.lastAccepted.position,fit);context.fillStyle='#087f5b';context.beginPath();context.arc(contact.x,contact.y,6,0,Math.PI*2);context.fill();}
  if(sample?.validity!=='valid'||(nowMs!==undefined&&nowMs-sample.captureTimeMs>FRAME_CONFIG.maxAgeMs))return;
  context.strokeStyle=media?'#00ffff':'#123';context.lineWidth=2;
  for(const [a,b] of HAND_CONNECTIONS){
    const first=sourceToDisplay(imageToPixels(sample.imageLandmarks[a]!,fit.video),fit),second=sourceToDisplay(imageToPixels(sample.imageLandmarks[b]!,fit.video),fit);
    context.beginPath();context.moveTo(first.x,first.y);context.lineTo(second.x,second.y);context.stroke();
  }
  context.fillStyle=media?'#ffff00':'#123';
  for(const point of sample.imageLandmarks){const p=sourceToDisplay(imageToPixels(point,fit.video),fit);context.beginPath();context.arc(p.x,p.y,3,0,Math.PI*2);context.fill();}
  const target=buffer.target;
  if(target?.circle&&target.calibrationValid){
    const p=sourceToDisplay(target.circle.center,fit);context.strokeStyle=target.locked?'#a20':'#165dc0';context.beginPath();context.arc(p.x,p.y,target.circle.radiusPixels*fit.scale,0,Math.PI*2);context.stroke();
    // Text is drawn in display space and is never reflected.
    context.fillText(`${target.targetId}: ${target.reason}`,fit.ox+8,fit.oy+18);
  }
}

/** Standard 21-point topology, independent of the inference SDK. */
const HAND_CONNECTIONS: readonly (readonly [number,number])[] = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20],
];
