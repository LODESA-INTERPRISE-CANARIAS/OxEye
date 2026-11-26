/**
 * «Persona de contacto» of a task: who to call about it. The people of the
 * task's company come first, then everyone else, so the usual choice is one
 * tap away without hiding the others (a municipal technician may follow a
 * supplier's job). Once chosen, the person can be reached from the form.
 */
import React, {useMemo} from 'react';
import type {Contact} from '../../../shared/logistics/contracts.ts';
import {useActions} from '../common/actions';
import {ReachOut} from '../contacts/ReachOut';
import {sortContacts} from '../lib/directory';
import {nameKey} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Field, Select, describedBy} from '../ui';

const ID = 'lx-task-contact';

export const TaskContactField: React.FC<{
  value: string;
  companyName: string;
  /** The person saved on the task, in case it is not in the list (yet). */
  saved: {id: string; name: string} | null;
  error?: string;
  onChange: (contactId: string, contact: Contact | null) => void;
}> = ({value, companyName, saved, error, onChange}) => {
  const contacts = useLogisticsStore(s => s.contacts);
  const {openContact} = useActions();
  const companyKey = nameKey(companyName);

  const {ofCompany, others} = useMemo(() => {
    const sorted = sortContacts(contacts);
    const mine = companyKey
      ? sorted.filter(c => c.company && nameKey(c.company.name) === companyKey)
      : [];
    const mineIds = new Set(mine.map(c => c.id));
    return {ofCompany: mine, others: sorted.filter(c => !mineIds.has(c.id))};
  }, [contacts, companyKey]);

  const chosen = contacts.find(c => c.id === value) ?? null;
  const missing =
    value && !chosen ? (saved?.id === value ? saved : null) : null;
  const otherCompany =
    chosen?.company && companyKey && nameKey(chosen.company.name) !== companyKey
      ? chosen.company.name
      : null;

  const hint = !value
    ? contacts.length
      ? 'A quién llamar por esta tarea.'
      : 'Aún no hay personas guardadas. Añádelas en Contactos.'
    : otherCompany
      ? `Trabaja en ${otherCompany}, no en la empresa de la tarea.`
      : undefined;

  const label = (c: Contact) =>
    [c.name, c.role, !ofCompany.includes(c) ? c.company?.name : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="lx-taskcontact">
      <Field
        id={ID}
        label="Persona de contacto"
        optional
        error={error}
        hint={hint}
      >
        <Select
          id={ID}
          name={ID}
          value={value}
          invalid={!!error}
          aria-describedby={describedBy(ID, {error, hint})}
          onChange={e => {
            const id = e.target.value;
            onChange(id, contacts.find(c => c.id === id) ?? null);
          }}
        >
          <option value="">Sin persona de contacto</option>
          {missing && <option value={missing.id}>{missing.name}</option>}
          {ofCompany.length > 0 && (
            <optgroup label={`De ${companyName.trim()}`}>
              {ofCompany.map(c => (
                <option key={c.id} value={c.id}>
                  {label(c)}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 &&
            (ofCompany.length > 0 ? (
              <optgroup label="Otras personas">
                {others.map(c => (
                  <option key={c.id} value={c.id}>
                    {label(c)}
                  </option>
                ))}
              </optgroup>
            ) : (
              others.map(c => (
                <option key={c.id} value={c.id}>
                  {label(c)}
                </option>
              ))
            ))}
        </Select>
      </Field>
      {chosen && (
        <div className="lx-taskcontact__reach">
          <ReachOut
            compact
            idPrefix="lx-task-contact-reach"
            target={{
              name: chosen.name,
              phone: chosen.phone,
              email: chosen.email,
              restricted: chosen.restricted,
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="user"
            id="lx-task-contact-open"
            onClick={() => openContact(chosen)}
          >
            Ver ficha
          </Button>
        </div>
      )}
    </div>
  );
};
