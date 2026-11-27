/**
 * The main photo of a resource as a small square (lists, pickers), or its
 * category icon when it has none (Revisión 1 · E3). A photo still waiting on
 * this device shows its local preview. Stored photos are fetched only when
 * the square comes near the screen, so a long inventory does not download
 * every image at once. Decorative: the row next to it carries the name.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {Resource} from '../../../shared/logistics/contracts.ts';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Icon} from '../ui';
import {useMediaSrc} from './media-cache';
import {categoryIcon, mainMedia, queuedPhotos} from './media';

/** True once `ref` has come within `margin` of the viewport. */
export function useNearScreen(
  ref: React.RefObject<Element | null>,
  margin = '200px',
): boolean {
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );
  useEffect(() => {
    const el = ref.current;
    if (near || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      {rootMargin: margin},
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}

export const PhotoThumb: React.FC<{
  resource: Pick<Resource, 'id' | 'media'>;
  categoryName?: string | null;
  /** `xs` 36 px (pickers), `sm` 44 px (lists), `md` 56 px. */
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}> = ({resource, categoryName, size = 'sm', className}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearScreen(ref);
  const main = mainMedia(resource);
  const outbox = useLogisticsStore(s => s.outbox);
  const waiting = useMemo(
    () => (main ? null : (queuedPhotos(outbox, resource.id)[0] ?? null)),
    [main, outbox, resource.id],
  );
  const {src, state} = useMediaSrc(main?.id ?? null, near);
  const shown = src ?? waiting?.src ?? null;
  const [broken, setBroken] = useState<string | null>(null);
  const ok = shown && broken !== shown;

  return (
    <span
      ref={ref}
      className={[
        'lx-thumb',
        `lx-thumb--${size}`,
        ok ? 'has-photo' : '',
        main && state === 'loading' ? 'is-loading' : '',
        waiting ? 'is-waiting' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
      data-photo={ok ? (main ? 'stored' : 'waiting') : 'none'}
    >
      {ok ? (
        <img
          src={shown}
          alt=""
          draggable={false}
          onError={() => setBroken(shown)}
        />
      ) : (
        <Icon
          name={categoryIcon(categoryName)}
          size={size === 'md' ? 26 : size === 'xs' ? 18 : 20}
        />
      )}
    </span>
  );
};
