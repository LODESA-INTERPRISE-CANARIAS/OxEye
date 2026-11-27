/**
 * One request with the session token, for the account sheets: loading,
 * error with «Reintentar», and a reload after a change. Not cached.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {errorMessage} from '../api/client';
import {useLogisticsStore} from '../store/useLogisticsStore';

export type Loaded<T> =
  | {status: 'loading'; data: T | null}
  | {status: 'error'; data: T | null; message: string}
  | {status: 'ready'; data: T};

export function useLoad<T>(
  call: ((token: string) => Promise<T>) | null,
  key: string,
): Loaded<T> & {reload: () => void; set: (data: T) => void} {
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const [state, setState] = useState<Loaded<T>>({
    status: 'loading',
    data: null,
  });
  const [round, setRound] = useState(0);
  const callRef = useRef(call);
  useEffect(() => {
    callRef.current = call;
  });

  useEffect(() => {
    const run = callRef.current;
    if (!token || !run) return;
    let alive = true;
    setState(s => ({status: 'loading', data: s.data}));
    run(token).then(
      data => alive && setState({status: 'ready', data}),
      (err: unknown) =>
        alive &&
        setState(s => ({
          status: 'error',
          data: s.data,
          message: errorMessage(err),
        })),
    );
    return () => {
      alive = false;
    };
  }, [token, key, round]);

  const reload = useCallback(() => setRound(r => r + 1), []);
  const set = useCallback((data: T) => setState({status: 'ready', data}), []);
  return {...state, reload, set};
}
