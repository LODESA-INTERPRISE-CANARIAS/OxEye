/**
 * «Contactos»: people and «Empresas y entidades», alphabetical with letter
 * headers, a search field on top (same ranking as the universal search,
 * limited to the segment), a quick «Llamar» on each row, and what each
 * record still lacks.
 */
import React, {useMemo, useRef, useState} from 'react';
import type {Company, Contact} from '../../../shared/logistics/contracts.ts';
import {
  missingForCompany,
  missingForContact,
} from '../../../shared/logistics/quality.ts';
import {universalSearch} from '../../../shared/logistics/search.ts';
import {useActions} from '../common/actions';
import {categoryNames, groupByLetter} from '../lib/directory';
import {initials, plural} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  EmptyState,
  Icon,
  LoadError,
  SearchInput,
  SkeletonRows,
} from '../ui';
import {KindChip} from './DirectoryParts';
import {QuickCall} from './ReachOut';

export type Segment = 'people' | 'companies';

const SEGMENT_KEY = 'oxeye.logistics.contacts-segment.v1';

function readSegment(): Segment {
  try {
    return sessionStorage.getItem(SEGMENT_KEY) === 'companies'
      ? 'companies'
      : 'people';
  } catch {
    return 'people';
  }
}

export const ContactsScreen: React.FC = () => {
  const contacts = useLogisticsStore(s => s.contacts);
  const companies = useLogisticsStore(s => s.companies);
  const categories = useLogisticsStore(s => s.categories);
  const contactsState = useLogisticsStore(s => s.contactsState);
  const contactsError = useLogisticsStore(s => s.contactsError);
  const companiesState = useLogisticsStore(s => s.companiesState);
  const companiesError = useLogisticsStore(s => s.companiesError);
  const refresh = useLogisticsStore(s => s.refresh);
  const {canWrite, openContact, openCompany, addContact, addCompany} =
    useActions();
  const [segment, setSegmentState] = useState<Segment>(readSegment);
  const [query, setQuery] = useState('');
  const tabs = useRef<Record<Segment, HTMLButtonElement | null>>({
    people: null,
    companies: null,
  });

  const setSegment = (s: Segment) => {
    setSegmentState(s);
    try {
      sessionStorage.setItem(SEGMENT_KEY, s);
    } catch {
      // Not remembered; the default is fine.
    }
  };

  const people = segment === 'people';
  const state = people ? contactsState : companiesState;
  const error = people ? contactsError : companiesError;
  const total = people ? contacts.length : companies.length;
  const q = query.trim();

  const hits = useMemo(() => {
    if (!q) return null;
    const found = universalSearch(
      q,
      people ? {contacts} : {companies, categories},
      {types: [people ? 'contact' : 'company'], limit: 500},
    );
    return new Map(found.map((h, i) => [h.id, i]));
  }, [q, people, contacts, companies, categories]);

  const contactRows = useMemo(
    () =>
      hits
        ? contacts
            .filter(c => hits.has(c.id))
            .sort((a, b) => (hits.get(a.id) ?? 0) - (hits.get(b.id) ?? 0))
        : contacts,
    [contacts, hits],
  );
  const companyRows = useMemo(
    () =>
      hits
        ? companies
            .filter(c => hits.has(c.id))
            .sort((a, b) => (hits.get(a.id) ?? 0) - (hits.get(b.id) ?? 0))
        : companies,
    [companies, hits],
  );
  const shown = people ? contactRows.length : companyRows.length;
  const names = useMemo(() => categoryNames(categories), [categories]);

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: Segment = people ? 'companies' : 'people';
    setSegment(next);
    tabs.current[next]?.focus();
  };

  const loading = (state === 'loading' || state === 'idle') && total === 0;
  const failed = state === 'error' && total === 0;

  let body: React.ReactNode;
  if (loading) {
    body = (
      <SkeletonRows
        rows={6}
        label={people ? 'Cargando personas' : 'Cargando empresas'}
      />
    );
  } else if (failed) {
    body = <LoadError message={error ?? ''} onRetry={() => void refresh()} />;
  } else if (total === 0) {
    body = (
      <EmptyState
        icon={people ? 'contacts' : 'building'}
        title={
          people ? 'Aún no hay personas' : 'Aún no hay empresas ni entidades'
        }
        id="lx-contacts-empty"
        action={
          canWrite && (
            <Button
              variant="primary"
              icon="plus"
              id="lx-contacts-empty-add"
              onClick={() => (people ? addContact() : addCompany())}
            >
              {people ? 'Añadir persona' : 'Añadir empresa o entidad'}
            </Button>
          )
        }
      >
        {canWrite
          ? people
            ? 'Guarda a quien conozcas en cuanto lo conozcas: basta con el nombre. El teléfono, el cargo y lo demás pueden esperar.'
            : 'Proveedores, áreas municipales, asociaciones… Basta con el nombre; lo demás puede quedar pendiente de verificar.'
          : 'Cuando el equipo registre a alguien, aparecerá aquí.'}
      </EmptyState>
    );
  } else if (shown === 0) {
    body = (
      <EmptyState
        compact
        icon="search"
        title={`Nada coincide con «${q}»`}
        id="lx-contacts-noresults"
        action={
          <div className="lx-empty__actions">
            {canWrite && (
              <Button
                variant="primary"
                icon="plus"
                onClick={() =>
                  people ? addContact({name: q}) : addCompany({name: q})
                }
              >
                {people ? `Añadir a «${q}»` : `Añadir «${q}»`}
              </Button>
            )}
            <Button onClick={() => setQuery('')}>Borrar la búsqueda</Button>
          </div>
        }
      >
        Prueba con parte del nombre, el cargo o la empresa.
      </EmptyState>
    );
  } else if (people) {
    body = hits ? (
      <ul className="lx-dirlist" aria-label="Resultados">
        {contactRows.map(c => (
          <ContactRow key={c.id} contact={c} onOpen={openContact} />
        ))}
      </ul>
    ) : (
      groupByLetter(contactRows).map(g => (
        <section
          key={g.letter}
          className="lx-letter"
          aria-labelledby={`lx-letter-p-${g.letter}`}
        >
          <h3 className="lx-letter__title" id={`lx-letter-p-${g.letter}`}>
            {g.letter}
          </h3>
          <ul className="lx-dirlist">
            {g.items.map(c => (
              <ContactRow key={c.id} contact={c} onOpen={openContact} />
            ))}
          </ul>
        </section>
      ))
    );
  } else {
    const row = (c: Company) => (
      <CompanyRow
        key={c.id}
        company={c}
        categories={c.categoryIds
          .map(id => names.get(id))
          .filter((n): n is string => !!n)}
        onOpen={openCompany}
      />
    );
    body = hits ? (
      <ul className="lx-dirlist" aria-label="Resultados">
        {companyRows.map(row)}
      </ul>
    ) : (
      groupByLetter(companyRows).map(g => (
        <section
          key={g.letter}
          className="lx-letter"
          aria-labelledby={`lx-letter-c-${g.letter}`}
        >
          <h3 className="lx-letter__title" id={`lx-letter-c-${g.letter}`}>
            {g.letter}
          </h3>
          <ul className="lx-dirlist">{g.items.map(row)}</ul>
        </section>
      ))
    );
  }

  return (
    <div className="lx-directory" id="lx-space-contactos">
      <div className="lx-directory__bar">
        <div
          className="lx-segtabs"
          role="tablist"
          aria-label="Qué ver"
          onKeyDown={onTabKey}
        >
          {(['people', 'companies'] as const).map(s => {
            const selected = segment === s;
            const count = s === 'people' ? contacts.length : companies.length;
            return (
              <button
                key={s}
                ref={el => {
                  tabs.current[s] = el;
                }}
                type="button"
                role="tab"
                id={`lx-contacts-tab-${s}`}
                aria-selected={selected}
                aria-controls="lx-contacts-panel"
                tabIndex={selected ? 0 : -1}
                className="lx-segtabs__tab"
                onClick={() => setSegment(s)}
              >
                <Icon
                  name={s === 'people' ? 'contacts' : 'building'}
                  size={18}
                />
                <span>
                  {s === 'people' ? 'Personas' : 'Empresas y entidades'}
                </span>
                <span className="lx-segtabs__count lx-num">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="lx-directory__tools">
          <SearchInput
            id="lx-contacts-search"
            value={query}
            onValue={setQuery}
            label={people ? 'Buscar personas' : 'Buscar empresas y entidades'}
            placeholder={
              people
                ? 'Buscar por nombre, cargo o empresa'
                : 'Buscar por nombre o categoría'
            }
          />
          {canWrite && (
            <Button
              icon="plus"
              id="lx-contacts-add"
              onClick={() => (people ? addContact() : addCompany())}
            >
              {people ? 'Añadir persona' : 'Añadir empresa'}
            </Button>
          )}
        </div>
      </div>

      <div
        className="lx-directory__panel"
        role="tabpanel"
        id="lx-contacts-panel"
        aria-labelledby={`lx-contacts-tab-${segment}`}
      >
        {!loading && !failed && total > 0 && (
          <p className="lx-directory__count lx-num" role="status">
            {q
              ? `${plural(shown, 'resultado', 'resultados')} para «${q}»`
              : people
                ? plural(total, 'persona', 'personas')
                : plural(total, 'empresa o entidad', 'empresas y entidades')}
          </p>
        )}
        {body}
      </div>
    </div>
  );
};

const ContactRow: React.FC<{
  contact: Contact;
  onOpen: (c: Contact) => void;
}> = ({contact, onOpen}) => {
  const missing = missingForContact(contact);
  const sub = [contact.role, contact.company?.name].filter(Boolean).join(' · ');
  return (
    <li className="lx-dirrow" data-contact-id={contact.id}>
      <button
        type="button"
        className="lx-dirrow__main"
        onClick={() => onOpen(contact)}
      >
        <span className="lx-avatar" aria-hidden="true">
          {initials(contact.name)}
        </span>
        <span className="lx-dirrow__text">
          <span className="lx-dirrow__name">{contact.name}</span>
          {sub && <span className="lx-dirrow__sub">{sub}</span>}
          {missing.length > 0 && (
            <span className="lx-dirrow__missing">
              <span className="lx-chip__dot" aria-hidden="true" />
              Falta {missing.join(', ')}
            </span>
          )}
        </span>
        {contact.isDemo && <span className="lx-dirrow__demo">Demo</span>}
        <Icon name="chevronRight" size={18} className="lx-dirrow__chev" />
      </button>
      <QuickCall target={contact} id={`lx-call-${contact.id}`} />
    </li>
  );
};

const CompanyRow: React.FC<{
  company: Company;
  categories: string[];
  onOpen: (c: Company) => void;
}> = ({company, categories, onOpen}) => {
  const missing = missingForCompany(company);
  const counts = [
    company.contactCount
      ? plural(company.contactCount, 'persona', 'personas')
      : '',
    company.offerCount ? plural(company.offerCount, 'oferta', 'ofertas') : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="lx-dirrow" data-company-id={company.id}>
      <button
        type="button"
        className="lx-dirrow__main"
        onClick={() => onOpen(company)}
      >
        <span className="lx-avatar lx-avatar--org" aria-hidden="true">
          <Icon name="building" size={18} />
        </span>
        <span className="lx-dirrow__text">
          <span className="lx-dirrow__name">{company.name}</span>
          <span className="lx-dirrow__sub">
            <KindChip kind={company.kind} />
            {categories.length > 0 && <span>{categories.join(', ')}</span>}
          </span>
          {(counts || missing.length > 0) && (
            <span className="lx-dirrow__meta">
              {counts && <span className="lx-num">{counts}</span>}
              {missing.length > 0 && (
                <span className="lx-dirrow__missing">
                  <span className="lx-chip__dot" aria-hidden="true" />
                  Falta {missing.join(', ')}
                </span>
              )}
            </span>
          )}
        </span>
        {company.isDemo && <span className="lx-dirrow__demo">Demo</span>}
        <Icon name="chevronRight" size={18} className="lx-dirrow__chev" />
      </button>
      <QuickCall target={company} id={`lx-call-${company.id}`} />
    </li>
  );
};
