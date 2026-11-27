/**
 * Who is acting in the current request, for writes that sign rows deep in
 * the services (the activity log) without every caller passing it along.
 *
 * `createApp` runs each request inside `withRequestUser`, reading the session
 * user the auth middleware sets. During a support session (an administrator
 * acting on someone else's account) `supportByFor` names that administrator,
 * so the activity row is signed «Dailos (soporte: Elvis)» instead of passing
 * for the owner's own change.
 *
 * Outside a request (seed, CLI, tests calling services directly) there is no
 * session: nothing is attributed to support.
 */
import {AsyncLocalStorage} from 'node:async_hooks';
import type {SessionUser} from '../../../shared/logistics/contracts.ts';

const acting = new AsyncLocalStorage<() => SessionUser | undefined>();

/** Runs `fn` with `read` as the way to find the request's session user. */
export function withRequestUser<T>(
  read: () => SessionUser | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return acting.run(read, fn);
}

/** The administrator behind this user's support session, if any. */
export function supportByOf(user: SessionUser | undefined): string | null {
  return user?.support?.kind === 'support' ? user.support.by.id : null;
}

/**
 * The administrator behind the current request's support session, when the
 * row is signed by that session's account (`userId`); null otherwise.
 */
export function supportByFor(userId: string): string | null {
  const user = acting.getStore()?.();
  return user && user.id === userId ? supportByOf(user) : null;
}
