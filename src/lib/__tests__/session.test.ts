import { describe, expect, it } from 'vitest';
import { createSessionMachine } from '../../engine/sessionReducer';
describe('injected monotonic session lifecycle', () => {
  it('allows only valid transitions, runs countdown and completes a fixed capture-time interval', () => {
    let now=100; const m=createSessionMachine(()=>now);
    expect(()=>m.send('start')).toThrow(/idle/);
    for(const event of ['request','prepared','calibrate','calibrated','start'] as const) m.send(event);
    expect(m.getState().phase).toBe('countdown');
    now=3099;m.send('tick');expect(m.getState().phase).toBe('countdown');
    now=3200;m.send('tick');expect(m.getState()).toMatchObject({phase:'running',startedAtMs:3100,endsAtMs:18100});
    expect(m.acceptsCapture(3100)).toBe(true);expect(m.acceptsCapture(18100)).toBe(false);
    now=19000;m.send('tick');expect(m.getState()).toMatchObject({phase:'complete',status:'completed',endedAtMs:18100});
    expect(m.acceptsCapture(18000)).toBe(false); // delivery outside 250 ms grace
    now=18000;expect(()=>m.send('reset')).toThrow(/monotonic/);
  });
  it('aborts on tracking loss, hidden tab and mode change; resets and recovers from faults', () => {
    for(const event of ['tracking_lost','hidden','mode_changed'] as const) {
      let time=0;const m=createSessionMachine(()=>time);
      for(const e of ['request','prepared','calibrate','calibrated','start'] as const)m.send(e);
      time=3000;m.send('tick');time=3500;m.send(event);
      expect(m.getState()).toMatchObject({phase:'ready',status:'aborted',calibrationValid:false});
      expect(m.acceptsCapture(3200)).toBe(false);
      m.send('reset');expect(m.getState().phase).toBe('ready');m.send('stop');expect(m.getState().phase).toBe('idle');
      m.send('request');m.send('fault');expect(m.getState().phase).toBe('error');m.send('request');m.send('prepared');expect(m.getState().phase).toBe('ready');
    }
  });

  it('cancels requesting/calibrating/countdown states without retaining trial timestamps',()=>{
    const m=createSessionMachine(()=>0);
    m.send('request');m.send('cancel');expect(m.getState().phase).toBe('idle');
    m.send('request');m.send('prepared');expect(()=>m.send('prepared')).toThrow(/ready/);
    expect(()=>m.send('start')).toThrow(/ready/);
    m.send('calibrate');m.send('cancel');expect(m.getState()).toMatchObject({phase:'ready',calibrationValid:false,countdownEndsAtMs:null});
    m.send('calibrate');m.send('calibrated');m.send('start');m.send('reset');
    expect(m.getState()).toMatchObject({phase:'ready',startedAtMs:null,endsAtMs:null,countdownEndsAtMs:null,status:null});
  });
  it('bounds late matching and validates time/configuration', () => {
    let time=0;const m=createSessionMachine(()=>time);
    for(const e of ['request','prepared','calibrate','calibrated','start'] as const)m.send(e);
    time=18000;m.send('tick');time=18250;
    expect(m.acceptsCapture(17999)).toBe(true);expect(m.acceptsCapture(18000)).toBe(false);
    time++;expect(m.acceptsCapture(17999)).toBe(false);
    expect(()=>createSessionMachine(()=>NaN)).toThrow(/time/);
    expect(()=>createSessionMachine(()=>0,{trialMs:0})).toThrow(/trialMs/);
  });
});
