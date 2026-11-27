/**
 * The warnings of one venue, opened from the badge in its column header. A
 * small panel under the badge (fixed, so the timeline's scrolling never cuts
 * it), with the same list as the day's warnings: each row opens its task.
 * Closes with Escape, the close button, a tap elsewhere or when the columns
 * scroll sideways; focus goes back to the badge.
 */
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import type {AcceptedWarning} from '../common/usePlan';
import {WarningList, warningsSummary} from '../common/WarningList';
import type {MoveRequest} from '../moves/useMoveFlow';
import {IconButton} from '../ui';
import {acceptedText} from './VenueHeader';

const GAP = 6;
const EDGE = 8;
const MAX_W = 380;

export const VenueWarnings: React.FC<{
  name: string;
  warnings: PlanWarning[];
  anchor: HTMLElement;
  tasksById: Map<string, Task>;
  onOpenTask: (task: Task) => void;
  /** A conflict exit (Revisión 1 · E2): opens the move preview. */
  onMove: (request: MoveRequest) => void;
  /** Accepted conflicts of the venue, listed apart. */
  accepted?: AcceptedWarning[];
  /** `restoreFocus`: put focus back on the badge (Escape, close button). */
  onClose: (restoreFocus: boolean) => void;
}> = ({
  name,
  warnings,
  anchor,
  tasksById,
  onOpenTask,
  onMove,
  accepted,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<React.CSSProperties>({visibility: 'hidden'});
  const conflicts = warnings.some(w => w.severity === 'conflict');

  // Under the badge, inside the window; above it when there is no room below.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(MAX_W, vw - 2 * EDGE);
      const left = Math.max(EDGE, Math.min(vw - width - EDGE, r.left - 12));
      const below = vh - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      const up = below < 180 && above > below;
      const maxHeight = Math.max(120, up ? above : below);
      setBox(
        up
          ? {left, width, maxHeight, bottom: vh - r.top + GAP}
          : {left, width, maxHeight, top: r.bottom + GAP},
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    ref.current?.focus({preventScroll: true});
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      className={`lx-tl-warnpop${conflicts ? ' has-conflict' : ''}`}
      role="dialog"
      aria-label={`Avisos de ${name}`}
      tabIndex={-1}
      style={box}
      id="lx-tl-warnpop"
    >
      <div className="lx-tl-warnpop__head">
        <div className="lx-tl-warnpop__title">
          <span className="lx-eyebrow">Avisos del lugar</span>
          <strong>{name}</strong>
          <span className="lx-tl-warnpop__summary lx-num">
            {warnings.length || !accepted?.length
              ? warningsSummary(warnings)
              : 'Sin avisos abiertos'}
            {accepted?.length ? ` · ${acceptedText(accepted.length)}` : ''}
          </span>
        </div>
        <IconButton
          icon="close"
          label="Cerrar los avisos"
          onClick={() => onClose(true)}
        />
      </div>
      <WarningList
        warnings={warnings}
        accepted={accepted}
        tasksById={tasksById}
        onOpenTask={task => {
          onClose(false);
          onOpenTask(task);
        }}
        onMove={request => {
          // The preview belongs to the timeline: it outlives this panel,
          // and focus comes back to the badge when it closes.
          onClose(true);
          onMove(request);
        }}
      />
      <p className="lx-tl-warnpop__note">
        Calculados a partir del plan: ayudan a revisar, no certifican nada.
      </p>
    </div>
  );
};
