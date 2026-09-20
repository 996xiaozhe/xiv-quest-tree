import { useEffect, useState } from 'react';
import { markerIconLocalUrl, markerIconUrl } from '../graph/icons.ts';

interface Props {
  /** icon id, e.g. 71221 */
  id: number;
  /** rendered size in CSS pixels, used for both width and height */
  size: number;
  className?: string;
}

/**
 * A quest-marker icon, loaded from the CDN mirror with this deployment's own copy as the
 * fallback — an `<img>` cannot try a second source by itself, so if the CDN is blocked
 * (or the icon is not published under the built commit) the error handler swaps in the
 * local file once.
 */
export function MarkerIcon({ id, size, className }: Props) {
  const [src, setSrc] = useState(() => markerIconUrl(id));

  // the hover card reuses this element for whatever is under the pointer
  useEffect(() => setSrc(markerIconUrl(id)), [id]);

  return (
    <img
      className={className}
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => {
        const local = markerIconLocalUrl(id);
        setSrc((current) => (current === local ? current : local));
      }}
    />
  );
}
