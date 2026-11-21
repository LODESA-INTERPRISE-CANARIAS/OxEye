import React, {useEffect, useRef, useState} from 'react';
import {VENUES} from '../../data/catalog';
import {downloadFile} from '../../db/repository';
import {
  ACTIVITY_NEED_LABELS,
  buildContactInquiryMessage,
  buildMailtoHref,
  buildWhatsAppHref,
  getActivityCategories,
  getContactKinds,
  mergeUniqueOptions,
} from '../../engine/planning/contacts';
import {
  activities,
  type ActivitySpec,
  planProgramme,
  providers,
  type ScheduledSession,
} from '../../engine/planning/programme';
import {useProjectStore} from '../../store/useProjectStore';
import type {
  ActivityNeed,
  ContactEntry,
  CustomActivityItem,
} from '../../types';
import {CustomizableSelect} from '../common/CustomizableSelect';

const NEW_CONTACT_SENTINEL = '__new_contact__';

const clock = (min: number): string =>
  String(Math.floor(min / 60)).padStart(2, '0') +
  ':' +
  String(min % 60).padStart(2, '0');

const hourOf = (v: string): number => {
  const parts = v.split(':');
  return Number(parts[0] || 0) + Number(parts[1] || 0) / 60;
};

interface CustomActivityDraft {
  id: string | null;
  name: string;
  category: string;
  minutes: number;
  cost: number;
  places: number;
  area: number;
  need: ActivityNeed;
}

const emptyCustomDraft = (defaultCategory: string): CustomActivityDraft => ({
  id: null,
  name: '',
  category: defaultCategory,
  minutes: 60,
  cost: 150,
  places: 20,
  area: 15,
  need: 'open',
});

/**
 * Modal dialog (`#programme-dialog`) for scheduling multi-day event activities within a budget,
 * creating/editing custom activities, linking saved contacts, and consulting providers.
 */
export const ProgrammeDialog: React.FC = () => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const revision = useProjectStore((s) => s.revision);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  void revision;
  const isOpen = activeModal === 'programme';
  const s = currentScene();
  const venueName =
    currentMap().customLocation?.label || VENUES[activeVenue].name;
  const savedContacts = s.contacts || [];
  const contactById = new Map(savedContacts.map((c) => [c.id, c]));
  const contactKinds = getContactKinds(s);

  const [budget, setBudget] = useState(3000);
  const [reserve, setReserve] = useState(20);
  const [sessions, setSessions] = useState(2);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('14:00');
  const [area, setArea] = useState(60);
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<ActivitySpec[]>([]);
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [planResult, setPlanResult] = useState<{
    schedule: ScheduledSession[];
    pending: Array<{day: number; reason: string}>;
    spent: number;
    reserved: number;
    unspent: number;
    assumptions: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Formulario de creación / edición de actividad propia
  const [activityFormOpen, setActivityFormOpen] = useState(false);
  const [activityFormError, setActivityFormError] = useState('');
  const [draftActivity, setDraftActivity] = useState<CustomActivityDraft>(() =>
    emptyCustomDraft('Taller')
  );

  // Formulario mínimo en línea para crear un contacto nuevo desde una actividad
  const [inlineContactActivityId, setInlineContactActivityId] = useState<
    string | null
  >(null);
  const [inlineContactName, setInlineContactName] = useState('');
  const [inlineContactKind, setInlineContactKind] = useState('Taller');
  const [inlineContactEmail, setInlineContactEmail] = useState('');
  const [inlineContactPhone, setInlineContactPhone] = useState('');
  const [inlineContactError, setInlineContactError] = useState('');

  const availableCategories = mergeUniqueOptions(
    getActivityCategories(s.customActivities),
    extraCategories
  );

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      const sc = currentScene();
      const prior = sc.programmeOptions || {};
      const prices = sc.activityPrices || {};
      const links = sc.activityContacts || {};
      const validContactIds = new Set((sc.contacts || []).map((c) => c.id));
      const resolveContact = (id: string) =>
        links[id] && validContactIds.has(links[id]) ? links[id] : undefined;

      setBudget(Number(prior.budget ?? 3000));
      setReserve(Number(prior.reserve ?? 20));
      setSessions(Number(prior.sessions ?? 2));
      setStartTime('10:00');
      setEndTime('14:00');
      setArea(Number(prior.area ?? 60));
      setQuery('');

      const customList: ActivitySpec[] = (sc.customActivities || []).map(
        (ca) => ({
          ...ca,
          cost: prices[ca.id] ?? ca.cost,
          enabled: prior.selected ? prior.selected.includes(ca.id) : true,
          contactId: resolveContact(ca.id),
          custom: true,
        })
      );
      const baseList: ActivitySpec[] = activities.map((a) => ({
        ...a,
        cost: prices[a.id] ?? a.cost,
        enabled: prior.selected ? prior.selected.includes(a.id) : true,
        contactId: resolveContact(a.id),
        custom: false,
      }));
      setChoices([...customList, ...baseList]);
      setPlanResult(
        (sc.programme as typeof planResult) &&
          Array.isArray((sc.programme as typeof planResult)?.schedule)
          ? (sc.programme as typeof planResult)
          : null
      );
      setErrorMsg('');
      setActivityFormOpen(false);
      setActivityFormError('');
      setInlineContactActivityId(null);
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

  const filteredChoices = choices.filter((a) =>
    (a.name + ' ' + a.category)
      .toLocaleLowerCase('es')
      .includes(query.toLocaleLowerCase('es'))
  );

  const dayLabel = (day: number): string => {
    const start = s.startDate || s.eventDate;
    if (!start) return 'Día ' + (day + 1);
    const date = new Date(start + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime())) return 'Día ' + (day + 1);
    date.setUTCDate(date.getUTCDate() + day);
    return (
      'Día ' +
      (day + 1) +
      ' · ' +
      date.toLocaleDateString('es-ES', {timeZone: 'UTC'})
    );
  };

  const openCreateActivityForm = () => {
    setDraftActivity(emptyCustomDraft(availableCategories[0] || 'Taller'));
    setActivityFormError('');
    setActivityFormOpen(true);
  };

  const openEditActivityForm = (act: ActivitySpec) => {
    setDraftActivity({
      id: act.id,
      name: act.name,
      category: act.category,
      minutes: act.minutes,
      cost: act.cost,
      places: act.places,
      area: act.area,
      need: act.need,
    });
    setActivityFormError('');
    setActivityFormOpen(true);
  };

  const handleSaveCustomActivity = (e: React.FormEvent) => {
    e.preventDefault();
    setActivityFormError('');
    const name = draftActivity.name.trim();
    const category = draftActivity.category.trim() || 'Taller';
    if (!name) {
      setActivityFormError('Escribe un nombre para la actividad.');
      return;
    }
    if (
      !Number.isFinite(draftActivity.minutes) ||
      draftActivity.minutes < 5 ||
      draftActivity.minutes > 600
    ) {
      setActivityFormError('La duración debe estar entre 5 y 600 minutos.');
      return;
    }
    if (
      !Number.isFinite(draftActivity.cost) ||
      draftActivity.cost < 0 ||
      draftActivity.cost > 200000
    ) {
      setActivityFormError('El coste debe ser un número mayor o igual que 0.');
      return;
    }
    if (
      !Number.isFinite(draftActivity.places) ||
      draftActivity.places < 1 ||
      draftActivity.places > 5000
    ) {
      setActivityFormError('Las plazas deben ser al menos 1.');
      return;
    }
    if (
      !Number.isFinite(draftActivity.area) ||
      draftActivity.area < 1 ||
      draftActivity.area > 5000
    ) {
      setActivityFormError('La superficie debe ser al menos 1 m².');
      return;
    }

    const isEditing = !!draftActivity.id;
    const id = draftActivity.id || 'custom-' + crypto.randomUUID();
    const item: CustomActivityItem = {
      id,
      name,
      category,
      minutes: Math.round(draftActivity.minutes),
      cost: Number(draftActivity.cost),
      places: Math.round(draftActivity.places),
      area: Math.round(draftActivity.area),
      need: draftActivity.need,
    };

    updateScene((sc) => {
      const existing = sc.customActivities || [];
      sc.customActivities = isEditing
        ? existing.map((a) => (a.id === id ? item : a))
        : [item, ...existing];
      sc.activityPrices = {...(sc.activityPrices || {}), [id]: item.cost};
      if (sc.programmeOptions?.selected) {
        sc.programmeOptions = {
          ...sc.programmeOptions,
          selected: [...new Set([id, ...sc.programmeOptions.selected])],
        };
      }
    });

    setChoices((prev) => {
      if (isEditing) {
        return prev.map((a) =>
          a.id === id ? {...a, ...item, custom: true} : a
        );
      }
      return [{...item, enabled: true, custom: true}, ...prev];
    });
    setActivityFormOpen(false);
    showToast(
      isEditing
        ? `Actividad «${item.name}» actualizada.`
        : `Actividad propia «${item.name}» añadida al programa.`
    );
  };

  const handleDeleteCustomActivity = (id: string, name: string) => {
    updateScene((sc) => {
      sc.customActivities = (sc.customActivities || []).filter(
        (a) => a.id !== id
      );
      if (sc.activityPrices) delete sc.activityPrices[id];
      if (sc.activityContacts) delete sc.activityContacts[id];
      if (sc.programmeOptions?.selected) {
        sc.programmeOptions = {
          ...sc.programmeOptions,
          selected: sc.programmeOptions.selected.filter((x) => x !== id),
        };
      }
    });
    setChoices((prev) => prev.filter((a) => a.id !== id));
    if (draftActivity.id === id) setActivityFormOpen(false);
    if (inlineContactActivityId === id) setInlineContactActivityId(null);
    showToast(`Actividad «${name}» eliminada.`);
  };

  const handleAssignContact = (activityId: string, value: string) => {
    if (value === NEW_CONTACT_SENTINEL) {
      setInlineContactActivityId(activityId);
      setInlineContactName('');
      setInlineContactKind(contactKinds[0] || 'Taller');
      setInlineContactEmail('');
      setInlineContactPhone('');
      setInlineContactError('');
      return;
    }
    const nextContactId = value || undefined;
    setChoices((prev) =>
      prev.map((item) =>
        item.id === activityId ? {...item, contactId: nextContactId} : item
      )
    );
    updateScene((sc) => {
      const nextLinks = {...(sc.activityContacts || {})};
      if (nextContactId) nextLinks[activityId] = nextContactId;
      else delete nextLinks[activityId];
      sc.activityContacts = nextLinks;
    });
  };

  const handleSaveInlineContact = (activityId: string) => {
    const trimmed = inlineContactName.trim();
    if (!trimmed) {
      setInlineContactError('Escribe el nombre de la empresa o contacto.');
      return;
    }
    const newContact: ContactEntry = {
      id: crypto.randomUUID(),
      name: trimmed,
      kind: inlineContactKind.trim() || 'Taller',
      email: inlineContactEmail.trim(),
      phone: inlineContactPhone.trim(),
    };
    updateScene((sc) => {
      sc.contacts = [...(sc.contacts || []), newContact];
      sc.contactKinds = mergeUniqueOptions(sc.contactKinds || [], [
        newContact.kind,
      ]);
      sc.activityContacts = {
        ...(sc.activityContacts || {}),
        [activityId]: newContact.id,
      };
    });
    setChoices((prev) =>
      prev.map((item) =>
        item.id === activityId ? {...item, contactId: newContact.id} : item
      )
    );
    setInlineContactActivityId(null);
    setInlineContactError('');
    showToast(`Contacto «${newContact.name}» guardado y asociado.`);
  };

  const handleSaveSuggestedProvider = (p: (typeof providers)[number]) => {
    const exists = savedContacts.some(
      (c) =>
        c.name.trim().toLocaleLowerCase('es') ===
        p.name.trim().toLocaleLowerCase('es')
    );
    if (exists) return;
    const newContact: ContactEntry = {
      id: crypto.randomUUID(),
      name: p.name,
      kind: p.offer,
      email: '',
      phone: '',
    };
    updateScene((sc) => {
      sc.contacts = [...(sc.contacts || []), newContact];
      sc.contactKinds = mergeUniqueOptions(sc.contactKinds || [], [p.offer]);
    });
    showToast(`«${p.name}» guardado en tus contactos.`);
  };

  const handlePlan = () => {
    setErrorMsg('');
    try {
      const options = {
        budget,
        reserve,
        sessions,
        start: hourOf(startTime),
        finish: hourOf(endTime),
        area,
        items: choices,
      };
      const result = planProgramme(s, options);
      setPlanResult(result);
    } catch (err) {
      setPlanResult(null);
      setErrorMsg((err as Error).message);
    }
  };

  const handleSaveProgramme = () => {
    if (!planResult) return;
    updateScene((sc) => {
      sc.activityPrices = Object.fromEntries(choices.map((a) => [a.id, a.cost]));
      sc.activityContacts = Object.fromEntries(
        choices
          .filter((a) => a.contactId)
          .map((a) => [a.id, a.contactId as string])
      );
      sc.programmeOptions = {
        budget,
        reserve,
        sessions,
        start: hourOf(startTime),
        finish: hourOf(endTime),
        area,
        selected: choices.filter((a) => a.enabled).map((a) => a.id),
      };
      sc.programme = planResult;
    });
    showToast(
      'Programa guardado en este modelo. Pendiente de confirmar con proveedores.'
    );
  };

  const handleExportCSV = () => {
    if (!planResult) return;
    const rowsCsv = [
      ['Dia', 'Inicio', 'Fin', 'Actividad', 'Empresa', 'Coste_estimado_EUR'],
      ...planResult.schedule.map((r) => [
        r.day + 1,
        clock(r.start),
        clock(r.end),
        r.name,
        r.contactId ? contactById.get(r.contactId)?.name || '' : '',
        r.cost,
      ]),
    ];
    const csvContent =
      '\uFEFF' +
      rowsCsv
        .map((row) =>
          row
            .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
            .join(';')
        )
        .join('\r\n');
    downloadFile(
      'Programa_Ojo_de_Buey.csv',
      csvContent,
      'text/csv;charset=utf-8'
    );
  };

  return (
    <dialog
      id="programme-dialog"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <form method="dialog">
        <button type="submit">Cerrar</button>
      </form>
      <div id="programme-body">
        <h2>Actividades para cada día</h2>
        <p>
          Catálogo de ideas para un evento de varios días. Los costes iniciales
          son hipótesis por sesión, sin presupuesto confirmado del proveedor.
          Revisa transporte, montaje, personal, impuestos y requisitos técnicos.
        </p>
        <label>
          Presupuesto total para actividades (€)
          <input
            id="programme-budget"
            type="number"
            min="0"
            max="1000000"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
        </label>
        <label>
          Reserva presupuestaria (%)
          <input
            id="programme-reserve"
            type="number"
            min="0"
            max="50"
            value={reserve}
            onChange={(e) => setReserve(Number(e.target.value))}
          />
        </label>
        <label>
          Sesiones por día
          <input
            id="programme-sessions"
            type="number"
            min="1"
            max="6"
            value={sessions}
            onChange={(e) => setSessions(Number(e.target.value))}
          />
        </label>
        <label>
          Inicio
          <input
            id="programme-start"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label>
          Final
          <input
            id="programme-end"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </label>
        <label>
          Superficie prevista por actividad (m²)
          <input
            id="programme-area"
            type="number"
            min="1"
            max="1000"
            value={area}
            onChange={(e) => setArea(Number(e.target.value))}
          />
        </label>

        <div className="programme-toolbar">
          <label className="programme-search-label">
            Buscar actividades
            <input
              id="activity-query"
              type="search"
              placeholder="Pintacaras, Navidad, música…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            type="button"
            id="programme-create-activity"
            className="dark"
            onClick={openCreateActivityForm}
          >
            + Crear actividad
          </button>
        </div>

        {activityFormOpen && (
          <form
            id="custom-activity-form"
            className="programme-inline-form"
            onSubmit={handleSaveCustomActivity}
          >
            <h3>
              {draftActivity.id
                ? 'Editar actividad propia'
                : 'Nueva actividad propia'}
            </h3>
            <div className="programme-inline-grid">
              <label>
                Nombre
                <input
                  id="custom-act-name"
                  type="text"
                  required
                  maxLength={100}
                  placeholder="Ej. Taller de cerámica local"
                  value={draftActivity.name}
                  onChange={(e) =>
                    setDraftActivity((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                />
              </label>
              <CustomizableSelect
                id="custom-act-category"
                label="Categoría"
                options={availableCategories}
                value={draftActivity.category}
                onChange={(val) =>
                  setDraftActivity((prev) => ({...prev, category: val}))
                }
                onAddOption={(newCat) =>
                  setExtraCategories((prev) =>
                    mergeUniqueOptions(prev, [newCat])
                  )
                }
                placeholder="Ej. Gastronomía, Deporte…"
              />
              <label>
                Duración (min)
                <input
                  id="custom-act-minutes"
                  type="number"
                  min="5"
                  max="600"
                  required
                  value={draftActivity.minutes}
                  onChange={(e) =>
                    setDraftActivity((prev) => ({
                      ...prev,
                      minutes: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Coste por sesión (€)
                <input
                  id="custom-act-cost"
                  type="number"
                  min="0"
                  max="200000"
                  required
                  value={draftActivity.cost}
                  onChange={(e) =>
                    setDraftActivity((prev) => ({
                      ...prev,
                      cost: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Plazas
                <input
                  id="custom-act-places"
                  type="number"
                  min="1"
                  max="5000"
                  required
                  value={draftActivity.places}
                  onChange={(e) =>
                    setDraftActivity((prev) => ({
                      ...prev,
                      places: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Superficie (m²)
                <input
                  id="custom-act-area"
                  type="number"
                  min="1"
                  max="5000"
                  required
                  value={draftActivity.area}
                  onChange={(e) =>
                    setDraftActivity((prev) => ({
                      ...prev,
                      area: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label className="programme-inline-full">
                Recurso necesario
                <select
                  id="custom-act-need"
                  value={draftActivity.need}
                  onChange={(e) =>
                    setDraftActivity((prev) => ({
                      ...prev,
                      need: e.target.value as ActivityNeed,
                    }))
                  }
                >
                  {(
                    Object.entries(ACTIVITY_NEED_LABELS) as Array<
                      [ActivityNeed, string]
                    >
                  ).map(([needKey, needLabel]) => (
                    <option key={needKey} value={needKey}>
                      {needLabel}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {activityFormError && (
              <p className="customizable-select-error" role="alert">
                {activityFormError}
              </p>
            )}
            <div className="programme-inline-actions">
              <button type="submit" id="custom-act-submit" className="dark">
                {draftActivity.id ? 'Guardar cambios' : 'Guardar actividad'}
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => setActivityFormOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        <p>
          {Math.max(1, s.eventDays || 1)} días según el modelo. Ajusta las
          fechas desde un nuevo modelo o la Ficha de producción.
        </p>

        {filteredChoices.length > 0 && (() => {
          const visibleIds = new Set(filteredChoices.map((a) => a.id));
          const selectedCount = filteredChoices.filter((a) => a.enabled).length;
          const allSelected = selectedCount === filteredChoices.length;
          const someSelected = selectedCount > 0 && !allSelected;
          const toggleAll = (nextChecked: boolean) => {
            setChoices((prev) =>
              prev.map((item) =>
                visibleIds.has(item.id)
                  ? {...item, enabled: nextChecked}
                  : item
              )
            );
          };
          return (
            <div className="activity-select-bar">
              <label className="activity-select-all">
                <input
                  id="programme-toggle-all"
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
                <span>
                  {allSelected
                    ? 'Deseleccionar todas'
                    : 'Seleccionar todas'}
                  {query.trim() ? ' (filtradas)' : ''}
                </span>
              </label>
              <span className="activity-select-count">
                {selectedCount} / {filteredChoices.length} seleccionadas
              </span>
            </div>
          );
        })()}

        <div id="activity-catalog">
          {filteredChoices.map((a) => (
            <article
              key={a.id}
              className={`activity-row ${a.custom ? 'is-custom-activity' : ''}`}
              data-activity-id={a.id}
            >
              <div className="activity-main">
                <label className="activity-check-label">
                  <input
                    data-enable={a.id}
                    type="checkbox"
                    checked={!!a.enabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setChoices((prev) =>
                        prev.map((item) =>
                          item.id === a.id ? {...item, enabled: checked} : item
                        )
                      );
                    }}
                  />
                  <span>{a.name}</span>
                  {a.custom && (
                    <span className="activity-badge-custom">Propia</span>
                  )}
                </label>
                <small>
                  {a.category} · {a.minutes} min · {a.places} plazas · {a.area}{' '}
                  m² · {ACTIVITY_NEED_LABELS[a.need]}
                </small>
                <div className="activity-meta-controls">
                  <label className="activity-contact-field">
                    Empresa / contacto
                    <select
                      data-contact={a.id}
                      value={a.contactId || ''}
                      onChange={(e) =>
                        handleAssignContact(a.id, e.target.value)
                      }
                    >
                      <option value="">Sin empresa</option>
                      {savedContacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.kind})
                        </option>
                      ))}
                      <option value={NEW_CONTACT_SENTINEL}>
                        + Añadir contacto nuevo…
                      </option>
                    </select>
                  </label>
                  {a.custom && (
                    <div className="activity-custom-actions">
                      <button
                        type="button"
                        className="quiet"
                        data-edit-custom={a.id}
                        onClick={() => openEditActivityForm(a)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="quiet"
                        data-delete-custom={a.id}
                        onClick={() => handleDeleteCustomActivity(a.id, a.name)}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>

                {inlineContactActivityId === a.id && (
                  <div
                    className="inline-contact-form"
                    id="inline-contact-form"
                    role="region"
                    aria-label="Añadir contacto nuevo"
                  >
                    <b>Nuevo contacto para «{a.name}»</b>
                    <div className="programme-inline-grid">
                      <label>
                        Nombre o empresa
                        <input
                          id="inline-contact-name"
                          type="text"
                          maxLength={100}
                          value={inlineContactName}
                          onChange={(e) => setInlineContactName(e.target.value)}
                        />
                      </label>
                      <CustomizableSelect
                        id="inline-contact-kind"
                        label="Tipo"
                        options={contactKinds}
                        value={inlineContactKind}
                        onChange={setInlineContactKind}
                        onAddOption={(newKind) =>
                          updateScene((sc) => {
                            sc.contactKinds = mergeUniqueOptions(
                              sc.contactKinds || [],
                              [newKind]
                            );
                          })
                        }
                      />
                      <label>
                        Email
                        <input
                          id="inline-contact-email"
                          type="email"
                          value={inlineContactEmail}
                          onChange={(e) =>
                            setInlineContactEmail(e.target.value)
                          }
                        />
                      </label>
                      <label>
                        WhatsApp
                        <input
                          id="inline-contact-phone"
                          placeholder="346…"
                          value={inlineContactPhone}
                          onChange={(e) =>
                            setInlineContactPhone(e.target.value)
                          }
                        />
                      </label>
                    </div>
                    {inlineContactError && (
                      <small className="customizable-select-error" role="alert">
                        {inlineContactError}
                      </small>
                    )}
                    <div className="programme-inline-actions">
                      <button
                        type="button"
                        id="inline-contact-save"
                        className="dark"
                        onClick={() => handleSaveInlineContact(a.id)}
                      >
                        Guardar y asociar
                      </button>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => setInlineContactActivityId(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <label className="activity-cost-field">
                Coste por sesión (€)
                <input
                  data-cost={a.id}
                  type="number"
                  min="0"
                  max="20000"
                  value={a.cost}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val) && val >= 0 && val <= 20000) {
                      setChoices((prev) =>
                        prev.map((item) =>
                          item.id === a.id ? {...item, cost: val} : item
                        )
                      );
                    }
                  }}
                />
              </label>
            </article>
          ))}
        </div>
        <button
          id="programme-plan"
          type="button"
          className="dark"
          onClick={handlePlan}
        >
          Proponer programa dentro del presupuesto
        </button>
        <div id="programme-result">
          {errorMsg && <p>{errorMsg}</p>}
          {planResult && (
            <>
              <h3>Propuesta de programa</h3>
              <p>
                {planResult.schedule.length} sesiones ·{' '}
                {planResult.spent.toFixed(2)} € previstos ·{' '}
                {planResult.reserved.toFixed(2)} € reservados ·{' '}
                {planResult.unspent.toFixed(2)} € sin comprometer.
              </p>
              {Array.from(
                {length: Math.max(1, s.eventDays || 1)},
                (_, day) => (
                  <section key={day} className="note-card">
                    <b>{dayLabel(day)}</b>
                    {planResult.schedule
                      .filter((r) => r.day === day)
                      .map((r, idx) => {
                        const company = r.contactId
                          ? contactById.get(r.contactId)
                          : undefined;
                        return (
                          <p key={idx}>
                            {clock(r.start)}–{clock(r.end)} · {r.name} ·{' '}
                            {r.cost} €
                            {company ? (
                              <>
                                {' '}
                                ·{' '}
                                <span className="session-company-tag">
                                  {company.name}
                                </span>
                              </>
                            ) : null}
                          </p>
                        );
                      })}
                    {planResult.pending
                      .filter((r) => r.day === day)
                      .map((r, idx) => (
                        <p key={`p-${idx}`}>{r.reason}</p>
                      ))}
                  </section>
                )
              )}
              <p>
                Las sesiones se programan sucesivamente con 15 minutos de
                cambio. Comprueba en el plano las posiciones, la cubierta, las
                plazas y la interferencia con música y circulación. El catálogo
                exige los recursos declarados, pero no valida su reparto
                espacial.
              </p>
              <button
                id="programme-keep"
                type="button"
                onClick={handleSaveProgramme}
              >
                Guardar propuesta
              </button>{' '}
              <button
                id="programme-export"
                type="button"
                onClick={handleExportCSV}
              >
                Descargar programa CSV
              </button>
            </>
          )}
        </div>

        <h3>Proveedores para consultar</h3>
        <div id="saved-providers" className="provider-group">
          <h4 className="provider-section-label">Tus contactos guardados</h4>
          {savedContacts.length === 0 ? (
            <p className="provider-empty-note">
              Todavía no tienes contactos guardados. Añade uno desde cualquier
              actividad o desde «Contactos» en la cabecera para preparar
              consultas de disponibilidad.
            </p>
          ) : (
            savedContacts.map((c) => {
              const linkedActivities = choices
                .filter((a) => a.contactId === c.id)
                .map((a) => a.name);
              const message = buildContactInquiryMessage(
                c,
                s.title,
                venueName,
                linkedActivities
              );
              return (
                <article
                  key={c.id}
                  className="note-card provider-saved-card"
                  data-saved-provider={c.id}
                >
                  <b>
                    {c.name} · {c.kind}
                  </b>
                  {linkedActivities.length > 0 && (
                    <p className="provider-activities-tags">
                      Actividades asociadas: {linkedActivities.join(', ')}
                    </p>
                  )}
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
                    {!c.email && !c.phone && (
                      <small>
                        Sin correo ni WhatsApp registrados aún (editable en
                        Contactos).
                      </small>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div id="suggested-providers" className="provider-group">
          <h4 className="provider-section-label is-secondary">
            Sugeridos (referencias locales)
          </h4>
          {providers.map((p) => {
            const alreadySaved = savedContacts.some(
              (c) =>
                c.name.trim().toLocaleLowerCase('es') ===
                p.name.trim().toLocaleLowerCase('es')
            );
            return (
              <article
                key={p.name}
                className="note-card provider-suggested-card"
              >
                <div className="provider-suggested-head">
                  <div>
                    <b>{p.name}</b>
                    <p>
                      {p.offer} · {p.region}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="quiet"
                    data-save-provider={p.name}
                    disabled={alreadySaved}
                    onClick={() => handleSaveSuggestedProvider(p)}
                  >
                    {alreadySaved
                      ? 'Guardado en contactos'
                      : 'Guardar como contacto'}
                  </button>
                </div>
                <a target="_blank" rel="noopener noreferrer" href={p.url}>
                  Consultar oferta en su web
                </a>
                <small>
                  Referencia consultada el 15/11/2026. Disponibilidad y
                  presupuesto pendientes.
                </small>
              </article>
            );
          })}
        </div>
      </div>
    </dialog>
  );
};
