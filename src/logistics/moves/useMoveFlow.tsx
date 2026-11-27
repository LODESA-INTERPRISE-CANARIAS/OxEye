/**
 * Opens the move preview (Revisión 1 · E2) from wherever a move starts: a
 * calendar drag, its keyboard equivalent or a conflict exit. Each consumer
 * renders `element` next to its own content, so no screen-level wiring is
 * needed; the sheet is modal and sits in the top layer anyway.
 */
import React, {useCallback, useMemo, useRef, useState} from 'react';
import type {PlanWarning} from '../../../shared/logistics/conflicts.ts';
import type {MoveOrigin} from '../../../shared/logistics/contracts.ts';
import {MoveSheet} from './MoveSheet';

export type MoveRequest =
  /** Move one task by `minutes` (signed); its dependants follow if needed. */
  | {
      kind: 'move';
      taskId: string;
      minutes: number;
      origin: Exclude<MoveOrigin, 'undo'>;
      /** The warning that offered the exit (conflict_*). */
      warningKey?: string;
    }
  /** «Mantener ambas»: accept a conflict with a reason. */
  | {kind: 'keep'; warning: PlanWarning};

export interface MoveFlow {
  /** Opens the preview; `onClosed` runs when it closes (confirmed or not). */
  open: (request: MoveRequest, onClosed?: (confirmed: boolean) => void) => void;
  element: React.ReactNode;
}

export function useMoveFlow(): MoveFlow {
  const [request, setRequest] = useState<{
    value: MoveRequest;
    seq: number;
  } | null>(null);
  const onClosedRef = useRef<((confirmed: boolean) => void) | undefined>(
    undefined,
  );
  const seq = useRef(0);

  const open = useCallback(
    (value: MoveRequest, onClosed?: (confirmed: boolean) => void) => {
      onClosedRef.current = onClosed;
      seq.current += 1;
      setRequest({value, seq: seq.current});
    },
    [],
  );

  const close = useCallback((confirmed: boolean) => {
    setRequest(null);
    const cb = onClosedRef.current;
    onClosedRef.current = undefined;
    cb?.(confirmed);
  }, []);

  const element = useMemo(
    () =>
      request ? (
        <MoveSheet key={request.seq} request={request.value} onDone={close} />
      ) : null,
    [request, close],
  );

  return {open, element};
}
