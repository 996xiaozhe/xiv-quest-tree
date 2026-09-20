import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang, Quest } from '../types.ts';
import { nameOf, searchQuests } from '../data.ts';
import { sectionVar } from '../graph/theme.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;

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
  const boxRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => (query.trim().length ? searchQuests(quests, query, lang, 40) : []), [quests, query, lang]);

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

  useEffect(() => setActive(0), [query]);

  const commit = (id: number) => {
    onPick(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="search" ref={boxRef}>
      <span className="search-icon" aria-hidden>
        ⌕
      </span>
      <input
        value={query}
        spellCheck={false}
        placeholder={t('search.placeholder')}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && results[active]) {
            commit(results[active].id);
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
          }}
          aria-label="clear"
        >
          ×
        </button>
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
                        {hidden ? <span className="shidden">filtered</span> : null}
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
