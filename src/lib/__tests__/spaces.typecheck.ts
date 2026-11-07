import type { ImageLandmark, WorldLandmark } from '../schemas';
/** These assertions are checked by tsc, not Vitest; prevents accidental space interchange. */
export function verifyDistinctSpaces(image: ImageLandmark, world: WorldLandmark): void {
  // @ts-expect-error Image landmarks must not be assigned to world coordinates.
  const wrongWorld: WorldLandmark = image;
  // @ts-expect-error World landmarks must not be assigned to image coordinates.
  const wrongImage: ImageLandmark = world;
  void wrongWorld; void wrongImage;
}

import type { DisplayPixel, SourcePixel } from '../coordinates';
import { flexionDeg } from '../biomechanics';
export function verifyPixelSpaces(source:SourcePixel,display:DisplayPixel,image:ImageLandmark):void {
  // @ts-expect-error Display coordinates must be inverse-mapped before collision in source pixels.
  const wrongSource:SourcePixel=display;
  // @ts-expect-error Normalized image landmarks are not source pixels.
  const wrongPixel:SourcePixel=image;
  // @ts-expect-error Goniometry must use world landmarks, never normalized image coordinates.
  flexionDeg(image,image,image);
  void source;void wrongSource;void wrongPixel;
}
