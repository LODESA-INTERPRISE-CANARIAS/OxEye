/**
 * «Enviar…» for a work order, on the model of `contacts/ReachOut.tsx`: a
 * confirmation sheet that says what each way of sending will open, and
 * nothing opens until its own button is pressed. Focus lands on the sentence,
 * not on an action, so a stray Enter or double tap opens nothing.
 *
 * WhatsApp needs a phone with the country code; otherwise the sheet says why
 * instead of guessing. A long order does not fit in an e-mail or WhatsApp
 * link: the text is copied first (awaited) and only then the short link
 * opens; if the copy fails the link opens without claiming it was copied.
 */
import React from 'react';
import {phoneInfo} from '../../../shared/logistics/contact-links.ts';
import type {WorkOrder} from '../../../shared/logistics/work-order.ts';
import {formatDial, lowerFirst, whatsappBlock} from '../contacts/ReachOut';
import {canShareText, copyText} from '../lib/clipboard';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, Sheet} from '../ui';
import {orderMailto, orderWhatsapp, type OrderLink} from './text';

export const SendOrderSheet: React.FC<{
  order: WorkOrder;
  text: string;
  /** The recipient's phone and e-mail as the member sees them. */
  phone: string | null;
  email: string | null;
  onClose: () => void;
}> = ({order, text, phone, email, onClose}) => {
  const toast = useLogisticsStore(s => s.toast);
  const name = order.recipient.name;
  const info = phone ? phoneInfo(phone) : null;
  const wa = info ? orderWhatsapp(info, text) : null;
  const waHref = wa?.href ?? null;
  const mail = orderMailto(email, order.title, text);
  const nativeShare = canShareText(text);
  // Let the link's own navigation start before the sheet goes away.
  const done = () => window.setTimeout(onClose, 0);

  const copy = async (then?: string) => {
    const ok = await copyText(text);
    toast(
      ok
        ? (then ?? 'Texto de la orden copiado.')
        : 'No se ha podido copiar el texto. Usa «Imprimir o guardar como PDF».',
      ok ? 'success' : 'error',
    );
    return ok;
  };

  /**
   * A link too long to carry the order: copy the text first (awaited) and
   * only then open the short link that says it was copied. If the copy
   * fails, open the link without that claim and say so.
   */
  const openShort = async (
    e: React.MouseEvent<HTMLAnchorElement>,
    link: OrderLink,
    newTab: boolean,
  ) => {
    if (!link.short) {
      done();
      return;
    }
    e.preventDefault();
    const ok = await copyText(text);
    toast(
      ok
        ? 'Texto de la orden copiado: pégalo en el mensaje.'
        : 'No se ha podido copiar el texto: se abre sin él. Copia o imprime la orden desde aquí.',
      ok ? 'success' : 'error',
    );
    const url = ok ? link.href : link.plainHref;
    if (newTab) window.open(url, '_blank', 'noopener,noreferrer');
    else window.location.href = url;
    done();
  };

  const share = async () => {
    try {
      await navigator.share({title: order.title, text});
      onClose();
    } catch (err) {
      // Closing the share menu is not an error.
      if ((err as DOMException)?.name !== 'AbortError') {
        toast('No se ha podido abrir el menú de compartir.', 'error');
      }
    }
  };

  const waWhy = !phone
    ? 'No hay teléfono en la ficha.'
    : !info
      ? 'El teléfono de la ficha no parece un número.'
      : !waHref
        ? `WhatsApp no está disponible para ${info.display}: ${lowerFirst(whatsappBlock(info).long)}`
        : null;

  return (
    <Sheet
      open
      onClose={onClose}
      size="sm"
      className="lx-sheet--reach"
      role="alertdialog"
      id="lx-order-send-sheet"
      eyebrow="Antes de enviar"
      title={`Enviar la orden a ${name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} id="lx-order-send-cancel">
            Cancelar
          </Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            icon="copy"
            id="lx-order-send-copy"
            onClick={() => void copy()}
          >
            Copiar texto
          </Button>
        </>
      }
    >
      <div className="lx-sendorder">
        <p
          className="lx-reach-sheet__what"
          id="lx-order-send-what"
          tabIndex={-1}
          data-autofocus
        >
          Se enviará el texto de la orden ({order.items.length}{' '}
          {order.items.length === 1 ? 'tarea' : 'tareas'}). Elige cómo: no se
          abrirá nada hasta que pulses un botón.
        </p>

        <ul className="lx-sendorder__ways">
          <li className="lx-sendorder__way" id="lx-order-send-way-whatsapp">
            <span className="lx-sendorder__icon" aria-hidden="true">
              <Icon name="chat" size={20} />
            </span>
            <div className="lx-sendorder__text">
              <p className="lx-sendorder__name">WhatsApp</p>
              <p className="lx-muted" id="lx-order-send-whatsapp-what">
                {waHref && info ? (
                  <>
                    Se abrirá WhatsApp con{' '}
                    <strong className="lx-num">{formatDial(info)}</strong>
                    {wa?.short
                      ? '. La orden es larga para un enlace de WhatsApp: al pulsar se copiará el texto para que lo pegues.'
                      : ' y el texto de la orden.'}
                  </>
                ) : (
                  waWhy
                )}
              </p>
            </div>
            {wa && waHref ? (
              <a
                className="lx-btn lx-btn--primary lx-btn--sm"
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                id="lx-order-send-whatsapp"
                onClick={e => void openShort(e, wa, true)}
              >
                <span className="lx-btn__label">Abrir WhatsApp</span>
              </a>
            ) : (
              <Button
                size="sm"
                disabled
                id="lx-order-send-whatsapp"
                aria-describedby="lx-order-send-whatsapp-what"
              >
                Abrir WhatsApp
              </Button>
            )}
          </li>

          <li className="lx-sendorder__way" id="lx-order-send-way-mail">
            <span className="lx-sendorder__icon" aria-hidden="true">
              <Icon name="mail" size={20} />
            </span>
            <div className="lx-sendorder__text">
              <p className="lx-sendorder__name">Correo</p>
              <p className="lx-muted" id="lx-order-send-mail-what">
                Se abrirá tu programa de correo
                {email ? (
                  <>
                    {' '}
                    para escribir a <strong>{email}</strong>
                  </>
                ) : (
                  ' (la ficha no tiene correo: escribe tú la dirección)'
                )}
                , con el asunto «{order.title}»
                {mail.short
                  ? '. La orden es larga para un enlace de correo: al pulsar se copiará el texto para que lo pegues.'
                  : ' y el texto de la orden.'}
              </p>
            </div>
            <a
              className="lx-btn lx-btn--secondary lx-btn--sm"
              href={mail.href}
              id="lx-order-send-mail"
              onClick={e => void openShort(e, mail, false)}
            >
              <span className="lx-btn__label">Escribir correo</span>
            </a>
          </li>

          {nativeShare && (
            <li className="lx-sendorder__way" id="lx-order-send-way-share">
              <span className="lx-sendorder__icon" aria-hidden="true">
                <Icon name="share" size={20} />
              </span>
              <div className="lx-sendorder__text">
                <p className="lx-sendorder__name">Otra aplicación</p>
                <p className="lx-muted">
                  Abre el menú de compartir del dispositivo con el texto.
                </p>
              </div>
              <Button
                size="sm"
                id="lx-order-send-share"
                onClick={() => void share()}
              >
                Compartir…
              </Button>
            </li>
          )}
        </ul>

        <p className="lx-muted lx-reach-sheet__note" id="lx-order-send-pdf">
          <Icon name="print" size={14} /> Para adjuntar el PDF, guárdalo primero
          con «Imprimir o guardar como PDF».
        </p>
      </div>
    </Sheet>
  );
};
