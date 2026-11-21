import React, {useEffect, useRef, useState} from 'react';
import {VENUES} from '../../data/catalog';
import {
  buildContactInquiryMessage,
  buildMailtoHref,
  buildWhatsAppHref,
  getContactKinds,
  mergeUniqueOptions,
  removeContactFromScene,
} from '../../engine/planning/contacts';
import {useProjectStore} from '../../store/useProjectStore';
import type {ContactEntry} from '../../types';
import {CustomizableSelect} from '../common/CustomizableSelect';

/**
 * Modal dialog (`#contacts-dialog`) for managing provider contacts and generating mailto/WhatsApp inquiries.
 */
export const ContactsDialog: React.FC = () => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const revision = useProjectStore((s) => s.revision);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);

  void revision;
  const isOpen = activeModal === 'contacts';
  const scene = currentScene();
  const venueName =
    currentMap().customLocation?.label || VENUES[activeVenue].name;
  const list = scene.contacts || [];
  const kinds = getContactKinds(scene);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('Foodtruck');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen]);

  const handleAddKind = (newKind: string) => {
    updateScene((s) => {
      s.contactKinds = mergeUniqueOptions(s.contactKinds || [], [newKind]);
    });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const newEntry: ContactEntry = {
      id: crypto.randomUUID(),
      name: trimmedName,
      kind: kind.trim() || 'Foodtruck',
      email: email.trim(),
      phone: phone.trim(),
    };
    updateScene((s) => {
      s.contacts = [...(s.contacts || []), newEntry];
      s.contactKinds = mergeUniqueOptions(s.contactKinds || [], [newEntry.kind]);
    });
    setName('');
    setEmail('');
    setPhone('');
  };

  const handleDelete = (contactId: string) => {
    updateScene((s) => {
      removeContactFromScene(s, contactId);
    });
  };

  return (
    <dialog
      id="contacts-dialog"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <div id="contacts-body">
        <h2>Contactos y solicitudes</h2>
        <p>
          Registra los proveedores que deseas consultar. Correo y WhatsApp abren
          un borrador para revisar.
        </p>
        <form id="contact-form" onSubmit={handleAdd}>
          <label>
            Nombre o empresa
            <input
              name="name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <CustomizableSelect
            id="contact-kind"
            name="kind"
            label="Actividad"
            options={kinds}
            value={kind}
            onChange={setKind}
            onAddOption={handleAddKind}
            placeholder="Ej. Sonido, Animación, Seguridad…"
          />
          <label>
            Email
            <input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            WhatsApp con prefijo internacional
            <input
              name="phone"
              placeholder="346…"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <button type="submit">Añadir contacto</button>
        </form>
        <div id="contact-list">
          {list.map((c) => {
            const message = buildContactInquiryMessage(
              c,
              scene.title,
              venueName
            );
            return (
              <article key={c.id} className="note-card">
                <b>
                  {c.name} · {c.kind}
                </b>
                <div className="contact-card-actions">
                  {c.email && (
                    <a href={buildMailtoHref(c.email, message)}>
                      Preparar correo
                    </a>
                  )}
                  {c.phone && (
                    <a
                      target="_blank"
                      rel="noopener noreferrer"
                      href={buildWhatsAppHref(c.phone, message)}
                    >
                      Preparar WhatsApp
                    </a>
                  )}
                  <button
                    type="button"
                    data-delete-contact={c.id}
                    onClick={() => handleDelete(c.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <form method="dialog">
        <button type="submit">Cerrar</button>
      </form>
    </dialog>
  );
};
