interface Props {
  title: string;
  message: string;
  /** 0–100, or null while the total size is unknown */
  progress: number | null;
  /** the animation only fades in once loading is actually slow enough to notice */
  revealed: boolean;
}

/**
 * Full-page boot screen. Kept deliberately quiet: on a cache hit the whole load takes
 * a few milliseconds and this never becomes visible, so it only appears when the
 * dataset genuinely has to be transferred (first visit, or after the data changed).
 */
export function BootScreen({ title, message, progress, revealed }: Props) {
  return (
    <div className={'boot' + (revealed ? ' boot-on' : '')} aria-busy={revealed} aria-live="polite">
      <div className="boot-mark" aria-hidden>
        <span />
      </div>
      <h1>{title}</h1>
      <p className="boot-msg">{message}</p>
      <div className={'boot-bar' + (progress == null ? ' boot-bar-indeterminate' : '')}>
        <span style={progress == null ? undefined : { width: `${progress}%` }} />
      </div>
      <p className="boot-pct">{progress == null ? '' : `${progress}%`}</p>
    </div>
  );
}
