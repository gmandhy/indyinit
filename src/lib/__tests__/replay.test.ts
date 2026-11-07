import { afterEach, expect, it, vi } from 'vitest';
import { createReplayAdapter } from '../../adapters/replay';
import type { AdapterEvent } from '../../engine/contracts';
afterEach(()=>vi.useRealTimers());
it('does not emit future capture timestamps when a browser timer wakes before its nominal deadline',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);let clockLagMs=0;
  const now=()=>Date.now()-clockLagMs,adapter=createReplayAdapter(now),events:AdapterEvent[]=[];
  await adapter.prepare();adapter.play(e=>events.push(e));expect(events).toHaveLength(1);
  clockLagMs=.25;await vi.advanceTimersByTimeAsync(50);expect(events).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);expect(events).toHaveLength(2);
  const event=events[1];expect(event?.type==='frame'&&event.sample.captureTimeMs<=now()).toBe(true);
  adapter.dispose();expect(vi.getTimerCount()).toBe(0);
});
it('does not rearm a callback after the consumer stops playback during delivery',async()=>{
  vi.useFakeTimers();const adapter=createReplayAdapter(()=>Date.now()),sink=vi.fn(()=>adapter.stop());
  await adapter.prepare();adapter.play(sink);expect(sink).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);adapter.dispose();
});
