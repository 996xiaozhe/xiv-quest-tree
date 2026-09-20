import { memo, type ReactNode } from 'react';
import type { Lang, Quest, QuestData } from '../types.ts';
import { isMainScenario } from '../types.ts';
import { dictName, nameOf } from '../data.ts';
import { sectionVar } from '../graph/theme.ts';
import { markerIconForQuest, markerIconUrl } from '../graph/icons.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;

interface Props {
  quest: Quest | null;
  data: QuestData;
  index: Map<number, Quest>;
  lang: Lang;
  t: T;
  onJump: (id: number) => void;
  onDependency: (id: number, dir: 'prev' | 'next') => void;
}

const LODESTONE = 'https://eu.finalfantasyxiv.com/lodestone/playguide/db/quest/';
/** The Chinese FFXIV wiki files quests under the 任务 (quest) namespace. */
const WIKI = 'https://ff14.huijiwiki.com/wiki/';
const WIKI_NAMESPACE = '任务';

/**
 * Quest pages live at `任务:<name>`. The namespace separator stays a literal colon —
 * that is how MediaWiki links are written — so only the two parts are percent-encoded
 * (`%E4%BB%BB%E5%8A%A1:...`), and spaces become underscores as MediaWiki prefers.
 */
const wikiUrl = (name: string): string =>
  WIKI + encodeURIComponent(WIKI_NAMESPACE) + ':' + encodeURIComponent(name.trim().replace(/\s+/g, '_'));

function Chips({
  ids,
  index,
  lang,
  onJump,
  emptyLabel,
  tone,
}: {
  ids: number[];
  index: Map<number, Quest>;
  lang: Lang;
  onJump: (id: number) => void;
  emptyLabel: string;
  tone?: 'prev' | 'next' | 'lock';
}) {
  if (!ids.length) return <p className="muted small">{emptyLabel}</p>;
  return (
    <div className="chips">
      {ids.map((id) => {
        const q = index.get(id);
        if (!q) return null;
        return (
          <button key={id} type="button" className={`chip ${tone ?? ''}`} onClick={() => onJump(id)} title={q.en}>
            <span className="chip-dot" style={{ background: sectionVar(q.js) }} />
            <span className="chip-name">{nameOf(q, lang)}</span>
            {q.lv ? <span className="chip-lv">Lv.{q.lv}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export const QuestDetail = memo(function QuestDetail({ quest, data, index, lang, t, onJump, onDependency }: Props) {
  if (!quest) {
    return (
      <aside className="detail empty">
        <p>{t('panel.empty')}</p>
      </aside>
    );
  }

  const d = data.dicts;
  const row = (label: string, value: ReactNode) => (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  const current = nameOf(quest, lang);
  const altNames = ([
    ['中文', quest.cn],
    ['English', quest.en],
    ['日本語', quest.ja],
  ] as const).filter(([, n]) => n && n !== current);

  const prevLabel = quest.prev.length > 1 ? (quest.prevJoin === 2 ? t('panel.or') : t('panel.and')) : null;
  const startName = dictName(d.npc[String(quest.start)], lang);
  const endName = dictName(d.npc[String(quest.end)], lang);

  return (
    <aside className="detail">
      <div className="detail-head">
        <div className="detail-titles">
          <h2 style={{ borderColor: sectionVar(quest.js) }}>
            <img className="detail-icon" src={markerIconUrl(markerIconForQuest(quest))} alt="" width={28} height={28} />
            <span>{nameOf(quest, lang)}</span>
          </h2>
          <p className="detail-alt">
            {altNames.map(([label, n]) => (
              <span key={label}>
                <em>{label}</em>
                {n}
              </span>
            ))}
          </p>
        </div>
        <div className="detail-badges">
          {isMainScenario(quest) ? <span className="badge gold">{t('legend.main')}</span> : null}
          {quest.lv ? <span className="badge">{t('panel.levelShort', { n: quest.lv })}</span> : null}
          {quest.patch ? <span className="badge">v{quest.patch}</span> : null}
          {quest.rep ? <span className="badge">{t('panel.repeatable')}</span> : null}
        </div>
      </div>

      <div className="detail-scroll">
        <section>
          <h3>{t('panel.basic')}</h3>
          <dl className="kv-list">
            {quest.patch ? row(t('panel.patch'), <span>Patch {quest.patch}</span>) : null}
            {row(t('panel.expansion'), dictName(d.ex[String(quest.ex)], lang) || '—')}
            {row(t('panel.region'), dictName(d.place[String(quest.place)], lang) || '—')}
            {row(t('panel.section'), dictName(d.js[String(quest.js)], lang) || '—')}
            {row(
              t('panel.category'),
              <span className="hl">{dictName(d.jcat[String(quest.jcat)], lang) || '—'}</span>,
            )}
            {row(t('panel.genre'), <span className="hl">{dictName(d.jgen[String(quest.jgen)], lang) || '—'}</span>)}
            {row(t('panel.job'), dictName(d.cjc[String(quest.cjc)], lang) || '—')}
            {startName
              ? row(
                  t('panel.startNpc'),
                  <span>
                    {startName}
                    <span className="muted">
                      {' '}
                      · {dictName(d.place[String(quest.place)], lang)}
                      {quest.lode && quest.lode.x != null ? ` X:${quest.lode.x} Y:${quest.lode.y}` : ''}
                    </span>
                  </span>,
                )
              : null}
            {endName ? row(t('panel.endNpc'), <span>{endName}</span>) : null}
            {quest.rw.exp || quest.rw.gil
              ? row(
                  t('panel.rewards'),
                  <span>
                    {quest.rw.exp ? `${t('panel.exp')} ${quest.rw.exp.toLocaleString()}` : ''}
                    {quest.rw.exp && quest.rw.gil ? ' · ' : ''}
                    {quest.rw.gil ? `${t('panel.gil')} ${quest.rw.gil.toLocaleString()}` : ''}
                  </span>,
                )
              : null}
          </dl>
        </section>

        <section>
          <h3>
            {t('panel.prev')}
            {prevLabel ? <span className="h3-note">{prevLabel}</span> : null}
          </h3>
          <Chips ids={quest.prev} index={index} lang={lang} onJump={onJump} emptyLabel={t('panel.none')} tone="prev" />
        </section>

        <section>
          <h3>{t('panel.next')}</h3>
          <Chips ids={quest.next} index={index} lang={lang} onJump={onJump} emptyLabel={t('panel.none')} tone="next" />
        </section>

        {quest.lock.length ? (
          <section>
            <h3>
              {t('panel.lock')}
              <span className="h3-note">{quest.lockJoin === 2 ? t('panel.or') : t('panel.and')}</span>
            </h3>
            <Chips ids={quest.lock} index={index} lang={lang} onJump={onJump} emptyLabel={t('panel.none')} tone="lock" />
          </section>
        ) : null}

        <section>
          <h3>{t('panel.names')}</h3>
          <table className="names">
            <tbody>
              <tr>
                <th>中文</th>
                <td>{quest.cn || '—'}</td>
              </tr>
              <tr>
                <th>English</th>
                <td>{quest.en || '—'}</td>
              </tr>
              <tr>
                <th>日本語</th>
                <td>{quest.ja || '—'}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3>{t('panel.links')}</h3>
          <dl className="kv-list">
            {quest.lode ? (
              <div className="kv">
                <dt>{t('panel.lodestone')}</dt>
                <dd>
                  <a className="ext" href={`${LODESTONE}${quest.lode.h}/`} target="_blank" rel="noreferrer noopener">
                    {quest.en || quest.cn}
                  </a>
                </dd>
              </div>
            ) : null}
            <div className="kv">
              <dt>{t('panel.wiki')}</dt>
              <dd>
                <a className="ext" href={wikiUrl(quest.cn)} target="_blank" rel="noreferrer noopener">
                  {quest.cn}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <div className="detail-actions">
          <button type="button" className="primary" onClick={() => onDependency(quest.id, 'prev')}>
            {t('menu.prereq')}
          </button>
        </div>
      </div>
    </aside>
  );
});
