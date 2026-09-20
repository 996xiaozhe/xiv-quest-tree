import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang, Quest } from '../types.ts';
import { nameOf, searchQuests } from '../data.ts';
import { sectionVar } from '../graph/theme.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;

const HISTORY_KEY = 'xiv-quest-tree:recent-quests';
const HISTORY_MAX = 5;
/** Set once the first-visit pointer at the search field has been seen. */
const TIP_KEY = 'xiv-quest-tree:hint-search';

function tipSeen(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberTipSeen(): void {
  try {
    localStorage.setItem(TIP_KEY, '1');
  } catch {
    // storage unavailable: it is dismissed for this session at least
  }
}

/**
 * Recently opened quests, newest first.
 *
 * Ids, not the query text: what a visitor wants to get back to is the quest they opened,
 * and an id renders in whatever language the UI is in right now. Never throws — storage
 * can be unavailable (private mode).
 */
function loadHistory(): number[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(list: number[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // private mode / quota: the list still works for this session
  }
}

interface Props {
  quests: Quest[];
  visible: Set<number>;
  lang: Lang;
  t: T;
  onPick: (id: number) => void;
  onMatches: (ids: Set<number>) => void;
}

export function SearchBar({ quests, visible, lang, t, onPick, onMatches }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<number[]>(loadHistory);
  /** First visit only: a bubble under the field pointing out what it is for. */
  const [tip, setTip] = useState(() => !tipSeen());
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The badge shows the platform's own modifier, the way docs sites do it.
  const [modifier] = useState(() => (typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'));

  const results = useMemo(() => (query.trim().length ? searchQuests(quests, query, lang, 40) : []), [quests, query, lang]);

  // Ids that no longer exist (dataset rebuilt) simply drop out of the list.
  const recentQuests = useMemo(() => {
    const byId = new Map(quests.map((q) => [q.id, q]));
    return recent.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  }, [recent, quests]);

  const showingHistory = open && !query.trim() && recentQuests.length > 0;

  useEffect(() => {
    onMatches(new Set(results.map((q) => q.id)));
  }, [results, onMatches]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  /* Keyboard shortcut: ⌘K / Ctrl+K from anywhere, and a bare "/" as long as the user is
     not already typing in a field (where "/" is a character they meant to type). Both
     only move focus — the results appear as soon as there is a query. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = inputRef.current;
      if (!el) return;
      const isCmdK = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k';
      if (isCmdK) {
        e.preventDefault();
        el.focus();
        el.select();
        setOpen(true);
        return;
      }
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      el.focus();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setActive(0), [query]);

  const remember = (id: number) => {
    setRecent((prev) => {
      const next = [id, ...prev.filter((h) => h !== id)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  };

  const forget = (id: number) => {
    setRecent((prev) => {
      const next = prev.filter((h) => h !== id);
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    setRecent([]);
    saveHistory([]);
    inputRef.current?.focus();
  };

  /** Opens a quest: remember it, jump to it, and leave the field clean. */
  const commit = (id: number) => {
    remember(id);
    onPick(id);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  /** Puts the first-visit tip away and remembers that it has been seen. */
  const dismissTip = () => {
    setTip(false);
    rememberTipSeen();
  };

  const listLength = query.trim() ? results.length : recentQuests.length;

  return (
    <div className="search" ref={boxRef}>
      <span className="search-icon" aria-hidden>
        ⌕
      </span>
      <input
        ref={inputRef}
        value={query}
        spellCheck={false}
        placeholder={t('search.placeholder')}
        aria-keyshortcuts="Control+K Meta+K /"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          // using the field is the point of the tip, so it goes away for good
          dismissTip();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(listLength - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            if (query.trim() && results[active]) commit(results[active].id);
            else if (!query.trim() && recentQuests[active]) commit(recentQuests[active].id);
          }
        }}
      />
      {query ? (
        <button
          type="button"
          className="search-clear"
          onClick={() => {
            setQuery('');
            setOpen(false);
            inputRef.current?.focus();
          }}
          aria-label={t('search.clear')}
        >
          ×
        </button>
      ) : (
        <kbd className="search-kbd" title={t('search.shortcut')} aria-hidden>
          {modifier === '⌘' ? '⌘K' : 'Ctrl K'}
        </kbd>
      )}

      {tip && !query ? (
        <div className="search-tip" role="note">
          <button
            type="button"
            className="search-tip-x"
            onClick={dismissTip}
            aria-label={t('hint.close')}
            title={t('hint.close')}
          >
            ×
          </button>
          {t('search.tip')}
        </div>
      ) : null}

      {showingHistory ? (
        <div className="search-pop search-hist">
          <p className="search-count">
            <span>{t('search.recent')}</span>
            <button type="button" className="hist-clear" onClick={clearHistory}>
              {t('search.clearHistory')}
            </button>
          </p>
          <ul>
            {recentQuests.map((q, i) => (
              <li key={q.id} className="hist-row">
                <button
                  type="button"
                  className={'hist-go' + (i === active ? ' on' : '')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(q.id)}
                >
                  <span className="sdot" style={{ background: sectionVar(q.js) }} />
                  <span className="sname">{nameOf(q, lang)}</span>
                  <span className="salt">{lang === 'cn' ? q.en : q.cn}</span>
                  <span className="slv">{q.lv ? `Lv.${q.lv}` : ''}</span>
                </button>
                <button
                  type="button"
                  className="hist-x"
                  aria-label={t('search.removeHistory', { name: nameOf(q, lang) })}
                  onClick={() => forget(q.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {open && query.trim() ? (
        <div className="search-pop">
          {results.length === 0 ? (
            <p className="search-none">{t('search.empty')}</p>
          ) : (
            <>
              <p className="search-count">{t('search.results', { n: results.length })}</p>
              <ul>
                {results.map((q, i) => {
                  const hidden = !visible.has(q.id);
                  return (
                    <li key={q.id}>
                      <button
                        type="button"
                        className={i === active ? 'on' : ''}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => commit(q.id)}
                      >
                        <span className="sdot" style={{ background: sectionVar(q.js) }} />
                        <span className="sname">{nameOf(q, lang)}</span>
                        <span className="salt">{lang === 'cn' ? q.en : q.cn}</span>
                        <span className="slv">{q.lv ? `Lv.${q.lv}` : ''}</span>
                        {hidden ? <span className="shidden">{t('search.filtered')}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
