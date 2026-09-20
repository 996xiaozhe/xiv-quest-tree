/**
 * Deep links into the Eorzea interactive map (map.wakingsands.com).
 *
 * The site's own parameter format is documented in its wiki
 * (thewakingsands/wakingsands.com → InteractiveMap):
 *
 *   https://map.wakingsands.com/#f=mark&id={Map id}&x={x}&y={y}
 *
 * `id` is a **Map** table row — not a Territory — and x/y are the displayed in-game
 * coordinates, the same numbers the game and the Lodestone print. Its loader converts
 * them back with `(x - 1) / (4100 / sizeFactor) * 2048`, which is exactly the space those
 * coordinates live in, so no conversion is needed on our side.
 */
export const MAP_BASE = 'https://map.wakingsands.com/';

/** A link that opens the map with a flag on (x, y). `mapId` 0 means "unknown". */
export function mapUrl(mapId: number, x: number, y: number): string | null {
  if (!(mapId > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return `${MAP_BASE}#f=mark&id=${mapId}&x=${x}&y=${y}`;
}
