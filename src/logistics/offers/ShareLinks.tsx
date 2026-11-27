/**
 * The personal links of a request, the one time they exist (Revisión 1 ·
 * E7). Ox Eye never writes to companies: each link goes out from the user's
 * own mail (a prepared e-mail), by copying it, or through the phone's share
 * menu (WhatsApp…) when the browser has one.
 *
 * The address shared is this Gestor's own (`shareableUrl`); a Gestor opened
 * as localhost warns that such a link only works on this computer.
 */
import React, {useState} from 'react';
import type {
  IssuedQuoteLink,
  QuoteNeed,
} from '../../../shared/logistics/contracts.ts';
import {utcToLocal} from '../../../shared/logistics/time.ts';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon} from '../ui';
import {
  dayYear,
  isLocalOnly,
  linkMessage,
  LOCAL_LINK_WARNING,
  mailtoHref,
  shareableUrl,
  type LinkMessage,
} from './format';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const canShare = () =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** The address to share for a link the server issued. */
export function urlToShare(serverUrl: string): string {
  return typeof window === 'undefined'
    ? serverUrl
    : shareableUrl(serverUrl, window.location);
}

/** «Solo funciona en este ordenador», when the Gestor runs as localhost. */
export const LocalLinkWarning: React.FC<{id?: string}> = ({id}) =>
  typeof window !== 'undefined' && isLocalOnly(window.location.hostname) ? (
    <p className="lx-notice lx-notice--error" role="note" id={id}>
      <Icon name="alert" size={18} />
      <span>{LOCAL_LINK_WARNING}</span>
    </p>
  ) : null;

export const ShareLinks: React.FC<{
  links: IssuedQuoteLink[];
  need: QuoteNeed;
  timeZone: string;
  idPrefix: string;
}> = ({links, need, timeZone, idPrefix}) => {
  const toast = useLogisticsStore(s => s.toast);
  const organization = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId)?.name ?? '',
  );
  const sender = useLogisticsStore(s => s.session?.user.displayName ?? '');
  const [done, setDone] = useState<Record<string, true>>({});
  const mark = (id: string) => setDone(d => ({...d, [id]: true}));

  const messageOf = (l: IssuedQuoteLink): LinkMessage => ({
    organization,
    sender,
    company: l.company.name,
    need,
    url: urlToShare(l.url),
    expiresOn: utcToLocal(l.expiresAt, timeZone).date,
  });

  return (
    <div className="lx-sharelinks" id={`${idPrefix}-links`}>
      <LocalLinkWarning id={`${idPrefix}-local`} />
      <p className="lx-notice lx-notice--quiet">
        <Icon name="mail" size={18} />
        <span>
          Ox Eye no envía correos a las empresas: el mensaje sale de tu correo o
          de tu móvil. <strong>Es la única vez que se ven los enlaces</strong>;
          si se pierde uno, renuévalo desde «Solicitudes».
        </span>
      </p>
      <ul className="lx-sharelinks__list">
        {links.map(l => {
          const msg = messageOf(l);
          return (
            <li
              key={l.linkId}
              className="lx-sharelink"
              data-link-id={l.linkId}
              data-shared={done[l.linkId] || undefined}
            >
              <div className="lx-sharelink__who">
                <strong>{l.company.name}</strong>
                <span className="lx-muted">
                  {l.company.email ?? 'Sin correo apuntado'} · sirve hasta el{' '}
                  <span className="lx-num">{dayYear(msg.expiresOn)}</span>
                </span>
                <code className="lx-sharelink__url" translate="no">
                  {msg.url}
                </code>
              </div>
              <div className="lx-sharelink__actions">
                <a
                  className={`lx-btn lx-btn--${l.company.email ? 'primary' : 'secondary'} lx-btn--sm`}
                  href={mailtoHref(l.company.email, msg)}
                  onClick={() => mark(l.linkId)}
                  data-action="mail"
                >
                  <Icon name="mail" size={16} />
                  <span className="lx-btn__label">Preparar correo</span>
                </a>
                <Button
                  size="sm"
                  icon="copy"
                  data-action="copy"
                  onClick={async () => {
                    const ok = await copyText(msg.url);
                    if (ok) mark(l.linkId);
                    toast(
                      ok
                        ? `Enlace de ${l.company.name} copiado`
                        : 'No se ha podido copiar: selecciona el enlace y cópialo a mano.',
                      ok ? 'success' : 'error',
                    );
                  }}
                >
                  Copiar enlace
                </Button>
                {canShare() && (
                  <Button
                    size="sm"
                    icon="share"
                    data-action="share"
                    onClick={async () => {
                      const {subject, body} = linkMessage(msg);
                      try {
                        await navigator.share({title: subject, text: body});
                        mark(l.linkId);
                      } catch {
                        // Cancelled by the user: nothing to say.
                      }
                    }}
                  >
                    Compartir
                  </Button>
                )}
              </div>
              {done[l.linkId] && (
                <p className="lx-sharelink__done">
                  <Icon name="check" size={15} /> Preparado
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
