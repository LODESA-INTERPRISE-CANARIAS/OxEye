import React, {useEffect, useRef, useState} from 'react';
import {VENUES} from '../../data/catalog';
import {useProjectStore} from '../../store/useProjectStore';
import type {ContactEntry} from '../../types';

/**
 * Modal dialog (`#contacts-dialog`) for managing provider contacts and generating mailto/WhatsApp inquiries.
 */
export const ContactsDialog: React.FC = () => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);

  const isOpen = activeModal === 'contacts';
  const scene = currentScene();
  const list = scene.contacts || [];

  const [name, setName] = useState('');
  const [kind, setKind] = useState<ContactEntry['kind']>('Foodtruck');
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

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const newEntry: ContactEntry = {
      name: name.trim(),
      kind,
      email: email.trim(),
      phone: phone.trim(),
    };
    updateScene((s) => {
      s.contacts = [...(s.contacts || []), newEntry];
    });
    setName('');
    setEmail('');
    setPhone('');
  };

  const handleDelete = (idx: number) => {
    updateScene((s) => {
      const next = [...(s.contacts || [])];
      next.splice(idx, 1);
      s.contacts = next;
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
          <label>
            Actividad
            <select
              name="kind"
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as ContactEntry['kind'])
              }
            >
              <option>Foodtruck</option>
              <option>Ventorrillo</option>
              <option>Taller</option>
              <option>Comercio</option>
              <option>Montaje</option>
            </select>
          </label>
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
          {list.map((c, i) => {
            const message = `Buenos días. Estamos estudiando la organización de ${scene.title} en ${VENUES[activeVenue].name}. Nos gustaría consultar su disponibilidad como ${c.kind}, presupuesto, necesidades de espacio y electricidad, capacidad de atención y horarios de montaje y retirada. Fechas y condiciones pendientes de concretar. Muchas gracias.`;
            return (
              <article key={i} className="note-card">
                <b>
                  {c.name} · {c.kind}
                </b>
                {c.email && (
                  <a
                    href={`mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent('Consulta de disponibilidad para evento')}&body=${encodeURIComponent(message)}`}
                  >
                    Preparar correo
                  </a>
                )}
                {c.phone && (
                  <a
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`}
                  >
                    Preparar WhatsApp
                  </a>
                )}
                <button type="button" onClick={() => handleDelete(i)}>
                  Eliminar
                </button>
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
