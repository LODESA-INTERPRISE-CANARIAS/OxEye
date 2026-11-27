/**
 * «Pedir presupuesto» (Revisión 1 · E7): a concrete need (what, how many,
 * how many days, when) sent to one or more companies, each with its own
 * personal link that only opens this request and expires. After creating
 * it, the same sheet shows the links to share by hand (see ShareLinks).
 *
 * Opened from an offer («Renegociar»: the offer's company and a note about
 * the current price), from a category of the catalogue or from «Solicitudes».
 */
import React, {useMemo, useState} from 'react';
import type {
  QuoteRequestCreated,
  Uuid,
} from '../../../shared/logistics/contracts.ts';
import {
  MAX_NEED_DAYS,
  MAX_NEED_QUANTITY,
} from '../../../shared/logistics/offer-terms.ts';
import {
  QUOTE_LINK_DAYS_DEFAULT,
  QUOTE_MAX_COMPANIES,
  QUOTE_NOTE_MAX,
  QUOTE_TITLE_MAX,
  QUOTE_UNIT_MAX,
} from '../../../shared/logistics/proposals.ts';
import {addDays, daysBetween} from '../../../shared/logistics/time.ts';
import {LEAVES_OX_EYE_NOTE} from '../../../shared/logistics/work-order.ts';
import {errorMessage, isApiError} from '../api/client';
import {offersApi} from '../api/offers';
import {useActions} from '../common/actions';
import {serviceCategories} from '../lib/directory';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  DateField,
  Field,
  Icon,
  Input,
  MultiSelectField,
  Segmented,
  SelectField,
  Sheet,
  Textarea,
  describedBy,
} from '../ui';
import {openOrgId, sessionToken, storeRequest} from './data';
import {needText} from './format';
import {ShareLinks} from './ShareLinks';

export interface RequestPrefill {
  title?: string;
  categoryId?: Uuid | null;
  quantity?: number;
  unitLabel?: string | null;
  days?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  note?: string | null;
  companyIds?: Uuid[];
  /** The catalogue offer this request renegotiates. */
  offerId?: Uuid | null;
  eventId?: Uuid | null;
  /** Sheet title: «Renegociar» or «Pedir presupuesto». */
  renegotiate?: boolean;
}

interface Values {
  title: string;
  categoryId: string;
  quantity: string;
  unitLabel: string;
  days: string;
  hours: string;
  from: string;
  to: string;
  note: string;
  companyIds: string[];
  eventId: string;
  linkDays: '7' | '14' | '30';
}

type Errors = Partial<Record<keyof Values, string>>;

function wholeIn(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

function validate(v: Values): Errors {
  const e: Errors = {};
  if (!v.title.trim()) {
    e.title = 'Di qué necesitas, por ejemplo «3 carpas de 6 × 6 m».';
  } else if (v.title.trim().length > QUOTE_TITLE_MAX) {
    e.title = `Como mucho ${QUOTE_TITLE_MAX} caracteres.`;
  }
  if (wholeIn(v.quantity, 1, MAX_NEED_QUANTITY) === null) {
    e.quantity = `Un número entero entre 1 y ${MAX_NEED_QUANTITY.toLocaleString('es-ES')}.`;
  }
  if (wholeIn(v.days, 1, MAX_NEED_DAYS) === null) {
    e.days = `Un número entero entre 1 y ${MAX_NEED_DAYS}.`;
  }
  if (v.hours.trim() && wholeIn(v.hours, 1, 24) === null) {
    e.hours = 'Entre 1 y 24 horas, o déjalo vacío.';
  }
  if (v.unitLabel.trim().length > QUOTE_UNIT_MAX) {
    e.unitLabel = `Como mucho ${QUOTE_UNIT_MAX} caracteres.`;
  }
  if (v.from && v.to && v.to < v.from) {
    e.to = 'Tiene que ser después de «Desde».';
  }
  if (v.note.length > QUOTE_NOTE_MAX) {
    e.note = `Como mucho ${QUOTE_NOTE_MAX} caracteres.`;
  }
  if (!v.companyIds.length) e.companyIds = 'Elige al menos una empresa.';
  else if (v.companyIds.length > QUOTE_MAX_COMPANIES) {
    e.companyIds = `Como mucho ${QUOTE_MAX_COMPANIES} empresas por solicitud.`;
  }
  return e;
}

const FIELD_OF: Record<string, keyof Values> = {
  'need.title': 'title',
  'need.categoryId': 'categoryId',
  'need.quantity': 'quantity',
  'need.unitLabel': 'unitLabel',
  'need.days': 'days',
  'need.hoursPerDay': 'hours',
  'need.dateFrom': 'from',
  'need.dateTo': 'to',
  'need.note': 'note',
  companyIds: 'companyIds',
  eventId: 'eventId',
  linkDays: 'linkDays',
};

export const RequestSheet: React.FC<{
  prefill: RequestPrefill | null;
  onClose: () => void;
  /** After the links were created (e.g. to switch to «Solicitudes»). */
  onCreated?: (created: QuoteRequestCreated) => void;
}> = ({prefill, onClose, onCreated}) => {
  const {today, timeZone} = useActions();
  const companies = useLogisticsStore(s => s.companies);
  const categories = useLogisticsStore(s => s.categories);
  const events = useLogisticsStore(s => s.events);
  const toast = useLogisticsStore(s => s.toast);
  const [values, setValues] = useState<Values>(() => ({
    title: prefill?.title ?? '',
    categoryId: prefill?.categoryId ?? '',
    quantity: String(prefill?.quantity ?? 1),
    unitLabel: prefill?.unitLabel ?? '',
    days: String(prefill?.days ?? 1),
    hours: '',
    from: prefill?.dateFrom ?? '',
    to: prefill?.dateTo ?? '',
    note: prefill?.note ?? '',
    companyIds: prefill?.companyIds ?? [],
    eventId: prefill?.eventId ?? '',
    linkDays: String(QUOTE_LINK_DAYS_DEFAULT) as Values['linkDays'],
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<QuoteRequestCreated | null>(null);
  const [shared, setShared] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const set = (patch: Partial<Values>) => {
    setValues(v => ({...v, ...patch}));
    setErrors(e => {
      const next = {...e};
      for (const k of Object.keys(patch)) delete next[k as keyof Values];
      return next;
    });
  };

  const companyOptions = useMemo(
    () =>
      [...companies]
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .map(c => ({
          value: c.id,
          label: c.name,
          hint: c.email ?? 'Sin correo: se comparte copiando el enlace',
        })),
    [companies],
  );
  const categoryOptions = useMemo(
    () =>
      serviceCategories(categories).map(c => ({value: c.id, label: c.name})),
    [categories],
  );
  const eventOptions = useMemo(
    () =>
      events
        .filter(
          e => e.status !== 'cancelled' && (e.endDate ?? e.date ?? '') >= today,
        )
        .map(e => ({value: e.id, label: e.name, hint: e.date ?? undefined})),
    [events, today],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problems = validate(values);
    setErrors(problems);
    if (Object.keys(problems).length) {
      const first = Object.keys(problems)[0];
      document.getElementById(`lx-qr-${first}`)?.focus();
      return;
    }
    const token = sessionToken();
    const orgId = openOrgId();
    if (!token || !orgId) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await offersApi.createQuoteRequest(token, {
        organizationId: orgId,
        need: {
          title: values.title.trim(),
          categoryId: values.categoryId || null,
          quantity: Number(values.quantity),
          unitLabel: values.unitLabel.trim() || null,
          days: Number(values.days),
          hoursPerDay: values.hours.trim() ? Number(values.hours) : null,
          dateFrom: values.from || null,
          dateTo: values.from && values.to ? values.to : null,
          note: values.note.trim() || null,
        },
        eventId: values.eventId || null,
        offerId: prefill?.offerId ?? null,
        companyIds: values.companyIds,
        linkDays: Number(values.linkDays),
      });
      storeRequest(res.request);
      setCreated(res);
      onCreated?.(res);
      toast('Solicitud creada: comparte los enlaces', 'success');
    } catch (err) {
      if (isApiError(err) && err.fields) {
        const mapped: Errors = {};
        for (const [k, msg] of Object.entries(err.fields)) {
          const field = FIELD_OF[k] ?? (k.startsWith('need.') ? 'title' : null);
          if (field) mapped[field] = msg;
        }
        setErrors(mapped);
        if (!Object.keys(mapped).length) setFailure(errorMessage(err));
      } else {
        setFailure(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const title = prefill?.renegotiate ? 'Renegociar' : 'Pedir presupuesto';

  if (created) {
    // The links are shown only this once: closing with some not yet sent
    // asks first.
    const missing = created.links.length - shared;
    const requestClose = () => {
      if (missing > 0 && !leaving) setLeaving(true);
      else onClose();
    };
    return (
      <Sheet
        open
        onClose={requestClose}
        id="lx-request-sheet"
        eyebrow="Solicitud creada"
        title={created.request.need.title}
        meta={
          <span className="lx-sheet__sub lx-num">
            {needText(created.request.need)}
          </span>
        }
        footer={
          leaving && missing > 0 ? (
            <div
              className="lx-confirm-strip"
              role="alertdialog"
              aria-labelledby="lx-request-leave-text"
              id="lx-request-leave"
            >
              <p id="lx-request-leave-text">
                {missing === 1
                  ? 'Falta 1 enlace por preparar.'
                  : `Faltan ${missing} enlaces por preparar.`}{' '}
                No se vuelven a ver: después habría que renovarlos desde
                «Solicitudes».
              </p>
              <div className="lx-confirm-strip__actions">
                <Button
                  variant="primary"
                  id="lx-request-leave-keep"
                  onClick={() => setLeaving(false)}
                  autoFocus
                >
                  Seguir compartiendo
                </Button>
                <Button
                  variant="ghost"
                  id="lx-request-leave-confirm"
                  onClick={onClose}
                >
                  Cerrar igualmente
                </Button>
              </div>
            </div>
          ) : (
            <>
              <span className="lx-sheet__foot-spacer" />
              <Button
                variant="primary"
                id="lx-request-done"
                onClick={requestClose}
              >
                Hecho
              </Button>
            </>
          )
        }
      >
        <ShareLinks
          links={created.links}
          need={created.request.need}
          timeZone={timeZone}
          idPrefix="lx-request-created"
          onShared={setShared}
        />
      </Sheet>
    );
  }

  const err = (k: keyof Values) => errors[k];
  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-request-sheet"
      eyebrow={
        prefill?.renegotiate ? 'Pedir precio nuevo' : 'Solicitud de presupuesto'
      }
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            variant="primary"
            icon="send"
            type="submit"
            form="lx-request-form"
            id="lx-request-submit"
            busy={busy}
          >
            {values.companyIds.length > 1
              ? `Crear ${values.companyIds.length} enlaces`
              : 'Crear enlace'}
          </Button>
        </>
      }
    >
      <form
        id="lx-request-form"
        className="lx-form"
        noValidate
        onSubmit={submit}
      >
        {failure && (
          <p className="lx-notice lx-notice--error" role="alert">
            <Icon name="alert" size={18} />
            <span>{failure}</span>
          </p>
        )}
        <div className="lx-form__group">
          <p className="lx-form__group-title">Qué necesitas</p>
          <Field id="lx-qr-title" label="Necesidad" error={err('title')}>
            <Input
              id="lx-qr-title"
              value={values.title}
              maxLength={QUOTE_TITLE_MAX + 20}
              invalid={!!err('title')}
              aria-describedby={describedBy('lx-qr-title', {
                error: err('title'),
              })}
              placeholder="3 carpas de 6 × 6 m"
              onChange={e => set({title: e.target.value})}
            />
          </Field>
          <div className="lx-form__row lx-form__row--3">
            <Field id="lx-qr-quantity" label="Cantidad" error={err('quantity')}>
              <Input
                id="lx-qr-quantity"
                inputMode="numeric"
                className="lx-num"
                value={values.quantity}
                invalid={!!err('quantity')}
                aria-describedby={describedBy('lx-qr-quantity', {
                  error: err('quantity'),
                })}
                onChange={e => set({quantity: e.target.value})}
              />
            </Field>
            <Field
              id="lx-qr-unitLabel"
              label="Unidad"
              optional
              error={err('unitLabel')}
            >
              <Input
                id="lx-qr-unitLabel"
                value={values.unitLabel}
                placeholder="carpas"
                invalid={!!err('unitLabel')}
                onChange={e => set({unitLabel: e.target.value})}
              />
            </Field>
            <Field id="lx-qr-days" label="Jornadas" error={err('days')}>
              <Input
                id="lx-qr-days"
                inputMode="numeric"
                className="lx-num"
                value={values.days}
                invalid={!!err('days')}
                aria-describedby={describedBy('lx-qr-days', {
                  error: err('days'),
                })}
                onChange={e => set({days: e.target.value})}
              />
            </Field>
          </div>
          <div className="lx-form__row lx-form__row--3">
            <Field id="lx-qr-from" label="Desde" optional>
              <DateField
                id="lx-qr-from"
                value={values.from}
                today={today}
                timeZone={timeZone}
                onChange={v => {
                  const days = wholeIn(values.days, 1, MAX_NEED_DAYS) ?? 1;
                  set({from: v, to: v ? addDays(v, days - 1) : ''});
                }}
              />
            </Field>
            <Field id="lx-qr-to" label="Hasta" optional error={err('to')}>
              <DateField
                id="lx-qr-to"
                value={values.to}
                min={values.from || undefined}
                today={today}
                timeZone={timeZone}
                disabled={!values.from}
                invalid={!!err('to')}
                onChange={v => {
                  const patch: Partial<Values> = {to: v};
                  if (v && values.from && v >= values.from) {
                    patch.days = String(daysBetween(values.from, v) + 1);
                  }
                  set(patch);
                }}
              />
            </Field>
            <Field
              id="lx-qr-hours"
              label="Horas por jornada"
              optional
              error={err('hours')}
            >
              <Input
                id="lx-qr-hours"
                inputMode="numeric"
                className="lx-num"
                value={values.hours}
                invalid={!!err('hours')}
                onChange={e => set({hours: e.target.value})}
              />
            </Field>
          </div>
          <div className="lx-offers-row2">
            <Field id="lx-qr-categoryId" label="Categoría" optional>
              <SelectField
                id="lx-qr-categoryId"
                value={values.categoryId}
                emptyLabel="Sin categoría"
                options={categoryOptions}
                onChange={v => set({categoryId: v})}
              />
            </Field>
            <Field id="lx-qr-eventId" label="Para el evento" optional>
              <SelectField
                id="lx-qr-eventId"
                value={values.eventId}
                emptyLabel="Ninguno en concreto"
                options={eventOptions}
                onChange={v => {
                  const ev = events.find(x => x.id === v);
                  const patch: Partial<Values> = {eventId: v};
                  if (ev?.date && !values.from) {
                    patch.from = ev.date;
                    patch.to = ev.endDate ?? ev.date;
                    patch.days = String(
                      daysBetween(ev.date, ev.endDate ?? ev.date) + 1,
                    );
                  }
                  set(patch);
                }}
              />
            </Field>
          </div>
          <Field
            id="lx-qr-note"
            label="Mensaje para las empresas"
            optional
            hint={`Lo ven las empresas arriba del formulario. ${LEAVES_OX_EYE_NOTE}`}
            error={err('note')}
          >
            <Textarea
              id="lx-qr-note"
              rows={3}
              value={values.note}
              invalid={!!err('note')}
              aria-describedby={describedBy('lx-qr-note', {
                hint: true,
                error: err('note'),
              })}
              onChange={e => set({note: e.target.value})}
            />
          </Field>
        </div>

        <div className="lx-form__group">
          <p className="lx-form__group-title">A qué empresas</p>
          <Field
            id="lx-qr-companyIds"
            label="Empresas"
            hint="Cada una recibe su propio enlace: solo ve esta solicitud, nunca a las demás empresas."
            error={err('companyIds')}
          >
            <MultiSelectField
              id="lx-qr-companyIds"
              values={values.companyIds}
              options={companyOptions}
              noneLabel="Elige empresas"
              invalid={!!err('companyIds')}
              aria-describedby={describedBy('lx-qr-companyIds', {
                hint: true,
                error: err('companyIds'),
              })}
              onChange={ids => set({companyIds: ids})}
            />
          </Field>
          {companyOptions.length === 0 && (
            <p className="lx-muted">
              Aún no hay empresas en Contactos. Añádelas allí primero.
            </p>
          )}
          <Segmented<Values['linkDays']>
            name="lx-qr-linkDays"
            id="lx-qr-linkDays"
            legend="El enlace sirve durante"
            value={values.linkDays}
            options={[
              {value: '7', label: '7 días'},
              {value: '14', label: '14 días'},
              {value: '30', label: '30 días'},
            ]}
            onChange={v => v && set({linkDays: v})}
            help="Pasado ese plazo el enlace deja de abrir el formulario. Puedes crear otro desde «Solicitudes»."
          />
        </div>
      </form>
    </Sheet>
  );
};
