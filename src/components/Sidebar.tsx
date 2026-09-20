import { memo, useMemo, useState } from 'react';
import type { Filters } from '../types.ts';
import type { TaxoEntry, Taxonomy } from '../data.ts';
import { sectionVar } from '../graph/theme.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;

interface Props {
  taxo: Taxonomy;
  t: T;
  filters: Filters;
  setFilters: (f: Filters) => void;
  totalCount: number;
  visibleCount: number;
}

const toggle = (src: Set<number>, id: number): Set<number> => {
  const next = new Set(src);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/**
 * Section names carry an expansion list in brackets — "友好部族任务1（重生/苍穹/…）" —
 * which is far too long for a chip. Drop the bracket and normalise the full-width
 * parentheses Wikimedia data uses.
 */
const presetLabel = (name: string): string =>
  name.replace(/[（(][^）)]*[）)]/g, '').trim() || name;

interface ListProps {
  title: string;
  items: TaxoEntry[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onClear: () => void;
  t: T;
  colorFor?: (e: TaxoEntry) => string | undefined;
  emptyHint?: string;
}

function FilterList({ title, items, selected, onToggle, onClear, t, colorFor, emptyHint }: ListProps) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((e) => e.name.toLowerCase().includes(q) || String(e.id) === q) : items;
  }, [items, query]);

  return (
    <section className="fgroup">
      <header className="fgroup-head">
        <h3>{title}</h3>
        {selected.size > 0 ? (
          <button type="button" className="link-btn" onClick={onClear}>
            {t('filter.clearGroup')}
          </button>
        ) : null}
      </header>
      {items.length > 12 ? (
        <input
          className="fgroup-search"
          value={query}
          placeholder={t('filter.searchCategory')}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      ) : null}
      <div className="fgroup-list">
        {shown.length === 0 ? <p className="fgroup-empty">{emptyHint ?? t('search.empty')}</p> : null}
        {shown.map((e) => {
          const on = selected.has(e.id);
          const color = colorFor?.(e);
          return (
            <label key={e.id} className={'fitem' + (on ? ' on' : '')}>
              <input type="checkbox" checked={on} onChange={() => onToggle(e.id)} />
              <span className="fitem-box" style={color && !on ? { borderColor: color } : undefined} />
              <span className="fitem-name" title={e.name}>
                {e.name}
              </span>
              <span className="fitem-count">{e.count}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

export const Sidebar = memo(function Sidebar({ taxo, t, filters, setFilters, totalCount, visibleCount }: Props) {
  const patch = (p: Partial<Filters>) => setFilters({ ...filters, ...p });

  const categories = useMemo(() => {
    if (!filters.js.size) return taxo.jcat;
    return taxo.jcat.filter((c) => filters.js.has(c.parent ?? -1));
  }, [taxo.jcat, filters.js]);

  const genres = useMemo(() => {
    if (filters.jcat.size) return taxo.jgen.filter((g) => filters.jcat.has(g.parent ?? -1));
    if (filters.js.size) {
      const allowed = new Set(categories.map((c) => c.id));
      return taxo.jgen.filter((g) => allowed.has(g.parent ?? -1));
    }
    return taxo.jgen;
  }, [taxo.jgen, filters.jcat, filters.js, categories]);

  const sectionColor = (e: TaxoEntry) => sectionVar(e.id);

  const preset = (js: number[]) => {
    setFilters({
      ...filters,
      js: new Set(js),
      jcat: new Set(),
      jgen: new Set(),
    });
  };

  const anyFilter =
    filters.js.size > 0 || filters.jcat.size > 0 || filters.jgen.size > 0 || filters.ex.size > 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h2>{t('filter.title')}</h2>
        <span className="sidebar-count">
          {visibleCount} / {totalCount}
        </span>
      </div>

      <div className="presets">
        <button type="button" className={!anyFilter ? 'preset on' : 'preset'} onClick={() => setFilters({ ...filters, js: new Set(), jcat: new Set(), jgen: new Set() })}>
          {t('filter.all')}
        </button>
        <button type="button" className="preset" onClick={() => preset([0, 1])} style={{ borderColor: sectionVar(0) }}>
          {t('preset.main')}
        </button>
        {taxo.js
          .filter((s) => s.id >= 2)
          .map((s) => (
            <button
              key={s.id}
              type="button"
              className="preset"
              style={{ borderColor: sectionVar(s.id) }}
              onClick={() => preset([s.id])}
            >
              {presetLabel(s.name)}
            </button>
          ))}
      </div>

      <div className="sidebar-scroll">
        <FilterList
          title={t('filter.expansion')}
          items={taxo.ex}
          selected={filters.ex}
          onToggle={(id) => patch({ ex: toggle(filters.ex, id) })}
          onClear={() => patch({ ex: new Set() })}
          t={t}
        />
        <FilterList
          title={t('filter.section')}
          items={taxo.js}
          selected={filters.js}
          onToggle={(id) => patch({ js: toggle(filters.js, id), jcat: new Set(), jgen: new Set() })}
          onClear={() => patch({ js: new Set(), jcat: new Set(), jgen: new Set() })}
          t={t}
          colorFor={sectionColor}
        />
        <FilterList
          title={t('filter.category')}
          items={categories}
          selected={filters.jcat}
          onToggle={(id) => patch({ jcat: toggle(filters.jcat, id), jgen: new Set() })}
          onClear={() => patch({ jcat: new Set(), jgen: new Set() })}
          t={t}
        />
        <FilterList
          title={t('filter.genre')}
          items={genres}
          selected={filters.jgen}
          onToggle={(id) => patch({ jgen: toggle(filters.jgen, id) })}
          onClear={() => patch({ jgen: new Set() })}
          t={t}
        />
      </div>

      {/* Always rendered: appearing/disappearing would resize the group area above it
          and make the whole panel jump. It just goes inert when there is nothing to clear. */}
      <button
        type="button"
        className="clear-all"
        disabled={!anyFilter}
        onClick={() => setFilters({ ...filters, ex: new Set(), js: new Set(), jcat: new Set(), jgen: new Set() })}
      >
        {t('filter.clear')}
      </button>
    </aside>
  );
});
