import { useEffect, useRef, useState } from 'react';
import type { ViewProps } from '../stubs/Panels';
import { useGuidedRoutine } from '../../hooks/useGuidedRoutine';
import { ROUTINE_EXERCISES, routineMotion } from '../../lib/guidedRoutine';
import { RoutineCamera } from './RoutineCamera';
import './guidedRoutine.css';

function Motion({ label, name, pose }: {label:string;name:string;pose:string}) {
  const closed=pose==='closed';
  return <div className="routine-motion"><span>{label}</span><svg viewBox="0 0 100 105" aria-hidden="true" className={pose==='tilt'?'tilted':''}>
    <path d="M30 88V56Q18 47 14 54Q11 60 23 73L30 88V98H70V90Q82 78 82 65V49Q82 42 75 42Q68 42 68 49" fill="#f4e3d6" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>
    {[30,43,56,69].map((x,i)=><rect key={x} x={x} y={closed?43:18-Math.min(i,3-i)*10} width="12" height={closed?24:56+Math.min(i,3-i)*10} rx="6" fill="#f4e3d6" stroke="currentColor" strokeWidth="3"/>)}
    <path d="M30 69V85Q30 95 43 95H64Q76 95 76 82V68" fill="#f4e3d6" stroke="currentColor" strokeWidth="3"/>
  </svg><strong>{name}</strong></div>;
}
export function GuidedRoutine({ task, setTask, complete, back, ...session }: ViewProps & { task:number; setTask:(index:number)=>void; complete:(index:number)=>void; back:()=>void }) {
  const [paused,setPaused]=useState(false);
  const state=useGuidedRoutine(task,paused,session.frameBuffer,session.snapshot.phase==='ready');
  const advanced=useRef(false),heading=useRef<HTMLHeadingElement>(null);
  const item=ROUTINE_EXERCISES[task]!,motion=routineMotion(state);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    if(!state.complete||advanced.current)return;
    advanced.current=true;complete(task);
    if(task<ROUTINE_EXERCISES.length-1)setTask(task+1);else back();
  },[state.complete,task,complete,setTask,back]);
  return <>
    <header className="page-heading"><div className="heading-with-back"><button className="icon-button" onClick={back} aria-label="Back to exercises">←</button><h2>Guided routine</h2></div><span>{task+1} / 4</span></header>
    <div className="session-grid guided"><RoutineCamera {...session}/><section className="task-panel card">
      <h2 ref={heading} tabIndex={-1}>{item.name}</h2>
      <div className="section-heading"><span>Set {state.set} / 2</span><strong aria-live="polite">{state.reps} / {item.reps}</strong></div>
      <div className="routine-motions" aria-label="Motion sequence"><Motion label="Now" name={motion.now} pose={motion.pose}/><span aria-hidden="true">→</span><Motion label="Next" name={motion.next} pose={motion.nextPose}/></div>
      <div className="routine-cue" role="status" aria-label="Movement guidance">{paused?'Paused':state.message}{!paused&&state.remainingMs>0&&<strong> {Math.ceil(state.remainingMs/1000)}s</strong>}</div>
      <progress aria-label="Motion hold progress" value={state.holdProgress} max={1}/>
      <button onClick={()=>setPaused(!paused)}>{paused?'Resume':'Pause'}</button>
      <p className="routine-limit">{task>=2?'Palm-tilt estimate · support your forearm':'Camera pose estimate'}</p>
      <div className="routine-next"><span>Next exercise</span><strong>{ROUTINE_EXERCISES[task+1]?.name??'Finish routine'}</strong></div>
    </section></div>
  </>;
}
