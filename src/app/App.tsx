import { useEffect, useRef, useState } from 'react';
import { GuidedRoutine } from '../components/workstation/GuidedRoutine';
import { useSessionController } from '../hooks/useSessionController';
import { Dashboard, Exercises, Progress, Shell, TrackedSession, dayKey } from '../components/workstation/Workspace';
import type { PageName, TrialRecord } from '../components/workstation/Workspace';
const readPage = (): PageName => {
  const hash = window.location.hash.slice(1);
  return hash === 'exercises' || hash === 'session' || hash === 'progress' ? hash : 'home';
};
export function App() {
  const [source, setSource] = useState<'live' | 'synthetic_replay'>('live');
  const session = useSessionController(source);
  const [page, setPage] = useState<PageName>(readPage);
  const [guided, setGuided] = useState(false), [task, setTask] = useState(0);
  const [date, setDate] = useState(dayKey());
  const [checks, setChecks] = useState<Record<string, number[]>>({});
  const [records, setRecords] = useState<TrialRecord[]>([]);
  const seen = useRef(new Set<string>());
  const title = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    const change = () => setPage(readPage());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => { title.current?.focus(); }, [page]);
  useEffect(() => {
    if (previousPage.current === 'session' && page !== 'session') session.commands.stop();
    previousPage.current = page;
  }, [page, session.commands]);
  useEffect(() => {
    const result = session.snapshot.result;
    if (!result || seen.current.has(result.sessionId)) return;
    seen.current.add(result.sessionId);
    if (seen.current.size > 100) seen.current.delete(seen.current.values().next().value!);
    setRecords(previous => [...previous.slice(-49), { result, at: Date.now() }]);
  }, [session.snapshot.result]);
  function navigate(next: PageName) { window.location.hash = next; setPage(next); }
  function trial() { setGuided(false); navigate('session'); }
  function practice(index = 0) { session.commands.stop(); setSource('live'); setTask(index); setGuided(true); setDate(dayKey()); navigate('session'); }
  function toggle(index: number, value?: boolean) {
    setChecks(previous => {
      const current = previous[date] ?? [];
      const checked = value ?? !current.includes(index);
      return { ...previous, [date]: checked ? [...new Set([...current, index])] : current.filter(i => i !== index) };
    });
  }
  return <Shell page={page} source={source} sensorMode={session.snapshot.selection.sensorMode}>
    <h1 ref={title} tabIndex={-1} className="sr-only">{page === 'home' ? 'Home' : page === 'exercises' ? 'Exercises' : page === 'progress' ? 'Progress' : 'Session'}</h1>
    {page === 'home' && <Dashboard completed={checks[dayKey()] ?? []} records={records} trial={trial} routine={() => navigate('exercises')} practice={practice}/>}
    {page === 'exercises' && <Exercises date={date} setDate={setDate} completed={checks[date] ?? []} toggle={toggle} begin={practice}/>}
    {page === 'session' && <><div className="session-tabs" aria-label="Session type"><button aria-pressed={!guided} onClick={() => setGuided(false)}>Tracked trial</button><button aria-pressed={guided} onClick={() => practice(task)}>Guided routine</button></div>
      {guided ? <GuidedRoutine {...session} key={task} task={task} setTask={setTask} complete={index => toggle(index, true)} back={() => navigate('exercises')}/> : <TrackedSession {...session} source={source} setSource={setSource} back={() => navigate('exercises')}/>}
    </>}
    {page === 'progress' && <Progress records={records} clear={() => { session.commands.reset(); setRecords([]); }} trial={trial}/>}
  </Shell>;
}
