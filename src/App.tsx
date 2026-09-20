import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Filters, Lang, QuestData } from './types.ts';
import { LANGS, emptyFilters } from './types.ts';
import {
  applyFilters,
  availableQuests,
  buildTaxonomy,
  dependencyClosure,
  impliedDone,
  loadQuestData,
  nameOf,
  prerequisiteSet,
  toggleMarked,
  type DependencyView,
} from './data.ts';
import { LANG_SHORT, chooseLang, translate } from './i18n.ts';
import { GraphStage, type GraphHandle } from './components/GraphStage.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { QuestDetail } from './components/QuestDetail.tsx';
import { SearchBar } from './components/SearchBar.tsx';
import { BootScreen } from './components/BootScreen.tsx';
import { MarkerIcon } from './components/MarkerIcon.tsx';
import { TodoPanel } from './components/TodoPanel.tsx';
import {
  buildNameIndex,
  dependencyPath,
  parseLocation,
  resolveRoute,
  type Route,
} from './route.ts';
import { sectionVar } from './graph/theme.ts';
import { DEP_ANCHOR, DEP_COLUMNS } from './graph/camera.ts';
import type { Theme } from './graph/theme.ts';
import { ICON_JOB, ICON_MAIN, ICON_SIDE, markerIconForQuest } from './graph/icons.ts';

const LANG_KEY = 'xiv-quest-tree:lang';
const THEME_KEY = 'xiv-quest-tree:theme';
/** Explicitly ticked quests; everything they imply is derived from these. */
const DONE_KEY = 'xiv-quest-tree:done';
/** Set once the "mark quests to see what is left" hint has been dismissed. */
const HINT_KEY = 'xiv-quest-tree:hint-done';
/** Where the top-bar GitHub mark points. */
const REPO_URL = 'https://github.com/996xiaozhe/xiv-quest-tree';

interface FocusRequest {
  id: number;
  nonce: number;
  /** absolute zoom, when a fixed level is wanted */
  scale?: number;
  /** horizontal screen fraction the node should land on (0.5 = centred) */
  anchorX?: number;
  /** instead of `scale`, aim for this many quest columns across the stage */
  columns?: number;
}

/**
 * Saved choice first, then the browser's language list, then the `<html lang>` the
 * pre-paint script already resolved — and English when the visitor's language is not one
 * of the three the site speaks.
 */
function initialLang(): Lang {
  let saved: string | null = null;
  try {
    saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null;
  } catch {
    // private mode / disabled storage: fall through to detection
  }
  const browserLangs =
    typeof navigator !== 'undefined'
      ? navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
      : [];
  const htmlLang = typeof document !== 'undefined' ? document.documentElement.lang : null;
  return chooseLang({ saved, browserLangs, htmlLang });
}

/** Saved choice first, otherwise follow the OS setting. */
function initialTheme(): Theme {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  if (saved === 'day' || saved === 'night') return saved;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
}

/** Quest ids the player ticked off. Only the explicit ticks are stored — the implied
 *  prerequisites are derived, see `impliedDone`. */
function loadDone(): Set<number> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : []);
  } catch {
    return new Set();
  }
}

function saveDone(ids: Set<number>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...ids]));
  } catch {
    // private mode / quota: progress still works for this session
  }
}

/** True once the progress hint has been dismissed — it should not nag on every visit. */
function hintWasDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const [data, setData] = useState<QuestData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [bootVisible, setBootVisible] = useState(false);
  const [lang, setLang] = useState<Lang>(initialLang);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<number | null>(null);
  const [matches, setMatches] = useState<Set<number>>(new Set());
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [dependency, setDependency] = useState<DependencyView | null>(null);
  const [routeMiss, setRouteMiss] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [doneIds, setDoneIds] = useState<Set<number>>(loadDone);
  const [hintGone, setHintGone] = useState(hintWasDismissed);
  const graphRef = useRef<GraphHandle | null>(null);
  const nonceRef = useRef(0);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );

  useEffect(() => {
    // Only surface the boot animation once loading is slow enough to notice, so a
    // cache hit shows nothing at all instead of a flash.
    const revealTimer = setTimeout(() => setBootVisible(true), 180);
    let lastPct = -1;
    loadQuestData((ratio) => {
      const pct = Math.round(ratio * 100);
      if (pct >= lastPct + 2 || pct === 100) {
        lastPct = pct;
        setProgress(pct);
      }
    })
      .then((d) => {
        clearTimeout(revealTimer);
        setData(d);
      })
      .catch((e) => {
        clearTimeout(revealTimer);
        setError(String(e.message ?? e));
      });
    return () => clearTimeout(revealTimer);
  }, []);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang === 'cn' ? 'zh-Hans' : lang === 'ja' ? 'ja' : 'en';
    document.title =
      lang === 'cn' ? '最终幻想14 任务树' : lang === 'ja' ? 'FF14 クエストツリー' : 'FFXIV Quest Tree';
  }, [lang]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
    // keep the browser chrome (address bar, form controls) in step with the page
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'day' ? '#f7f3e9' : '#0a0d12');
  }, [theme]);

  // any click outside the context menu dismisses it
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const quests = data?.quests ?? [];

  const index = useMemo(() => {
    const m = new Map<number, (typeof quests)[number]>();
    for (const q of quests) m.set(q.id, q);
    return m;
  }, [quests]);

  const taxo = useMemo(() => (data ? buildTaxonomy(data, lang) : null), [data, lang]);

  /* ------------------------------------------------------------------ routing */
  const nameIndex = useMemo(() => buildNameIndex(quests), [quests]);

  /**
   * Camera request for entering a dependency view: the root is parked at the far end of
   * its chain and the zoom shows a handful of ranks around it, so the view opens on the
   * quest the user asked about instead of a fitted overview of the whole ancestry.
   */
  const depFocus = useCallback((id: number, dir: DependencyView['dir']) => {
    nonceRef.current += 1;
    setFocusRequest({
      id,
      nonce: nonceRef.current,
      anchorX: DEP_ANCHOR[dir],
      columns: DEP_COLUMNS,
    });
  }, []);

  /** Applies a URL route once the dataset is available. */
  const applyRoute = useCallback(
    (route: Route, animate: boolean) => {
      if (route.view === 'home') {
        setDependency(null);
        setRouteMiss(null);
        return;
      }
      const id = resolveRoute(route, nameIndex, index);
      if (id == null) {
        // stale or hand-edited link: fall back to the full graph and say so
        setDependency(null);
        setRouteMiss(route.name);
        return;
      }
      setRouteMiss(null);
      setDependency({ root: id, dir: route.dir });
      setSelected(id);
      if (animate) depFocus(id, route.dir);
    },
    [nameIndex, index, depFocus],
  );

  // deep link on first load (data must exist before a name can be resolved)
  const initialRouteDone = useRef(false);
  useEffect(() => {
    if (!data || initialRouteDone.current) return;
    initialRouteDone.current = true;
    applyRoute(parseLocation(window.location.pathname, window.location.search), true);
  }, [data, applyRoute]);

  // browser back / forward
  useEffect(() => {
    const onPop = () => applyRoute(parseLocation(window.location.pathname, window.location.search), true);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyRoute]);

  /** Everything the ticked quests imply: finishing one finishes its whole ancestry. */
  const done = useMemo(() => impliedDone(doneIds, index), [doneIds, index]);

  const visible = useMemo(() => {
    if (!data) return [];
    // The right-click dependency view deliberately overrides the sidebar filters, so
    // the ancestry it shows is never silently truncated.
    if (dependency) return dependencyClosure(index, dependency.root, dependency.dir, filters.showLocks);
    return applyFilters(data.quests, filters);
  }, [data, filters, dependency, index]);
  const visibleSet = useMemo(() => new Set(visible.map((q) => q.id)), [visible]);

  /**
   * What is left to do *inside the dependency view on screen*: quests of that view whose
   * requirements are all finished. Scoped to the view on purpose — asked of the whole
   * graph the same question answers with hundreds of side branches nobody is asking
   * about. Nothing is shown at all until the player marks something.
   */
  const todo = useMemo(
    () => (dependency && doneIds.size ? availableQuests(visible, done) : []),
    [dependency, doneIds, visible, done],
  );

  const edgeCount = useMemo(() => {
    let n = 0;
    for (const q of visible) for (const p of q.prev) if (visibleSet.has(p)) n++;
    return n;
  }, [visible, visibleSet]);

  const rankCount = useMemo(() => {
    if (!visible.length) return 0;
    let max = 0;
    const memo = new Map<number, number>();
    const visit = (id: number, guard: number): number => {
      if (guard > 1200) return 0;
      const got = memo.get(id);
      if (got !== undefined) return got;
      const q = index.get(id);
      if (!q) return 0;
      let r = 0;
      for (const p of q.prev) {
        if (!visibleSet.has(p)) continue;
        r = Math.max(r, visit(p, guard + 1) + 1);
      }
      memo.set(id, r);
      if (r > max) max = r;
      return r;
    };
    for (const q of visible) visit(q.id, 0);
    return max + 1;
  }, [visible, visibleSet, index]);

  // Selecting a quest emphasises the chain that LEADS TO it — prerequisites only,
  // never follow-ups.
  const highlight = useMemo(
    () => (dependency || selected == null ? null : prerequisiteSet(selected, index, 5)),
    [selected, index, dependency],
  );

  const jumpTo = useCallback(
    (id: number, scale = 0.95) => {
      setSelected(id);
      // Inside a /pre or /post view the chips in the detail panel are almost always part
      // of that ancestry, so clicking one moves the camera to it and stays in the view
      // the user is reading. Only a quest outside the view (a follow-up while looking at
      // prerequisites, say) leaves for the global graph.
      if (dependency && visibleSet.has(id)) {
        nonceRef.current += 1;
        // no scale: keep the zoom the view opened with, just centre the quest
        setFocusRequest({ id, nonce: nonceRef.current });
        return;
      }
      setDependency(null);
      if (!visibleSet.has(id)) setFilters(emptyFilters());
      nonceRef.current += 1;
      setFocusRequest({ id, nonce: nonceRef.current, scale });
    },
    [visibleSet, dependency],
  );

  /**
   * Ticks a quest off (or un-ticks it, which also un-ticks everything that depends on
   * it). Only the explicit ticks are stored — everything they imply is derived.
   */
  const toggleDone = useCallback(
    (id: number) => {
      setMenu(null);
      setDoneIds((prev) => {
        const next = toggleMarked(prev, id, index);
        saveDone(next);
        return next;
      });
    },
    [index],
  );

  const clearDone = useCallback(() => {
    setDoneIds(new Set());
    saveDone(new Set());
  }, []);

  /** Puts the "here is how progress works" hint away for good. */
  const dismissHint = useCallback(() => {
    setHintGone(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // storage unavailable: it is dismissed for this session at least
    }
  }, []);

  /**
   * Enters the dependency view. The address bar is deliberately left alone: the view
   * is reachable from /pre/<name> and /post/<name>, but browsing must not rewrite the
   * URL on every click (that would spam history and imply the address is shareable
   * when a name may be ambiguous). Sharing goes through the explicit copy button,
   * which builds a guaranteed-correct link.
   */
  const openDependency = useCallback(
    (root: number, dir: DependencyView['dir']) => {
      setMenu(null);
      setRouteMiss(null);
      setDependency({ root, dir });
      setSelected(root);
      depFocus(root, dir);
    },
    [depFocus],
  );

  const exitDependency = useCallback(() => setDependency(null), []);

  /** The shareable link for the view currently on screen, or null when there is none. */
  const shareUrl = useMemo(() => {
    if (!dependency) return null;
    const q = index.get(dependency.root);
    if (!q) return null;
    return new URL(dependencyPath(q, dependency.dir), window.location.origin).toString();
  }, [dependency, index]);

  const [copied, setCopied] = useState(false);
  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // clipboard API needs a secure context; fall back to a scratch textarea
      const el = document.createElement('textarea');
      el.value = shareUrl;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(el);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [shareUrl]);

  // Stable identities so the memoised panels do not re-render needlessly.
  const handleJump = useCallback((id: number) => jumpTo(id), [jumpTo]);
  const handleContextMenu = useCallback((id: number, x: number, y: number) => setMenu({ id, x, y }), []);

  const selectedQuest = selected != null ? index.get(selected) ?? null : null;
  const depRoot = dependency ? index.get(dependency.root) ?? null : null;

  if (error) {
    return (
      <div className="boot">
        <p className="boot-error">
          {translate(lang, 'app.loadError')} — {error}
        </p>
      </div>
    );
  }

  if (!data || !taxo) {
    return (
      <BootScreen
        title={translate(lang, 'app.title')}
        message={translate(lang, 'app.loading')}
        progress={progress}
        revealed={bootVisible}
      />
    );
  }

  // legend entries actually present in the current view
  const legendSections = taxo.js.filter((s) => visible.some((q) => q.js === s.id));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <h1>{t('app.title')}</h1>
        </div>

        <SearchBar
          quests={quests}
          visible={visibleSet}
          lang={lang}
          t={t}
          onPick={handleJump}
          onMatches={setMatches}
        />

        {/* Language, theme and the repository link are one cluster, so they sit closer to
            each other than the top bar's own 22px rhythm. */}
        <div className="topbar-tools">
          <div className="langs">
            {LANGS.map((l) => (
              <button key={l} type="button" className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>
                {LANG_SHORT[l]}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="theme-toggle"
            title={t(theme === 'day' ? 'theme.toNight' : 'theme.toDay')}
            aria-label={t(theme === 'day' ? 'theme.toNight' : 'theme.toDay')}
            aria-pressed={theme === 'day'}
            onClick={() => setTheme(theme === 'day' ? 'night' : 'day')}
          >
            {/* Drawn as SVG rather than a ☀/☾ glyph: the two glyphs come from different
                fonts at different optical sizes, so a text icon made the button (and the
                whole right-hand cluster) jump every time the theme flipped. */}
            <svg
              className="theme-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden
              focusable="false"
            >
              {theme === 'day' ? (
                <path d="M20.4 14.8A8.6 8.6 0 0 1 9.2 3.6a8.7 8.7 0 1 0 11.2 11.2Z" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="4.1" />
                  <path d="M12 2.7v2.6M12 18.7v2.6M2.7 12h2.6M18.7 12h2.6M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9" />
                </>
              )}
            </svg>
          </button>

          <a
            className="gh-link"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title={t('app.github')}
            aria-label={t('app.github')}
          >
            {/* The classic GitHub mark, as a path so it needs no icon font or image. */}
            <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden focusable="false">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
        </div>
      </header>

      <div className="body">
        <Sidebar
          taxo={taxo}
          t={t}
          filters={filters}
          setFilters={setFilters}
          totalCount={quests.length}
          visibleCount={visible.length}
        />

        <main className="stage-wrap">
          <GraphStage
            ref={graphRef}
            nodes={visible}
            index={index}
            selected={selected}
            onSelect={setSelected}
            onNodeContextMenu={handleContextMenu}
            highlight={highlight}
            matches={matches}
            langIndex={lang === 'cn' ? 0 : lang === 'en' ? 1 : 2}
            showLocks={filters.showLocks}
            done={done}
            theme={theme}
            t={t}
            focusRequest={focusRequest}
          />

          {/* Banner and the "ready to pick up" list share one stack, so they line up as
              one column and the list sits just under the banner. */}
          <div className="dep-stack">
            {dependency && depRoot ? (
              <div className="dep-banner">
                <span className="dep-tag">{t('dep.title')}</span>
                <strong>
                  {t(dependency.dir === 'prev' ? 'dep.prev' : 'dep.next', { name: nameOf(depRoot, lang) })}
                </strong>
                <span className="dep-count">{t('dep.count', { n: visible.length })}</span>
                <span className="dep-note">{t('dep.hint')}</span>
                <button type="button" className="dep-copy" onClick={copyShareUrl} title={shareUrl ?? undefined}>
                  {copied ? t('dep.copied') : t('dep.copy')}
                </button>
                <button type="button" onClick={exitDependency}>
                  {t('dep.exit')}
                </button>
              </div>
            ) : null}

            {/* Only once the player keeps track of progress, and only inside a view. An
                empty list takes the whole panel away rather than sitting there counting
                zero. */}
            {dependency && depRoot && todo.length ? (
              <TodoPanel
                key={`${dependency.root}:${dependency.dir}`}
                todo={todo}
                done={done}
                lang={lang}
                t={t}
                onPick={handleJump}
                onMark={toggleDone}
              />
            ) : null}

            {/* …and until a first quest is ticked, this is where the list would be: a
                one-off pointer at how to get one. */}
            {dependency && depRoot && !doneIds.size && !hintGone ? (
              <div className="dep-hint">
                <strong>{t('dep.hintTitle')}</strong>
                <span>{t('dep.hintBody')}</span>
                <button
                  type="button"
                  className="dep-hint-x"
                  onClick={dismissHint}
                  aria-label={t('dep.hintClose')}
                  title={t('dep.hintClose')}
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>

          {routeMiss ? (
            <div className="dep-banner dep-banner-miss">
              <span className="dep-tag">{t('route.tag')}</span>
              <strong>{t('route.notFound', { name: routeMiss })}</strong>
              <button type="button" onClick={() => setRouteMiss(null)}>
                {t('route.dismiss')}
              </button>
            </div>
          ) : null}

          <div className="stage-tools">
            <button type="button" title={t('view.zoomIn')} onClick={() => graphRef.current?.zoomBy(1.35)}>
              +
            </button>
            <button type="button" title={t('view.zoomOut')} onClick={() => graphRef.current?.zoomBy(1 / 1.35)}>
              −
            </button>
            <button type="button" className="wide" onClick={() => graphRef.current?.fit()}>
              {t('view.fit')}
            </button>
            <button type="button" className="wide" onClick={() => graphRef.current?.centerMain()}>
              {t('view.centerMain')}
            </button>
            <label className="tools-toggle" title={t('filter.showLocks')}>
              <input
                type="checkbox"
                checked={filters.showLocks}
                onChange={(e) => setFilters({ ...filters, showLocks: e.target.checked })}
              />
              <span>{t('view.showLocks')}</span>
            </label>
            {/* Progress tools only mean something once something has been ticked off. */}
            {doneIds.size ? (
              <button type="button" className="wide" title={t('done.clearHint')} onClick={clearDone}>
                {t('done.clear', { n: doneIds.size })}
              </button>
            ) : null}
          </div>

          <div className="stage-stats">
            <span>
              <b>{visible.length}</b> {t('stats.quests')}
            </span>
            <span>
              <b>{edgeCount}</b> {t('stats.links')}
            </span>
            <span>
              <b>{rankCount}</b> {t('stats.ranks')}
            </span>
            {doneIds.size ? (
              <span className="stats-done">
                <b>{doneIds.size}</b> {t('stats.done')}
              </span>
            ) : null}
            <span className="hint">{t('view.compass')}</span>
          </div>

          {legendSections.length ? (
            <div className="legend">
              <h4>{t('legend.title')}</h4>
              <ul>
                {legendSections.map((s) => (
                  <li key={s.id}>
                    <i style={{ background: sectionVar(s.id) }} />
                    {s.name}
                  </li>
                ))}
                <li className="legend-edge">
                  <i className="line" />
                  {t('legend.edge')}
                </li>
                {filters.showLocks ? (
                  <li className="legend-edge">
                    <i className="line dashed" />
                    {t('legend.edgeLock')}
                  </li>
                ) : null}
              </ul>
              {visible.length <= 50 ? (
                <>
                  <h4 className="legend-sub">{t('legend.markers')}</h4>
                  <ul>
                    {(
                      [
                        ['legend.markerMain', ICON_MAIN],
                        ['legend.markerSide', ICON_SIDE],
                        ['legend.markerJob', ICON_JOB],
                      ] as const
                    ).map(([key, id]) => (
                      <li key={key}>
                        <MarkerIcon className="legend-icon" id={id} size={18} />
                        {t(key)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {menu && index.get(menu.id) ? (
            <div
              className="ctx-menu"
              style={{ left: menu.x, top: menu.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="ctx-head">
                {visible.length <= 50 ? (
                  <MarkerIcon id={markerIconForQuest(index.get(menu.id)!)} size={20} />
                ) : null}
                <span>{nameOf(index.get(menu.id)!, lang)}</span>
              </div>
              <button type="button" onClick={() => openDependency(menu.id, 'prev')}>
                {t('menu.prereq')}
                <em>{index.get(menu.id)!.prev.length}</em>
              </button>
              <button type="button" onClick={() => openDependency(menu.id, 'next')}>
                {t('menu.next')}
                <em>{index.get(menu.id)!.next.length}</em>
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = menu.id;
                  setMenu(null);
                  setSelected(id);
                  nonceRef.current += 1;
                  setFocusRequest({ id, nonce: nonceRef.current, scale: 1.2 });
                }}
              >
                {t('menu.focus')}
              </button>
              <button
                type="button"
                className={done.has(menu.id) ? 'ctx-done on' : 'ctx-done'}
                onClick={() => toggleDone(menu.id)}
              >
                {done.has(menu.id) ? t('menu.unmarkDone') : t('menu.markDone')}
              </button>
            </div>
          ) : null}
        </main>

        <QuestDetail
          quest={selectedQuest}
          data={data}
          index={index}
          lang={lang}
          t={t}
          onJump={handleJump}
          onDependency={openDependency}
          done={selected != null && done.has(selected)}
          onToggleDone={toggleDone}
        />
      </div>
    </div>
  );
}
