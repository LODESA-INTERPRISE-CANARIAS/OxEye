/**
 * «Llamar», «WhatsApp», «Correo» for a person or a company.
 *
 * Nothing opens straight away: each action opens a confirmation sheet that
 * says exactly what will open («Se abrirá la llamada a +34 …») and repeats
 * the phone warning, if any. Only «Llamar ahora», «Abrir WhatsApp» or
 * «Escribir correo» follow the link. WhatsApp needs the country code; when it
 * is unknown the sheet says why instead of guessing. On a computer (fine
 * pointer, usually no phone line) «Copiar número» comes first.
 *
 * Guests never receive phones or e-mails (`restricted`): they see «Visible
 * para el equipo» and no actions.
 */
import React, {useState} from 'react';
import {
  mailtoHref,
  phoneInfo,
  telHref,
  whatsappHref,
  type PhoneInfo,
} from '../../../shared/logistics/contact-links.ts';
import {useMediaQuery} from '../common/useMediaQuery';
import {copyText} from '../lib/clipboard';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, Sheet, Withheld, type IconName} from '../ui';

export interface ReachTarget {
  name: string;
  phone: string | null;
  email: string | null;
  restricted: boolean;
}

type Channel = 'call' | 'whatsapp' | 'mail';

/** «+34 600 00 00 01» for Spanish numbers, «+44 2079460000» otherwise. */
export function formatDial(info: PhoneInfo): string {
  const d = info.international;
  if (!d) return info.dial;
  if (d.startsWith('34') && d.length === 11) {
    const n = d.slice(2);
    return `+34 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  }
  return `+${d}`;
}

/**
 * Why there is no WhatsApp link for this number: the missing country code
 * gets its own short wording; any other doubt (incomplete, «¿Falta el 34?»,
 * two numbers) is the phone's own warning; a short service number has none.
 */
function whatsappBlock(info: PhoneInfo): {short: string; long: string} {
  if (info.reason === 'unknown_country') {
    return {
      short: 'Falta el prefijo',
      long: 'necesita el número con el prefijo del país (por ejemplo +34).',
    };
  }
  if (info.warning) return {short: info.warning, long: info.warning};
  return {
    short: 'Número corto, sin WhatsApp',
    long: 'es un número corto de servicio, sin WhatsApp.',
  };
}

/** «El número…» → «el número…», «¿Falta…» → «¿falta…», to follow a colon. */
function lowerFirst(text: string): string {
  return text.replace(
    /^([¿¡]?)(\p{Lu})/u,
    (_, mark: string, letter: string) =>
      `${mark}${letter.toLocaleLowerCase('es-ES')}`,
  );
}

/** Whether this device probably has a phone line (touch screen). */
export function useCanCall(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/** Copies a number and says so. */
export function useCopyNumber() {
  const toast = useLogisticsStore(s => s.toast);
  return async (info: PhoneInfo) => {
    const text = formatDial(info);
    const ok = await copyText(text);
    toast(
      ok
        ? `Número copiado: ${text}`
        : 'No se ha podido copiar. Selecciona el número y cópialo a mano.',
      ok ? 'success' : 'error',
    );
  };
}

const CHANNEL_ICON: Record<Channel, IconName> = {
  call: 'phone',
  whatsapp: 'chat',
  mail: 'mail',
};

export const ReachOut: React.FC<{
  target: ReachTarget;
  /** Prefix for element ids (`lx-contact-reach`). */
  idPrefix: string;
  /** Small pills (task sheet, main contact) instead of big tiles. */
  compact?: boolean;
  /** Members: a way to fill in a missing phone or e-mail. */
  onAddMissing?: () => void;
}> = ({target, idPrefix, compact = false, onAddMissing}) => {
  const [channel, setChannel] = useState<Channel | null>(null);
  const canCall = useCanCall();
  const copyNumber = useCopyNumber();

  if (target.restricted) {
    return (
      <p className="lx-reach__withheld" id={`${idPrefix}-withheld`}>
        <Withheld>Teléfono y correo: visibles para el equipo</Withheld>
      </p>
    );
  }

  const info = target.phone ? phoneInfo(target.phone) : null;
  const email = target.email?.trim() || null;

  if (!info && !email) {
    if (compact) return null;
    return (
      <div className="lx-reach__none" id={`${idPrefix}-none`}>
        <span className="lx-pending">
          <span className="lx-chip__dot" aria-hidden="true" />
          Falta el teléfono y el correo: pendiente de verificar
        </span>
        {onAddMissing && (
          <Button size="sm" icon="edit" onClick={onAddMissing}>
            Añadirlos
          </Button>
        )}
      </div>
    );
  }

  const tiles: {
    channel: Channel | 'copy';
    label: string;
    sub: string;
    icon: IconName;
    muted?: boolean;
  }[] = [];
  if (info && !canCall) {
    tiles.push({
      channel: 'copy',
      label: 'Copiar número',
      sub: formatDial(info),
      icon: 'copy',
    });
  }
  if (info) {
    tiles.push({
      channel: 'call',
      label: 'Llamar',
      sub: canCall ? formatDial(info) : 'Desde este dispositivo',
      icon: 'phone',
    });
    // No WhatsApp link when the number is in doubt: say why on the tile.
    const wa = !!whatsappHref(info);
    tiles.push({
      channel: 'whatsapp',
      label: 'WhatsApp',
      sub: wa ? 'Abrir conversación' : whatsappBlock(info).short,
      icon: 'chat',
      muted: !wa,
    });
  }
  if (email) {
    tiles.push({channel: 'mail', label: 'Correo', sub: email, icon: 'mail'});
  }

  return (
    <>
      <div
        className={`lx-reach${compact ? ' lx-reach--compact' : ''}`}
        role="group"
        aria-label={`Contactar con ${target.name}`}
        id={idPrefix}
      >
        {tiles.map(t => (
          <button
            key={t.channel}
            type="button"
            id={`${idPrefix}-${t.channel}`}
            className={[
              'lx-reach__btn',
              t.channel === tiles[0].channel ? 'lx-reach__btn--lead' : '',
              t.muted ? 'lx-reach__btn--muted' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() =>
              t.channel === 'copy'
                ? info && void copyNumber(info)
                : setChannel(t.channel)
            }
          >
            <span className="lx-reach__icon" aria-hidden="true">
              <Icon name={t.icon} size={compact ? 18 : 24} />
            </span>
            <span className="lx-reach__text">
              <strong>{t.label}</strong>
              {!compact && (
                <span
                  className={`lx-reach__sub lx-num${t.muted ? ' lx-reach__sub--why' : ''}`}
                >
                  {t.sub}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      {channel && (
        <ReachOutSheet
          channel={channel}
          name={target.name}
          info={info}
          email={email}
          canCall={canCall}
          onCopy={() => info && void copyNumber(info)}
          onClose={() => setChannel(null)}
        />
      )}
    </>
  );
};

/** One round «Llamar» button for list rows; same confirmation sheet. */
export const QuickCall: React.FC<{target: ReachTarget; id?: string}> = ({
  target,
  id,
}) => {
  const [open, setOpen] = useState(false);
  const canCall = useCanCall();
  const copyNumber = useCopyNumber();
  const info =
    target.phone && !target.restricted ? phoneInfo(target.phone) : null;
  if (!info) return null;
  return (
    <>
      <button
        type="button"
        id={id}
        className="lx-iconbtn lx-iconbtn--secondary lx-quickcall"
        aria-label={`Llamar a ${target.name}`}
        title={`Llamar a ${target.name}`}
        onClick={() => setOpen(true)}
      >
        <Icon name="phone" size={19} />
      </button>
      {open && (
        <ReachOutSheet
          channel="call"
          name={target.name}
          info={info}
          email={null}
          canCall={canCall}
          onCopy={() => void copyNumber(info)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

const ReachOutSheet: React.FC<{
  channel: Channel;
  name: string;
  info: PhoneInfo | null;
  email: string | null;
  canCall: boolean;
  onCopy: () => void;
  onClose: () => void;
}> = ({channel, name, info, email, canCall, onCopy, onClose}) => {
  const number = info ? formatDial(info) : '';
  const waHref = info ? whatsappHref(info) : null;
  // Let the link's own navigation start before the sheet goes away.
  const done = () => window.setTimeout(onClose, 0);

  let title: string;
  let what: React.ReactNode;
  let go: React.ReactNode = null;
  if (channel === 'call' && info) {
    title = `Llamar a ${name}`;
    what = (
      <>
        Se abrirá la llamada a <strong className="lx-num">{number}</strong>.
      </>
    );
    go = (
      <a
        className={`lx-btn ${canCall ? 'lx-btn--primary' : 'lx-btn--secondary'} lx-btn--md`}
        href={telHref(info)}
        id="lx-reach-go"
        onClick={done}
      >
        <Icon name="phone" size={18} />
        <span className="lx-btn__label">Llamar ahora</span>
      </a>
    );
  } else if (channel === 'whatsapp' && info) {
    title = `WhatsApp con ${name}`;
    what = waHref ? (
      <>
        Se abrirá WhatsApp con una conversación con{' '}
        <strong className="lx-num">{number}</strong>.
      </>
    ) : (
      <>
        WhatsApp no está disponible para{' '}
        <strong className="lx-num">{info.display}</strong>:{' '}
        {lowerFirst(whatsappBlock(info).long)}{' '}
        {info.warning
          ? 'Corrígelo en la ficha o llama por teléfono.'
          : 'Llama por teléfono.'}
      </>
    );
    go = waHref && (
      <a
        className="lx-btn lx-btn--primary lx-btn--md"
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        id="lx-reach-go"
        onClick={done}
      >
        <Icon name="chat" size={18} />
        <span className="lx-btn__label">Abrir WhatsApp</span>
      </a>
    );
  } else {
    title = `Correo a ${name}`;
    what = (
      <>
        Se abrirá tu programa de correo para escribir a <strong>{email}</strong>
        .
      </>
    );
    go = email && (
      <a
        className="lx-btn lx-btn--primary lx-btn--md"
        href={mailtoHref(email)}
        id="lx-reach-go"
        onClick={done}
      >
        <Icon name="mail" size={18} />
        <span className="lx-btn__label">Escribir correo</span>
      </a>
    );
  }

  // The phone's own warning (incomplete number, unknown country) matters for
  // calls and WhatsApp; when it blocks WhatsApp it is already the main text.
  const warning =
    info?.warning && channel !== 'mail' && !(channel === 'whatsapp' && !waHref)
      ? info.warning
      : null;

  return (
    <Sheet
      open
      onClose={onClose}
      size="sm"
      className="lx-sheet--reach"
      role="alertdialog"
      id="lx-reach-sheet"
      eyebrow="Antes de abrir"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} id="lx-reach-cancel">
            {go ? 'Cancelar' : 'Cerrar'}
          </Button>
          <span className="lx-sheet__foot-spacer" />
          {info && channel !== 'mail' && (
            <Button
              icon="copy"
              variant={canCall || !go ? 'secondary' : 'primary'}
              id="lx-reach-copy"
              onClick={onCopy}
            >
              Copiar número
            </Button>
          )}
          {go}
        </>
      }
    >
      <div className="lx-reach-sheet">
        <span className="lx-reach-sheet__icon" aria-hidden="true">
          <Icon name={CHANNEL_ICON[channel]} size={26} />
        </span>
        {/* Focus lands on the sentence, not on the action: a stray Enter or
            double tap must not open anything. */}
        <p
          className="lx-reach-sheet__what"
          id="lx-reach-what"
          tabIndex={-1}
          data-autofocus
        >
          {what}
        </p>
        {warning && (
          <p className="lx-notice lx-notice--error" id="lx-reach-warning">
            <Icon name="alert" size={16} />
            {warning}
          </p>
        )}
        {channel === 'call' && !canCall && (
          <p className="lx-muted lx-reach-sheet__note">
            En un ordenador puede que no haya línea de teléfono: copia el número
            para marcarlo desde el móvil.
          </p>
        )}
        <p className="lx-muted lx-reach-sheet__note">
          No se abrirá nada hasta que pulses el botón.
        </p>
      </div>
    </Sheet>
  );
};
