import { Controls, Status, Viewport, Diagnostics, Results } from './Panels';
import type { ViewProps } from './Panels';
export function WorkstationStub(props: ViewProps) {
  return <><Controls {...props}/><Status {...props}/><Viewport {...props}/><Diagnostics {...props}/><Results {...props}/></>;
}
/** Alternate composition consumes the exact same props; switching never recreates the controller. */
export function CompactStub(props: ViewProps) {
  return <><Status {...props}/><div className="compact"><div><Controls {...props}/><Results {...props}/></div><div><Viewport {...props}/><Diagnostics {...props}/></div></div></>;
}
