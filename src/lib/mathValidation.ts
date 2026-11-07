/** Pure-math failures are programming/data errors. Runtime boundaries may expose these as invalid samples. */
export class MathInputError extends Error {
  constructor(message: string) { super(message); this.name='MathInputError'; }
}
export function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new MathInputError(`${name} must be finite`);
  return value;
}
export function positive(value: number, name: string): number {
  finite(value,name); if(value<=0) throw new MathInputError(`${name} must be positive`); return value;
}
export function timeMs(value: number): number {
  finite(value,'timeMs'); if(value<0) throw new MathInputError('timeMs must be nonnegative'); return value;
}
export function point2(p: {x:number;y:number}, name='point'): void { if(!p||typeof p!=='object')throw new MathInputError(`${name} must be a point`); finite(p.x,`${name}.x`);finite(p.y,`${name}.y`); }
export function point3(p: {x:number;y:number;z:number}, name='point'): void { point2(p,name);finite(p.z,`${name}.z`); }
export function landmarks(points: readonly {x:number;y:number;z:number}[], name: string): void {
  if(!Array.isArray(points)||points.length!==21) throw new MathInputError(`${name} requires exactly 21 landmarks`);
  points.forEach((p,i)=>point3(p,`${name}[${i}]`));
}
export function median(values: readonly number[]): number {
  if(values.length===0) throw new MathInputError('Median requires nonempty values');
  values.forEach(v=>finite(v,'median value'));
  const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]!:a[m-1]!/2+a[m]!/2;
}
export function validatePositiveConfig(config: Record<string,number>): void {
  for(const [key,value] of Object.entries(config))positive(value,key);
}
