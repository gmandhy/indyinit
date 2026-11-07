import { describe, expect, it, vi } from 'vitest';
import { drawReplayPreview } from '../../rendering/replayPreview';
import { syntheticHandFrame } from '../../../fixtures/syntheticHand';
import { containFit, imageToPixels, sourceToDisplay } from '../coordinates';
function context() {
  return {clearRect:vi.fn(),save:vi.fn(),translate:vi.fn(),scale:vi.fn(),drawImage:vi.fn(),restore:vi.fn(),strokeRect:vi.fn(),beginPath:vi.fn(),arc:vi.fn(),fill:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),fillText:vi.fn()} as unknown as CanvasRenderingContext2D;
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
  it('continues drawing video while clearing stale/lost skeletons',()=>{
    const ctx=context(),media={readyState:2} as HTMLVideoElement;
    drawReplayPreview(ctx,{current:syntheticHandFrame(10,0),media}, {width:640,height:360},131);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);expect(ctx.arc).not.toHaveBeenCalled();
    drawReplayPreview(ctx,{current:{sequence:1,captureTimeMs:140,selectedHand:'Right',validity:'absent',reason:'no_hand'},media}, {width:640,height:360},145);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);expect(ctx.arc).not.toHaveBeenCalled();
  });
});
