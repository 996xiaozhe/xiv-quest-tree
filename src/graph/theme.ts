/** FFXIV-flavoured palettes shared by the canvas renderer and the CSS UI. */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type Theme = 'night' | 'day';

export interface Palette {
  /** flat plot background — no gradient, the markers carry the visual interest */
  bg: string;
  edge: RGB;
  edgeLock: RGB;
  gold: RGB;
  fallback: RGB;
  sections: Record<number, RGB>;

  /* Canvas label colours. These have to be per-theme: light text that reads on the
     night background disappears completely on parchment. */
  labelHot: string;
  labelMain: string;
  labelOther: string;
  /** drawn behind the text so names stay readable over a dense cluster of nodes */
  labelHalo: string;

  /* Marker outlines. */
  selectRing: string;
  selectHalo: string;
  hoverRing: string;
  matchRing: string;
  highlightRing: string;
}

/** Night palette — the original look: deep navy, gold leaf, glowing markers. */
const NIGHT_SECTIONS: Record<number, RGB> = {
  0: { r: 233, g: 201, b: 125 }, // Main Scenario (ARR → EW)
  1: { r: 240, g: 214, b: 150 }, // Main Scenario (Dawntrail)
  2: { r: 186, g: 142, b: 226 }, // Chronicles of a New Era
  3: { r: 108, g: 199, b: 191 }, // Sidequests
  4: { r: 134, g: 196, b: 106 }, // Allied Society (ARR → EW)
  5: { r: 158, g: 208, b: 118 }, // Allied Society (Dawntrail)
  6: { r: 106, g: 166, b: 224 }, // Class & Job quests
  7: { r: 152, g: 163, b: 178 }, // Other
  8: { r: 205, g: 143, b: 110 }, // Levequests
  9: { r: 224, g: 122, b: 122 }, // Duty
};

/**
 * Day palette — the same hues sunk to ink-on-parchment: darker and more saturated so
 * every marker keeps its contrast against a light background.
 *
 * These values must stay in step with the `--sec-N` custom properties in styles.css;
 * tools/logic-test.mjs asserts that they do.
 */
const DAY_SECTIONS: Record<number, RGB> = {
  0: { r: 168, g: 128, b: 31 },
  1: { r: 192, g: 143, b: 40 },
  2: { r: 123, g: 79, b: 168 },
  3: { r: 26, g: 124, b: 118 },
  4: { r: 74, g: 130, b: 52 },
  5: { r: 95, g: 154, b: 66 },
  6: { r: 44, g: 104, b: 176 },
  7: { r: 110, g: 118, b: 132 },
  8: { r: 168, g: 100, b: 60 },
  9: { r: 186, g: 70, b: 70 },
};

export const PALETTES: Record<Theme, Palette> = {
  night: {
    bg: '#080b10',
    edge: { r: 96, g: 122, b: 154 },
    edgeLock: { r: 190, g: 138, b: 96 },
    gold: { r: 226, g: 196, b: 128 },
    fallback: { r: 152, g: 163, b: 178 },
    sections: NIGHT_SECTIONS,

    labelHot: 'rgba(255, 248, 232, 1)',
    labelMain: 'rgba(245, 230, 194, 0.97)',
    labelOther: 'rgba(222, 229, 238, 0.9)',
    labelHalo: 'rgba(0, 0, 0, 0.92)',

    selectRing: '#ffe7ad',
    selectHalo: 'rgba(255, 211, 130, 0.45)',
    hoverRing: 'rgba(255, 255, 255, 0.92)',
    matchRing: 'rgba(255, 240, 190, 0.98)',
    highlightRing: 'rgba(255, 226, 164, 0.62)',
  },
  day: {
    bg: '#efe8da',
    edge: { r: 106, g: 122, b: 144 },
    edgeLock: { r: 162, g: 112, b: 58 },
    gold: { r: 150, g: 110, b: 30 },
    fallback: { r: 122, g: 128, b: 140 },
    sections: DAY_SECTIONS,

    labelHot: 'rgba(24, 18, 6, 1)',
    labelMain: 'rgba(72, 50, 6, 0.98)',
    labelOther: 'rgba(46, 40, 30, 0.95)',
    labelHalo: 'rgba(255, 253, 246, 0.95)',

    selectRing: '#241a04',
    selectHalo: 'rgba(36, 26, 4, 0.38)',
    hoverRing: 'rgba(28, 22, 8, 0.92)',
    matchRing: 'rgba(110, 62, 4, 0.92)',
    highlightRing: 'rgba(104, 66, 8, 0.8)',
  },
};

export const paletteFor = (theme: Theme): Palette => PALETTES[theme] ?? PALETTES.night;

export const rgb = (c: RGB) => `rgb(${c.r},${c.g},${c.b})`;
export const rgba = (c: RGB, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

export const rgbToHex = (c: RGB): string =>
  '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * CSS reference to a section colour. The value lives in styles.css as `--sec-N`, so a
 * component can colour itself per theme without knowing which theme is active.
 */
export const sectionVar = (js: number): string => `var(--sec-${js in NIGHT_SECTIONS || js in DAY_SECTIONS ? js : 7})`;
