/**
 * «Solicitudes»: quote requests sent to suppliers, and the three-step sheet
 * that prepares a new one (what we need → to whom → send from my e-mail).
 * Nothing is sent from here: each company gets a prepared e-mail with its
 * personal link that the user sends from their own mail program.
 */
import React, {useMemo, useState} from 'react';
import {mailtoHref} from '../../../../shared/logistics/contact-links.ts';
import {
  Button,
  Chip,
  DateField,
  EmptyState,
  Field,
  Icon,
  Select,
  Sheet,
  Textarea,
} from '../../ui';
import {
  CATEGORY_LABEL,
  EVENT,
  MOCK_TODAY,
  NEEDS,
  ORG_SHORT,
  SUPPLIERS,
  taxText,
  type CategoryId,
  type MockRequest,
} from '../data';
import {Glyph} from '../glyphs';
import {NumberStepper, SectionTitle, useNotify} from '../kit';

const RESOURCES: {
  id: string;
  label: string;
  category: CategoryId;
  unit: [string, string];
}[] = [
  {
    id: 'carpa66',
    label: 'Carpa 6 × 6 m',
    category: 'carpas',
    unit: ['carpa', 'carpas'],
  },
  {
    id: 'carpa33',
    label: 'Carpa 3 × 3 m',
    category: 'carpas',
    unit: ['carpa', 'carpas'],
  },
  {
    id: 'limpieza',
    label: 'Personal de limpieza',
    category: 'limpieza',
    unit: ['persona', 'personas'],
  },
  {
    id: 'castillo',
    label: 'Castillo hinchable',
    category: 'ocio',
    unit: ['castillo', 'castillos'],
  },
  {
    id: 'aseo',
    label: 'Aseo portátil',
    category: 'aseos',
    unit: ['cabina', 'cabinas'],
  },
];

export interface RequestPrefill {
  resourceId?: string;
  supplierIds?: string[];
  renewal?: string;
}

const STATE_TEXT: Record<MockRequest['recipients'][number]['state'], string> = {
  answered: 'Ha respondido',
  waiting: 'Esperando',
  declined: 'No puede',
  not_sent: 'Sin enviar',
};

const token = (id: string) =>
  `oxeye.example/p/${id.slice(2, 4).toUpperCase()}7q-${id.length}mW9-Lr4T`;

export const RequestSheet: React.FC<{
  open: boolean;
  prefill: RequestPrefill | null;
  onClose: () => void;
  onDone: (r: MockRequest) => void;
}> = ({open, prefill, onClose, onDone}) => {
  const notify = useNotify();
  const [step, setStep] = useState<1 | 2 | 3>(prefill?.supplierIds ? 2 : 1);
  const [resourceId, setResourceId] = useState(
    prefill?.resourceId ?? 'carpa66',
  );
  const [qty, setQty] = useState(3);
  const [days, setDays] = useState(4);
  const [from, setFrom] = useState(EVENT.from);
  const [to, setTo] = useState(EVENT.to);
  const [note, setNote] = useState(prefill?.renewal ?? '');
  const [chosen, setChosen] = useState<string[]>(prefill?.supplierIds ?? []);
  const [opened, setOpened] = useState<Record<string, 'opened' | 'sent'>>({});

  const resource = RESOURCES.find(r => r.id === resourceId) ?? RESOURCES[0];
  const companies = SUPPLIERS.filter(s =>
    s.categories.includes(resource.category),
  );
  const summary = `${qty} ${qty === 1 ? resource.unit[0] : resource.unit[1]} · ${resource.label.toLowerCase()} · ${days} ${days === 1 ? 'jornada' : 'jornadas'} · ${EVENT.dates}`;

  const subject = `Presupuesto · ${resource.label} · ${EVENT.dates}`;
  const mailBody = (supplierId: string) => {
    const s = SUPPLIERS.find(x => x.id === supplierId)!;
    return [
      `Hola, ${s.contact.split(' ')[0]}:`,
      '',
      `Desde el ${ORG_SHORT} te pedimos presupuesto para:`,
      `${summary} (${EVENT.venue}, ${EVENT.name}).`,
      note ? `\n${note}\n` : '',
      'Puedes responder desde el móvil en unos minutos, sin instalar nada:',
      `https://${token(supplierId)}`,
      '',
      'El enlace es personal y caduca el 4 dic.',
      'Gracias,',
      'Elvis',
    ].join('\n');
  };
  const mailFor = (supplierId: string) =>
    mailtoHref(
      SUPPLIERS.find(x => x.id === supplierId)?.email ?? '',
      subject,
      mailBody(supplierId),
    );

  const finish = () => {
    onDone({
      id: `r-${Date.now()}`,
      needId: NEEDS[0].id,
      event: EVENT.name,
      sentAt: 'Hoy, ahora',
      sentBy: 'Elvis',
      linkExpires: '4 dic',
      recipients: chosen.map(id => ({
        supplierId: id,
        state: opened[id] === 'sent' ? 'waiting' : 'not_sent',
      })),
    });
  };

  const titles = {
    1: '¿Qué necesitas?',
    2: '¿A quién se lo pides?',
    3: 'Revisa y envía',
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      id="mk-request-sheet"
      eyebrow={`Pedir presupuesto · paso ${step} de 3`}
      title={titles[step]}
      footer={
        <>
          {step > 1 ? (
            <Button
              icon="chevronLeft"
              onClick={() => setStep((step - 1) as 1 | 2)}
            >
              Atrás
            </Button>
          ) : (
            <Button onClick={onClose}>Cancelar</Button>
          )}
          <span className="lx-sheet__foot-spacer" />
          {step < 3 ? (
            <Button
              variant="primary"
              disabled={step === 2 && chosen.length === 0}
              onClick={() => setStep((step + 1) as 2 | 3)}
            >
              {step === 2
                ? `Preparar ${chosen.length || ''} ${chosen.length === 1 ? 'correo' : 'correos'}`.replace(
                    '  ',
                    ' ',
                  )
                : 'Siguiente'}
            </Button>
          ) : (
            <Button variant="primary" icon="check" onClick={finish}>
              Hecho
            </Button>
          )}
        </>
      }
    >
      <ol className="lx-mk-steps" aria-label="Pasos">
        {[1, 2, 3].map(n => (
          <li
            key={n}
            data-state={n < step ? 'done' : n === step ? 'now' : undefined}
          >
            <span className="lx-num">{n}</span>
            {['Necesidad', 'Empresas', 'Enviar'][n - 1]}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="lx-mk-stack">
          <fieldset className="lx-mk-choices lx-mk-choices--c2">
            <legend className="lx-mk-legend">Del catálogo</legend>
            {RESOURCES.map(r => (
              <span className="lx-mk-choice" key={r.id}>
                <input
                  type="radio"
                  name="rq-resource"
                  id={`rq-${r.id}`}
                  checked={resourceId === r.id}
                  onChange={() => {
                    setResourceId(r.id);
                    setChosen([]);
                  }}
                />
                <label htmlFor={`rq-${r.id}`}>
                  <span className="lx-mk-choice__icon" aria-hidden="true">
                    <Glyph name={r.category} size={22} />
                  </span>
                  <span className="lx-mk-choice__text">
                    <span className="lx-mk-choice__label">{r.label}</span>
                    <span className="lx-mk-choice__sub">
                      {CATEGORY_LABEL[r.category]}
                    </span>
                  </span>
                  <span className="lx-mk-choice__mark" aria-hidden="true">
                    <Icon name="check" size={16} />
                  </span>
                </label>
              </span>
            ))}
          </fieldset>
          <div className="lx-mk-row2">
            <NumberStepper
              id="rq-qty"
              label="Cantidad"
              value={qty}
              onChange={setQty}
              min={1}
              unit={qty === 1 ? resource.unit[0] : resource.unit[1]}
            />
            <NumberStepper
              id="rq-days"
              label="Jornadas"
              value={days}
              onChange={setDays}
              min={1}
            />
          </div>
          <div className="lx-mk-row2">
            <Field id="rq-from" label="Desde">
              <DateField
                id="rq-from"
                value={from}
                onChange={setFrom}
                today={MOCK_TODAY}
                clearable={false}
              />
            </Field>
            <Field id="rq-to" label="Hasta">
              <DateField
                id="rq-to"
                value={to}
                onChange={setTo}
                min={from}
                today={MOCK_TODAY}
                clearable={false}
              />
            </Field>
          </div>
          <Field id="rq-event" label="Evento">
            <Select id="rq-event" defaultValue="e1">
              <option value="e1">{EVENT.name}</option>
              <option value="e2">Sin evento (precio para el catálogo)</option>
            </Select>
          </Field>
          <Field
            id="rq-note"
            label="Nota para las empresas"
            optional
            hint="Aparece en el correo y arriba del formulario."
          >
            <Textarea
              id="rq-note"
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              aria-describedby="rq-note-hint"
            />
          </Field>
          <p className="lx-mk-preview lx-num" role="status">
            <Icon name="eye" size={16} /> El proveedor verá ya rellenado:{' '}
            <strong>{summary}</strong>
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="lx-mk-stack">
          <p className="lx-mk-preview lx-num">
            <Glyph name={resource.category} size={18} /> {summary}
          </p>
          <ul className="lx-mk-picklist" aria-label="Empresas">
            {companies.map(s => {
              const disabled = !s.email;
              const checked = chosen.includes(s.id);
              return (
                <li key={s.id}>
                  <span
                    className="lx-mk-check lx-mk-check--row"
                    data-disabled={disabled || undefined}
                  >
                    <input
                      type="checkbox"
                      id={`rq-s-${s.id}`}
                      checked={checked}
                      disabled={disabled}
                      onChange={() =>
                        setChosen(c =>
                          checked ? c.filter(x => x !== s.id) : [...c, s.id],
                        )
                      }
                    />
                    <label htmlFor={`rq-s-${s.id}`}>
                      <strong>{s.name}</strong>
                      <span>
                        {s.contact} · {taxText(s.tax)}
                        {s.lastOffer ? ` · ${s.lastOffer}` : ''}
                      </span>
                      {disabled && (
                        <span className="lx-mk-warn">
                          <Icon name="alert" size={14} /> Sin correo: añádelo en
                          Contactos o llama
                        </span>
                      )}
                    </label>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="lx-field__hint">
            Solo aparecen las empresas de{' '}
            {CATEGORY_LABEL[resource.category].toLowerCase()} de tus Contactos.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="lx-mk-stack">
          <p className="lx-notice">
            <Icon name="mail" size={18} />
            <span>
              Cada botón abre <strong>tu correo</strong> con el mensaje y el
              enlace personal ya escritos. Nada se envía hasta que tú pulses
              «Enviar» allí.
            </span>
          </p>
          <ul className="lx-mk-sendlist">
            {chosen.map(id => {
              const s = SUPPLIERS.find(x => x.id === id)!;
              const state = opened[id];
              return (
                <li key={id} className="lx-mk-sendrow" data-state={state}>
                  <div className="lx-mk-sendrow__who">
                    <strong>{s.name}</strong>
                    <span>{s.email}</span>
                    <code className="lx-mk-sendrow__link">{token(id)}</code>
                  </div>
                  <div className="lx-mk-sendrow__actions">
                    {state === 'opened' ? (
                      <>
                        <span className="lx-mk-sendrow__ask">
                          ¿Lo has enviado?
                        </span>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => setOpened(o => ({...o, [id]: 'sent'}))}
                        >
                          Sí
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            setOpened(o => {
                              const next = {...o};
                              delete next[id];
                              return next;
                            })
                          }
                        >
                          No
                        </Button>
                      </>
                    ) : state === 'sent' ? (
                      <Chip certainty="confirmed" size="sm">
                        Enviado por ti
                      </Chip>
                    ) : (
                      <>
                        <a
                          className="lx-btn lx-btn--primary lx-btn--sm"
                          href={mailFor(id)}
                          onClick={() =>
                            setOpened(o => ({...o, [id]: 'opened'}))
                          }
                        >
                          <Icon name="mail" size={16} />
                          <span className="lx-btn__label">
                            Enviar desde mi correo
                          </span>
                        </a>
                        <Button
                          size="sm"
                          icon="copy"
                          onClick={() => {
                            void navigator.clipboard
                              ?.writeText(`https://${token(id)}`)
                              .catch(() => undefined);
                            notify(
                              'Enlace copiado. Puedes pegarlo en WhatsApp.',
                            );
                          }}
                        >
                          Copiar enlace
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <details className="lx-disclosure">
            <summary>Ver el correo que se prepara</summary>
            <div className="lx-mk-mail">
              <p className="lx-mk-mail__subject">
                <span>Asunto</span> {subject}
              </p>
              <pre>{mailBody(chosen[0] ?? companies[0].id)}</pre>
            </div>
          </details>
        </div>
      )}
    </Sheet>
  );
};

export const RequestsView: React.FC<{
  requests: MockRequest[];
  onNew: () => void;
  onManual: () => void;
  onAnswers: () => void;
}> = ({requests, onNew, onManual, onAnswers}) => {
  const notify = useNotify();
  const needs = useMemo(() => new Map(NEEDS.map(n => [n.id, n])), []);
  return (
    <div className="lx-mk-view" id="mk-requests">
      <section className="lx-card lx-card--accent lx-mk-cta">
        <div>
          <h2 className="lx-card__title">Pide presupuesto en un minuto</h2>
          <p className="lx-mk-cta__text">
            Elige lo que necesitas del catálogo y a qué empresas. Cada una
            recibe un enlace personal con tu petición ya rellenada; responde
            desde el móvil y su propuesta llega a «Recibidas».
          </p>
        </div>
        <div className="lx-mk-cta__actions">
          <Button
            variant="primary"
            size="lg"
            icon="send"
            id="mk-new-request"
            onClick={onNew}
          >
            Pedir presupuesto
          </Button>
          <Button icon="edit" onClick={onManual}>
            Registrar una oferta a mano
          </Button>
        </div>
      </section>

      <SectionTitle count={requests.length}>Solicitudes enviadas</SectionTitle>
      {requests.length === 0 ? (
        <EmptyState icon="send" title="Aún no has pedido presupuestos">
          Cuando pidas uno, verás aquí quién ha respondido.
        </EmptyState>
      ) : (
        <ul className="lx-mk-cards">
          {requests.map(r => {
            const need = needs.get(r.needId)!;
            const answered = r.recipients.filter(
              x => x.state === 'answered',
            ).length;
            return (
              <li key={r.id} className="lx-card lx-mk-reqcard">
                <div className="lx-mk-reqcard__head">
                  <span className="lx-mk-reqcard__icon" aria-hidden="true">
                    <Glyph name={need.category} size={24} />
                  </span>
                  <div>
                    <h3 className="lx-mk-reqcard__title lx-num">
                      {need.label}
                    </h3>
                    <p className="lx-mk-reqcard__meta">
                      {r.event} · enviada {r.sentAt} por {r.sentBy}
                    </p>
                  </div>
                  <span
                    className="lx-mk-ratio lx-num"
                    aria-label={`${answered} de ${r.recipients.length} han respondido`}
                  >
                    {answered}/{r.recipients.length}
                  </span>
                </div>
                <ul className="lx-mk-recips">
                  {r.recipients.map(x => {
                    const s = SUPPLIERS.find(y => y.id === x.supplierId);
                    return (
                      <li key={x.supplierId} data-state={x.state}>
                        <span
                          className="lx-mk-recips__dot"
                          aria-hidden="true"
                        />
                        <span className="lx-mk-recips__name">{s?.name}</span>
                        <span className="lx-mk-recips__state">
                          {STATE_TEXT[x.state]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="lx-mk-reqcard__foot">
                  <span className="lx-mk-reqcard__expiry">
                    <Icon name="clock" size={15} /> Enlaces activos hasta el{' '}
                    {r.linkExpires}
                  </span>
                  <span className="lx-mk-reqcard__actions">
                    {r.recipients.some(x => x.state === 'waiting') && (
                      <Button
                        size="sm"
                        icon="bell"
                        onClick={() =>
                          notify(
                            'Maqueta: se abriría tu correo con un recordatorio para quien no ha respondido.',
                            'info',
                          )
                        }
                      >
                        Recordar
                      </Button>
                    )}
                    {answered > 0 && (
                      <Button size="sm" variant="primary" onClick={onAnswers}>
                        Ver respuestas
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
