/**
 * «Vinculada a»: the one record a note points at (a task, place, company,
 * person, offer, warehouse or resource), picked from the loaded lists with
 * the same instant search as everywhere else. Optional: a note may stand on
 * its own or only under an event.
 */
import React, {useMemo, useState} from 'react';
import type {
  NoteRefType,
  SearchEntityType,
} from '../../../shared/logistics/contracts.ts';
import {NOTE_REF_TYPES} from '../../../shared/logistics/rules.ts';
import {
  SEARCH_TYPE_LABEL,
  universalSearch,
} from '../../../shared/logistics/search.ts';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, HelpTip, Icon, SearchInput, type IconName} from '../ui';

export interface RefValue {
  type: NoteRefType;
  id: string;
  label: string;
}

export const REF_ICON: Record<NoteRefType, IconName> = {
  task: 'task',
  venue: 'pin',
  company: 'building',
  contact: 'user',
  offer: 'offer',
  warehouse: 'warehouse',
  resource: 'inventory',
};

const MAX_HITS = 6;

export const RefPicker: React.FC<{
  idPrefix: string;
  value: RefValue | null;
  onChange: (value: RefValue | null) => void;
  error?: string;
}> = ({idPrefix, value, onChange, error}) => {
  const tasks = useLogisticsStore(s => s.tasks);
  const venues = useLogisticsStore(s => s.venues);
  const companies = useLogisticsStore(s => s.companies);
  const contacts = useLogisticsStore(s => s.contacts);
  const offers = useLogisticsStore(s => s.offers);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const resources = useLogisticsStore(s => s.resources);
  const categories = useLogisticsStore(s => s.categories);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const q = query.trim();
  const inputId = `${idPrefix}-ref-search`;
  const errorId = `${idPrefix}-ref-error`;
  const describedBy = error ? errorId : undefined;
  const errorText = error && (
    <p className="lx-field__error" role="alert" id={errorId}>
      {error}
    </p>
  );

  const hits = useMemo(
    () =>
      q
        ? universalSearch(
            q,
            {
              tasks,
              venues,
              companies,
              contacts,
              offers,
              warehouses,
              resources,
              categories,
            },
            {types: [...NOTE_REF_TYPES] as SearchEntityType[], limit: MAX_HITS},
          )
        : [],
    [
      q,
      tasks,
      venues,
      companies,
      contacts,
      offers,
      warehouses,
      resources,
      categories,
    ],
  );

  const choose = (next: RefValue | null) => {
    onChange(next);
    setQuery('');
    setPicking(false);
  };

  const legend = (
    <span className="lx-field__label lx-segmented__legend">
      Vinculada a<span className="lx-field__optional"> · opcional</span>
      <HelpTip label="vinculada a">
        Un registro concreto del que trata la nota: una tarea, un lugar, una
        empresa, una persona, una oferta, un almacén o un recurso. La nota
        aparecerá en su ficha.
      </HelpTip>
    </span>
  );

  if (value && !picking) {
    return (
      <div className="lx-refpick" id={`${idPrefix}-ref`}>
        {legend}
        <div className="lx-refpick__chosen">
          <Icon name={REF_ICON[value.type]} size={18} />
          <span className="lx-refpick__label">
            <strong>{value.label}</strong>
            <span className="lx-muted">{SEARCH_TYPE_LABEL[value.type]}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            id={`${idPrefix}-ref-change`}
            aria-describedby={describedBy}
            onClick={() => setPicking(true)}
          >
            Cambiar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            id={`${idPrefix}-ref-clear`}
            aria-label={`Quitar el vínculo con ${value.label}`}
            aria-describedby={describedBy}
            onClick={() => choose(null)}
          >
            Quitar
          </Button>
        </div>
        {errorText}
      </div>
    );
  }

  return (
    <div className="lx-refpick" id={`${idPrefix}-ref`}>
      {legend}
      <SearchInput
        id={inputId}
        value={query}
        onValue={setQuery}
        label="Buscar el registro al que se refiere la nota"
        placeholder="Tarea, lugar, empresa, persona, almacén, recurso…"
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        onKeyDown={e => {
          // Enter picks the first result instead of submitting the form.
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = hits[0];
            if (first) {
              choose({
                type: first.type as NoteRefType,
                id: first.id,
                label: first.title,
              });
            }
          }
        }}
      />
      {q && (
        <ul
          className="lx-linklist lx-refpick__hits"
          aria-label="Registros encontrados"
        >
          {hits.length ? (
            hits.map(h => (
              <li key={`${h.type}:${h.id}`}>
                <button
                  type="button"
                  className="lx-linkrow"
                  onClick={() =>
                    choose({
                      type: h.type as NoteRefType,
                      id: h.id,
                      label: h.title,
                    })
                  }
                >
                  <Icon name={REF_ICON[h.type as NoteRefType]} size={18} />
                  <span className="lx-linkrow__title">{h.title}</span>
                  <span className="lx-linkrow__meta">
                    {SEARCH_TYPE_LABEL[h.type]}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="lx-muted lx-refpick__none">
              Nada coincide con «{q}».
            </li>
          )}
        </ul>
      )}
      {picking && value && (
        <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
          Mantener «{value.label}»
        </Button>
      )}
      {errorText}
    </div>
  );
};
