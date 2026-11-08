import { describe, expect, it, vi } from 'vitest';
import { drawReplayPreview } from '../../rendering/replayPreview';
import { syntheticHandFrame } from '../../../fixtures/syntheticHand';
import { containFit, imageToPixels, sourcePixel, sourceToDisplay } from '../coordinates';
function context() {
  return {clearRect:vi.fn(),save:vi.fn(),translate:vi.fn(),scale:vi.fn(),drawImage:vi.fn(),restore:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),arc:vi.fn(),fill:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),fillRect:vi.fn(),fillText:vi.fn()} as unknown as CanvasRenderingContext2D;
}
describe('live skeleton/video presentation',()=>{
  it('mirrors only the video draw transform and maps all 21 joints through the identical letterboxed fit',()=>{
    for(const hand of ['Left','Right'] as const){
      const ctx=context(),sample=syntheticHandFrame(10,0,hand),media={readyState:2} as HTMLVideoElement,video={width:640,height:480},viewport={width:800,height:400};
      drawReplayPreview(ctx,{current:sample,video,media},viewport,20);
      const fit=containFit(video,viewport,true),first=sourceToDisplay(imageToPixels(sample.imageLandmarks[0]!,video),fit);
      expect(ctx.translate).toHaveBeenCalledWith(fit.ox+fit.scale*video.width,fit.oy);
      expect(ctx.scale).toHaveBeenCalledExactlyOnceWith(-1,1);expect(ctx.restore).toHaveBeenCalledTimes(1);
      expect(ctx.drawImage).toHaveBeenCalledWith(media,0,0,fit.scale*video.width,fit.scale*video.height);
      expect(ctx.arc).toHaveBeenCalledTimes(21);expect(ctx.arc).toHaveBeenNthCalledWith(1,first.x,first.y,3,0,Math.PI*2);
      expect(ctx.moveTo).toHaveBeenCalledTimes(21);
    }
  });
  it('keeps the accepted camera location at the mirrored source position after the ring flash',()=>{
    const ctx=context(),video={width:640,height:480},viewport={width:800,height:400},position=sourcePixel(260,205);
    const desk={region:{center:sourcePixel(250,200),radiusPixels:25},visual:null,lastCandidate:null,lastAccepted:{atMs:80,mode:'fused' as const,position}};
    drawReplayPreview(ctx,{current:null,desk,video},viewport,1000);
    const p=sourceToDisplay(position,containFit(video,viewport,true));
    expect(ctx.arc).toHaveBeenCalledWith(p.x,p.y,6,0,Math.PI*2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(desk.lastAccepted.position).toEqual(sourcePixel(260,205));
  });
  it('draws Left and Right with only the matched pad highlighted, mirrored exactly once',()=>{
    const ctx=context(),video={width:640,height:480},viewport={width:800,height:400};
    const left={id:'left' as const,region:{center:sourcePixel(450,200),radiusPixels:25}},right={id:'right' as const,region:{center:sourcePixel(190,200),radiusPixels:25}};
    drawReplayPreview(ctx,{current:null,video,desk:{region:right.region,pads:[left,right],visual:null,lastCandidate:null,lastAccepted:{atMs:80,mode:'fused',pad:'left',position:sourcePixel(450,200)}}},viewport,100);
    expect(ctx.arc).toHaveBeenCalledTimes(3); // two rings and one contact marker, no duplicate active ring
    expect(ctx.fillText).toHaveBeenCalledWith('Left · tap',expect.any(Number),expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('Right',expect.any(Number),expect.any(Number));
    const p=sourceToDisplay(left.region.center,containFit(video,viewport,true));
    expect(ctx.arc).toHaveBeenLastCalledWith(p.x,p.y,6,0,Math.PI*2);
  });
  it('continues drawing video while clearing stale/lost skeletons',()=>{
    const ctx=context(),media={readyState:2} as HTMLVideoElement;
    drawReplayPreview(ctx,{current:syntheticHandFrame(10,0),media}, {width:640,height:360},131);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);expect(ctx.arc).not.toHaveBeenCalled();
    drawReplayPreview(ctx,{current:{sequence:1,captureTimeMs:140,selectedHand:'Right',validity:'absent',reason:'no_hand'},media}, {width:640,height:360},145);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);expect(ctx.arc).not.toHaveBeenCalled();
  });
  it('draws the placed desk ring with no hand and highlights only an accepted tap without changing it',()=>{
    const ctx=context(),desk={region:{center:sourcePixel(250,200),radiusPixels:25},visual:null,lastAccepted:{atMs:80,mode:'fused' as const},lastCandidate:{sequence:1,cycle:1,captureTimeMs:50,observedAtMs:80}},video={width:640,height:480},viewport={width:800,height:400};
    const before=JSON.stringify(desk);drawReplayPreview(ctx,{current:null,desk,video},viewport,100);
    const fit=containFit(video,viewport),p=sourceToDisplay(desk.region.center,fit);
    expect(ctx.arc).toHaveBeenCalledExactlyOnceWith(p.x,p.y,25*fit.scale,0,Math.PI*2);expect(ctx.fillText).toHaveBeenCalledWith('Accepted fused coincidence',fit.ox+8,fit.oy+36);
    drawReplayPreview(ctx,{current:null,desk,video},viewport,300);expect(JSON.stringify(desk)).toBe(before);
    drawReplayPreview(ctx,{current:null,desk:{...desk,lastAccepted:null},video},viewport,100);expect(ctx.fillText).toHaveBeenLastCalledWith('Desk ring: setup',fit.ox+8,fit.oy+36);
  });
});
