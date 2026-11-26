/**
 * Small pieces shared by the person, company and offer sheets and lists:
 * a value that may be pending or withheld, the «Falta: …» hint, the kind
 * chip, and a gone-record notice.
 */
import React, {useState} from 'react';
import type {CompanyKind} from '../../../shared/logistics/contracts.ts';
import {COMPANY_KIND_LABEL} from '../../../shared/logistics/rules.ts';
import {Chip, Icon, Pending, Withheld} from '../ui';

/**
 * A field value: the value itself, «Visible para el equipo» when withheld
 * from a guest, or «Pendiente de verificar» when nobody knows it yet.
 */
export const Value: React.FC<{
  value: React.ReactNode;
  /** The record was restricted and this field is one of the withheld ones. */
  withheld?: boolean;
  /** Text when the value is simply empty and not a gap (e.g. «—»). */
  empty?: React.ReactNode;
}> = ({value, withheld = false, empty}) => {
  if (value !== null && value !== undefined && value !== '') {
    return <>{value}</>;
  }
  if (withheld) return <Withheld />;
  return <>{empty ?? <Pending />}</>;
};

/** «Falta: cargo, empresa o entidad» as a quiet dotted line. */
export const MissingHint: React.FC<{missing: string[]; id?: string}> = ({
  missing,
  id,
}) =>
  missing.length ? (
    <p className="lx-missinghint" id={id}>
      <span className="lx-chip__dot" aria-hidden="true" />
      Falta: {missing.join(', ')}
    </p>
  ) : null;

export const KindChip: React.FC<{kind: CompanyKind}> = ({kind}) => (
  <Chip
    tag
    tone="neutral"
    size="sm"
    className={`lx-kindchip lx-kindchip--${kind}`}
  >
    {COMPANY_KIND_LABEL[kind]}
  </Chip>
);

/**
 * Whether the record was deleted while its sheet was open: only once it has
 * been seen in the live list. A record handed over before it reaches the
 * list (e.g. the existing company of a 409 DUPLICATE) is not «gone».
 */
export function useGone(live: unknown, loaded: boolean): boolean {
  const [seen, setSeen] = useState(!!live);
  // Derived state, updated during render (React's documented pattern).
  if (live && !seen) setSeen(true);
  return seen && loaded && !live;
}

/** The record was deleted (by someone else) while its sheet was open. */
export const GoneNotice: React.FC<{what: string}> = ({what}) => (
  <p className="lx-notice lx-notice--error" role="status" id="lx-record-gone">
    <Icon name="trash" size={16} />
    {what} ya no existe: alguien la ha borrado. Lo que ves es la última copia
    que llegó.
  </p>
);
