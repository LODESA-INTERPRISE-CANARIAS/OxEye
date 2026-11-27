/**
 * A security log (Revisión 1 · E4): sign-ins, password changes, support
 * sessions… The server never sends passwords, tokens or addresses; the only
 * free text is the reason of a support session.
 */
import React from 'react';
import type {SecurityEvent} from '../../../shared/logistics/contracts.ts';
import {instantShort, relativeTime} from '../lib/format';
import {Icon} from '../ui';
import {SECURITY_ALERT, SECURITY_LABEL} from './access';
import {UserAvatar} from './UserAvatar';

export const SecurityList: React.FC<{
  items: SecurityEvent[];
  timeZone: string;
  /** Administration: say whose account each entry is about. */
  showUser?: boolean;
  id?: string;
  emptyText: string;
}> = ({items, timeZone, showUser = false, id, emptyText}) => {
  if (items.length === 0) {
    return (
      <p className="lx-muted" id={id ? `${id}-empty` : undefined}>
        {emptyText}
      </p>
    );
  }
  return (
    <ol className="lx-acct-log" id={id}>
      {items.map(e => {
        const alert = SECURITY_ALERT.has(e.kind);
        const by =
          e.actor && e.actor.id !== e.user.id ? e.actor.displayName : null;
        return (
          <li
            key={e.id}
            className="lx-acct-log__item"
            data-kind={e.kind}
            data-alert={alert || undefined}
          >
            {showUser ? (
              <UserAvatar
                name={e.user.displayName}
                userId={e.user.id}
                size="sm"
              />
            ) : (
              <span className="lx-acct-log__icon" aria-hidden="true">
                <Icon name={alert ? 'alert' : 'history'} size={16} />
              </span>
            )}
            <p className="lx-acct-log__text">
              <span>
                {showUser && <strong>{e.user.displayName}</strong>}
                {showUser && ' · '}
                {SECURITY_LABEL[e.kind] ?? e.kind}
                {by && <span className="lx-muted"> · por {by}</span>}
              </span>
              {e.detail && (
                <span className="lx-acct-log__detail">«{e.detail}»</span>
              )}
              {e.device && (
                <span className="lx-acct-log__device lx-muted">{e.device}</span>
              )}
            </p>
            <time
              className="lx-acct-log__time lx-num"
              dateTime={e.at}
              title={instantShort(e.at, timeZone)}
            >
              {relativeTime(e.at, timeZone)}
            </time>
          </li>
        );
      })}
    </ol>
  );
};
