/** Name triple, always [Chinese, English, Japanese]. */
export type Trio = [string, string, string];

export const LANGS = ['cn', 'en', 'ja'] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_INDEX: Record<Lang, 0 | 1 | 2> = { cn: 0, en: 1, ja: 2 };

export interface QuestReward {
  exp: number;
  gil: number;
}

export interface LodeInfo {
  /** Lodestone Eorzea Database hash, e.g. "20ecde94d22" */
  h: string;
  /** starting-NPC map coordinates as shown in game / on the Lodestone */
  x: number | null;
  y: number | null;
}

export interface Quest {
  id: number;
  cn: string;
  en: string;
  ja: string;
  /** ExVersion row id (0 = ARR, 1 = HW, 2 = StB, 3 = ShB, 4 = EW, 5 = DT) */
  ex: number;
  /** release patch, e.g. "5.35" (empty for the newest few quests) */
  patch: string;
  /** required level */
  lv: number;
  lv2: number;
  /** ClassJobCategory row id — "职业" on the wiki */
  cjc: number;
  jobUnlock: number;
  /** JournalSection — the broad group (main scenario / sidequests / …) */
  js: number;
  /** JournalCategory — 主分类 */
  jcat: number;
  /** JournalGenre — 子分类 */
  jgen: number;
  /** PlaceName — 所属地区 */
  place: number;
  /** ENpcResident — 开始NPC */
  start: number;
  /** ENpcResident — 结束NPC */
  end: number;
  /** prerequisite quest ids */
  prev: number[];
  /** 1 = all prerequisites required, 2 = any one of them */
  prevJoin: number;
  /** extra quests that must be finished before this one unlocks */
  lock: number[];
  lockJoin: number;
  /** reverse edges, computed at build time */
  next: number[];
  rep: number;
  type: number;
  /**
   * EventIconType row id — the game's "which quest marker is this" value.
   * 3 = main scenario, 1 = sidequest, 8 / 10 = class & job, …
   */
  eit: number;
  sortKey: number;
  rw: QuestReward;
  lode: LodeInfo | null;
}

export interface QuestData {
  generatedAt: string;
  counts: { quests: number };
  dicts: {
    npc: Record<string, Trio>;
    place: Record<string, Trio>;
    jgen: Record<string, Trio>;
    jcat: Record<string, Trio>;
    js: Record<string, Trio>;
    cjc: Record<string, Trio>;
    ex: Record<string, Trio>;
  };
  quests: Quest[];
}

export interface Filters {
  ex: Set<number>;
  js: Set<number>;
  jcat: Set<number>;
  jgen: Set<number>;
  /** show QuestLock ("must also have finished") edges */
  showLocks: boolean;
}

export const emptyFilters = (): Filters => ({
  ex: new Set(),
  js: new Set(),
  jcat: new Set(),
  jgen: new Set(),
  showLocks: false,
});

export const isMainScenario = (q: Quest) => q.js === 0 || q.js === 1;
