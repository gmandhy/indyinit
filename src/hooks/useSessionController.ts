import { createAudioAdapter } from '../adapters/audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createLiveAdapter } from '../adapters/live';
import { verifyLocalAssets } from '../adapters/vision';
import { createReplayAdapter } from '../adapters/replay';
import { createSessionController } from '../engine/sessionController';
import { initialSnapshot } from '../engine/contracts';
import type { ControllerCommands, FrameBuffer, SessionController } from '../engine/contracts';
export function useSessionController(source: 'live' | 'synthetic_replay' = 'live') {
  const controller = useRef<SessionController | null>(null);
  const frameBuffer = useRef<FrameBuffer>({ current: null });
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(source));
  useEffect(() => {
    // Each effect owns its controller. Strict Mode cleanup cannot poison the next mount.
    const abort = new AbortController();
    const owned = source === 'live' ? createSessionController(createLiveAdapter(),undefined,()=>performance.now(),undefined,createAudioAdapter()) : createSessionController(createReplayAdapter(() => performance.now()), () => verifyLocalAssets(abort.signal));
    controller.current = owned;
    frameBuffer.current = owned.frameBuffer;
    setSnapshot(owned.getSnapshot());
    const unsubscribe = owned.subscribe(() => setSnapshot(owned.getSnapshot()));
    const timer=setInterval(()=>owned.tick(),50);
    const visibility=()=>owned.setHidden(document.hidden);
    document.addEventListener('visibilitychange',visibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange',visibility); unsubscribe(); abort.abort(); owned.dispose(); controller.current = null; frameBuffer.current = { current: null }; };
  }, [source]);
  const commands = useMemo<ControllerCommands>(() => ({
    setDeskLayout:layout=>controller.current?.setDeskLayout(layout),
    replayTap:()=>controller.current?.replayTap(),
    tick:()=>controller.current?.tick(), setHidden:hidden=>controller.current?.setHidden(hidden),
    startDevices: async () => { await controller.current?.startDevices(); },
    startMicrophone:async()=>{await controller.current?.startMicrophone();},
    beginTimingPair:()=>controller.current?.beginTimingPair(),saveTimingPair:()=>controller.current?.saveTimingPair(),finishTimingCalibration:()=>controller.current?.finishTimingCalibration(),
    calibrate: () => controller.current?.calibrate(), startExercise: () => controller.current?.startExercise(),
    cancelCalibration:()=>controller.current?.cancelCalibration(),
    placeDeskRing:(point,viewport)=>controller.current?.placeDeskRing(point,viewport),
    captureDeskRest:()=>controller.current?.captureDeskRest(),beginDeskCycle:()=>controller.current?.beginDeskCycle(),
    saveDeskCycle:()=>controller.current?.saveDeskCycle(),finishDeskCalibration:()=>controller.current?.finishDeskCalibration(),
    stop: () => controller.current?.stop(), reset: () => controller.current?.reset(),
    selectExercise: selection => controller.current?.selectExercise(selection), dispose: () => controller.current?.dispose(),
  }), []);
  return { snapshot, commands, frameBuffer };
}
