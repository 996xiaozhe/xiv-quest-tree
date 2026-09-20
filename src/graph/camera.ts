/**
 * Pure camera math for the canvas stage.
 *
 * It lives outside the React component so the framing rules — especially the one that
 * frames a /pre or /post view around the quest the link points at — can be asserted in
 * the plain-Node test suite instead of only being observable by eye.
 */

import { DEFAULT_X_STEP } from './layout.ts';

/** Zoom limits: below the minimum a 5000-node graph is an unreadable dust cloud, above
 *  the maximum a single diamond fills the stage. */
export const MIN_SCALE = 0.006;
export const MAX_SCALE = 3.2;

/** Quest ranks always sit one x-step apart in world units; reusing the layout's value
 *  keeps the framing and the layout from drifting apart. */
export const COLUMN_STEP = DEFAULT_X_STEP;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The zoom that puts `columns` quest ranks across a stage `stageWidth` CSS pixels wide.
 *
 * A dependency view is framed by how much of the chain should stay legible ("about
 * eight quests"), not by a fixed scale: the same number would be a cramped overview on
 * a wide monitor and a disorienting close-up on a narrow one.
 */
export function scaleForColumns(stageWidth: number, columns: number, xStep: number = COLUMN_STEP): number {
  if (!(columns > 0) || !(stageWidth > 0)) return clampScale(1);
  return clampScale(stageWidth / (columns * xStep));
}

export interface FocusViewport {
  x: number;
  y: number;
  scale: number;
}

/**
 * Where the focused quest sits when a /pre or /post view opens.
 *
 * The layout always runs prerequisites → follow-ups left to right, so a prerequisite
 * view grows leftward and a follow-up view grows rightward. Anchoring the root at the
 * far end of its chain therefore leaves the whole stage width for the rest of it,
 * instead of parking the interesting half off screen.
 */
export const DEP_ANCHOR: Record<'prev' | 'next', number> = { prev: 0.72, next: 0.28 };

/** How many quest ranks stay in frame on entry: a readable local window, not the whole
 *  ancestry — the user pans from there. */
export const DEP_COLUMNS = 8;

/**
 * The viewport that renders the world point `p` at `anchorX` of the stage width
 * (0 = flush left, 0.5 = centred, 1 = flush right), vertically centred on its own y.
 *
 * `anchorX` is what keeps the interesting half of a dependency chain on screen: a
 * prerequisite view grows leftward, so its root is parked near the right edge, and a
 * follow-up view — which grows rightward — parks it near the left edge.
 */
export function focusViewport(
  p: { x: number; y: number },
  stageWidth: number,
  scale: number,
  anchorX = 0.5,
): FocusViewport {
  const s = clampScale(scale);
  return { x: p.x - (anchorX - 0.5) * (stageWidth / s), y: p.y, scale: s };
}
