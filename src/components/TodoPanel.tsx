import { useEffect, useRef, useState } from 'react';
import type { Lang, Quest } from '../types.ts';
import { nameOf } from '../data.ts';
import { sectionVar } from '../graph/theme.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;

interface Props {
  /** quests of the current dependency view that are ready to be picked up */
  todo: Quest[];
  /** everything that currently counts as finished, so struck rows can be dropped again */
  done: Set<number>;
  lang: Lang;
  t: T;
  /** select the quest (stays inside the dependency view) */
  onPick: (id: number) => void;
  /** tick it off — the app recomputes the list */
  onMark: (id: number) => void;
}

type Phase = 'todo' | 'struck' | 'leaving';

interface Row {
  id: number;
  phase: Phase;
  /** animate this row in: it showed up because something else was just finished */
  fresh: boolean;
}

/** Strike-through duration, then the time a row takes to slide out. */
const STRIKE_MS = 380;
const LEAVE_MS = 320;
/** Rows shown at once; a long chain can have a lot of open ends. */
const MAX_ROWS = 8;

/**
 * The "what is left to finish on this chain" list inside a dependency view.
 *
 * The animation follows the quests a tick *unlocked*, not the row that was clicked: when
 * the list gains a quest, that quest's own prerequisites are exactly what had to be
 * finished for it, so those are the rows that get struck through and pushed out — whether
 * they were ticked just now or several steps ago. That is what makes an "n prerequisites
 * unlock one" step read correctly, and it leaves an unrelated row that happened to be
 * struck earlier exactly where it is.
 *
 * Rows live here, in order, so a row does not jump around while it animates, and quest
 * data is remembered as it is seen because a finished quest leaves the list the app hands
 * down. The component stays mounted for as long as the view is open — otherwise the last
 * row of a chain would be unmounted before its strike-through could play.
 */
export function TodoPanel({ todo, done, lang, t, onPick, onMark }: Props) {
  const [rows, setRows] = useState<Row[]>(() => todo.slice(0, MAX_ROWS).map((q) => ({ id: q.id, phase: 'todo', fresh: false })));
  const timers = useRef<number[]>([]);
  const seen = useRef(new Map<number, Quest>());
  /** ids the list held before the last update, so "what is new" can be told apart */
  const previous = useRef(new Set(todo.map((q) => q.id)));
  /** the row the user just finished; only a tick can start the leaving animation */
  const clicked = useRef<number | null>(null);
  /** ids whose card has to leave once its strike-through has played */
  const leaving = useRef(new Set<number>());

  for (const q of todo) seen.current.set(q.id, q);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  useEffect(() => {
    const current = new Set(todo.map((q) => q.id));
    const opened = todo.filter((q) => !previous.current.has(q.id));
    previous.current = current;

    // Everything that had to be finished for the quests that just unlocked: those cards are
    // done, and they are the ones that leave.
    if (clicked.current != null && opened.length) {
      for (const q of opened) for (const p of [...q.prev, ...q.lock]) leaving.current.add(p);
    }

    setRows((prev) => {
      // A struck row is feedback for something that *is* finished; once that stops being
      // true (marks cleared, or a later un-tick cascaded through it) the row goes.
      const kept = prev.filter((row) => (current.has(row.id) || row.phase !== 'todo') && (row.phase === 'todo' || done.has(row.id)));
      const known = new Set(kept.map((row) => row.id));
      const added: Row[] = todo
        .filter((q) => !known.has(q.id))
        .slice(0, Math.max(0, MAX_ROWS - kept.length))
        .map((q) => ({ id: q.id, phase: 'todo', fresh: true }));
      const next = [...kept, ...added];
      const same = next.length === prev.length && next.every((row, i) => row === prev[i]);
      return same ? prev : next;
    });
  }, [todo, done]);

  const finish = (id: number) => {
    clicked.current = id;
    leaving.current = new Set();
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, phase: 'struck' } : row)));
    onMark(id);

    // The list the app hands back arrives within a frame or two, so by the time the line has
    // been drawn we know what this tick opened — and therefore which cards leave.
    timers.current.push(
      window.setTimeout(() => {
        clicked.current = null;
        const going = leaving.current;
        leaving.current = new Set();
        if (!going.size) return;
        setRows((prev) => prev.map((row) => (going.has(row.id) ? { ...row, phase: 'leaving' } : row)));
        timers.current.push(
          window.setTimeout(() => setRows((prev) => prev.filter((row) => row.phase !== 'leaving')), LEAVE_MS),
        );
      }, STRIKE_MS),
    );
  };

  if (!rows.length) return null;

  return (
    <div className="dep-next">
      <span className="dep-next-tag">{t('dep.todo', { n: todo.length })}</span>
      <ul className="dep-next-list">
        {rows.map((row) => {
          const q = seen.current.get(row.id);
          const label = q ? nameOf(q, lang) : `#${row.id}`;
          return (
            <li key={row.id} className={`dep-row ${row.phase}${row.fresh ? ' fresh' : ''}`}>
              <button type="button" className="dep-row-go" onClick={() => onPick(row.id)} title={q?.en ?? label}>
                <span className="chip-dot" style={{ background: q ? sectionVar(q.js) : 'var(--muted)' }} />
                <span className="dep-row-name">{label}</span>
                {q?.lv ? <span className="chip-lv">Lv.{q.lv}</span> : null}
              </button>
              {row.phase === 'todo' ? (
                <button type="button" className="dep-row-done" onClick={() => finish(row.id)}>
                  {t('dep.todoMark')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {todo.length > MAX_ROWS ? (
        <span className="dep-next-more">{t('dep.todoMore', { n: todo.length - MAX_ROWS })}</span>
      ) : null}
    </div>
  );
}
