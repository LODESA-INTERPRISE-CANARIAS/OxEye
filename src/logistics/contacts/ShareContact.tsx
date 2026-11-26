/**
 * «Compartir contacto»: the user ticks which fields go out (name and phone
 * by default), sees the exact text, then shares it with the phone's share
 * menu, copies it, or opens WhatsApp with it. Observations and descriptions
 * are never offered: they are the team's notes about a person.
 */
import React, {useMemo, useState} from 'react';
import type {Contact} from '../../../shared/logistics/contracts.ts';
import {
  CONTACT_SHARE_LABEL,
  contactShareText,
  DEFAULT_CONTACT_SHARE,
  shareableFields,
  type ContactShareField,
} from '../../../shared/logistics/contact-links.ts';
import {canShareText, copyText} from '../lib/clipboard';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, Sheet} from '../ui';

function fieldValue(c: Contact, f: ContactShareField): string {
  switch (f) {
    case 'name':
      return c.name;
    case 'role':
      return c.role ?? '';
    case 'company':
      return c.company?.name ?? '';
    case 'phone':
      return c.phone ?? '';
    case 'email':
      return c.email ?? '';
  }
}

export const ShareContactSheet: React.FC<{
  contact: Contact;
  onClose: () => void;
}> = ({contact, onClose}) => {
  const toast = useLogisticsStore(s => s.toast);
  const available = useMemo(() => shareableFields(contact), [contact]);
  const [chosen, setChosen] = useState<ContactShareField[]>(() =>
    DEFAULT_CONTACT_SHARE.filter(f => available.includes(f)),
  );
  const text = contactShareText(contact, chosen);
  const empty = chosen.length === 0;
  const nativeShare = canShareText(text || contact.name);

  const toggle = (f: ContactShareField, on: boolean) =>
    setChosen(list =>
      on
        ? available.filter(x => x === f || list.includes(x))
        : list.filter(x => x !== f),
    );

  const share = async () => {
    try {
      await navigator.share({text});
      onClose();
    } catch (err) {
      // Closing the share menu is not an error.
      if ((err as DOMException)?.name !== 'AbortError') {
        toast('No se ha podido abrir el menú de compartir.', 'error');
      }
    }
  };

  const copy = async () => {
    const ok = await copyText(text);
    toast(
      ok ? 'Ficha copiada' : 'No se ha podido copiar.',
      ok ? 'success' : 'error',
    );
  };

  const waHref = `https://wa.me/?text=${encodeURIComponent(text)}`;

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-share-sheet"
      eyebrow="Compartir contacto"
      title={contact.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} id="lx-share-cancel">
            Cancelar
          </Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            icon="copy"
            id="lx-share-copy"
            disabled={empty}
            onClick={() => void copy()}
          >
            Copiar
          </Button>
          {empty ? (
            <Button icon="chat" disabled id="lx-share-whatsapp">
              Enviar por WhatsApp
            </Button>
          ) : (
            <a
              className={`lx-btn ${nativeShare ? 'lx-btn--secondary' : 'lx-btn--primary'} lx-btn--md`}
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              id="lx-share-whatsapp"
            >
              <Icon name="chat" size={18} />
              <span className="lx-btn__label">Enviar por WhatsApp</span>
            </a>
          )}
          {nativeShare && (
            <Button
              variant="primary"
              icon="share"
              id="lx-share-native"
              disabled={empty}
              onClick={() => void share()}
            >
              Compartir
            </Button>
          )}
        </>
      }
    >
      <div className="lx-share">
        <fieldset className="lx-share__fields" id="lx-share-fields">
          <legend className="lx-field__label lx-segmented__legend">
            Qué datos se comparten
          </legend>
          <ul>
            {available.map(f => {
              const id = `lx-share-field-${f}`;
              return (
                <li key={f}>
                  <input
                    type="checkbox"
                    id={id}
                    checked={chosen.includes(f)}
                    data-autofocus={f === available[0] || undefined}
                    onChange={e => toggle(f, e.target.checked)}
                  />
                  <label htmlFor={id}>
                    <span className="lx-share__label">
                      {CONTACT_SHARE_LABEL[f]}
                    </span>
                    <span className="lx-share__value lx-num">
                      {fieldValue(contact, f)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <p className="lx-muted lx-share__note">
          <Icon name="lock" size={14} /> La descripción y las observaciones no
          se comparten nunca desde aquí.
        </p>
        <div className="lx-share__preview">
          <p className="lx-subtitle" id="lx-share-preview-title">
            Así se enviará
          </p>
          {empty ? (
            <p className="lx-muted" id="lx-share-preview">
              Elige al menos un dato.
            </p>
          ) : (
            <pre
              className="lx-share__text"
              id="lx-share-preview"
              aria-labelledby="lx-share-preview-title"
              aria-live="polite"
            >
              {text}
            </pre>
          )}
        </div>
      </div>
    </Sheet>
  );
};
