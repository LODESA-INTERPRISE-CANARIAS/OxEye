/**
 * What a guest may not see (M6: moved here from `server/src/records/redact.ts`
 * so the server and the device cache apply one list).
 *
 * The «Invitado» login is shared, so it never receives people's and
 * companies' contact details, free-text observations, prices, costs or
 * conditions: the server sends those fields as null and the record carries
 * `restricted: true`. The device cache (M6) applies the same list again
 * before storing anything a guest received, so a server bug can never leave
 * a withheld value on a shared device.
 *
 * Revisión 1: the text of an answer to an open question (E3) and the reason
 * a conflict was accepted (E2) are free text too. A note carries its current
 * answer inside it (`Note.answer`), so withholding a note also withholds its
 * answer (`NESTED`).
 *
 * A new free-text field is added here, with a marker in
 * `server/tests/redaction.test.ts` and in the E2E mock's mirror.
 */
import type {
  Company,
  ConflictAcceptance,
  Contact,
  DelayHypothesis,
  LogisticsEvent,
  Note,
  NoteAnswer,
  NoteRefType,
  Offer,
  Permission,
  Resource,
  Role,
  Task,
  Warehouse,
} from './contracts.ts';

/** Fields withheld from guests, per record type. */
export const WITHHELD_FROM_GUESTS = {
  event: ['notes'],
  // E4: guests have no Contactos. Safety audit: the company stays linked
  // but reads «Empresa» (DIRECTORY_REF_LABEL).
  task: ['notes', 'contact'],
  contact: ['phone', 'email', 'description', 'notes'],
  company: ['phone', 'email', 'notes'],
  offer: [
    'price',
    'transportCost',
    'assemblyCost',
    'maintenanceCost',
    'conditions',
    // E5: taxes go with the prices.
    'tax',
    'companyTax',
  ],
  warehouse: ['address', 'notes'],
  resource: ['location', 'notes'],
  note: ['text'],
  hypothesis: ['note'],
  answer: ['text'],
  acceptance: ['reason'],
} as const satisfies {
  event: readonly (keyof LogisticsEvent)[];
  task: readonly (keyof Task)[];
  contact: readonly (keyof Contact)[];
  company: readonly (keyof Company)[];
  offer: readonly (keyof Offer)[];
  warehouse: readonly (keyof Warehouse)[];
  resource: readonly (keyof Resource)[];
  note: readonly (keyof Note)[];
  hypothesis: readonly (keyof DelayHypothesis)[];
  answer: readonly (keyof NoteAnswer)[];
  acceptance: readonly (keyof ConflictAcceptance)[];
};

export type WithheldKind = keyof typeof WITHHELD_FROM_GUESTS;

/** Records carried inside another record, withheld with their own list. */
const NESTED: Partial<
  Record<WithheldKind, Readonly<Record<string, WithheldKind>>>
> = {note: {answer: 'answer'}};

/**
 * Safety audit: what a directory name (a person, a company, an offer) reads
 * as for a viewer without `directory.read` (the guest account, or a member
 * without roles): what it is, never whose name. On tasks and resources
 * (their company), in a note's link and in the activity label of a note
 * (notes/refs.ts on the server).
 */
export const DIRECTORY_REF_LABEL = {
  company: 'Empresa',
  contact: 'Persona de contacto',
  offer: 'Oferta del catálogo',
} as const satisfies Partial<Record<NoteRefType, string>>;

const isDirectoryRef = (
  type: unknown,
): type is keyof typeof DIRECTORY_REF_LABEL =>
  typeof type === 'string' &&
  Object.prototype.hasOwnProperty.call(DIRECTORY_REF_LABEL, type);

/** A `{id, name}` company reference with the generic name. */
function genericCompany(value: unknown): unknown {
  return value && typeof value === 'object'
    ? {...value, name: DIRECTORY_REF_LABEL.company}
    : value;
}

/** Directory names carried by a record, replaced by their generic label. */
const DIRECTORY_NAMES: Partial<
  Record<WithheldKind, (out: Record<string, unknown>) => void>
> = {
  task: out => {
    out.company = genericCompany(out.company);
  },
  resource: out => {
    out.company = genericCompany(out.company);
  },
  note: out => {
    const ref = out.ref as {type?: unknown} | null | undefined;
    if (ref && isDirectoryRef(ref.type)) {
      out.ref = {...ref, label: DIRECTORY_REF_LABEL[ref.type]};
    }
  },
};

/**
 * The record as this viewer may hold it: unchanged (with `restricted:
 * false`) for members who read the directory; withheld fields set to null,
 * directory names generic and `restricted: true` for the guest account and,
 * safety audit, for anyone without `directory.read` (`directory` false;
 * records carried inside it too). Pure; never mutates `record`.
 */
export function withholdFor<T extends object>(
  kind: WithheldKind,
  record: T,
  role: Role,
  directory: boolean = role !== 'guest',
): T & {restricted: boolean} {
  if (role !== 'guest' && directory) return {...record, restricted: false};
  const out: Record<string, unknown> = {...record, restricted: true};
  for (const key of WITHHELD_FROM_GUESTS[kind]) out[key] = null;
  DIRECTORY_NAMES[kind]?.(out);
  for (const [key, nested] of Object.entries(NESTED[kind] ?? {})) {
    const value = out[key];
    if (value && typeof value === 'object') {
      out[key] = withholdFor(nested, value, role, false);
    }
  }
  return out as T & {restricted: boolean};
}

/** True when this viewer may read directory names (`directory.read`). */
export function mayReadDirectory(
  role: Role,
  permissions: readonly Permission[],
): boolean {
  return role !== 'guest' && permissions.includes('directory.read');
}

// ---------------------------------------------------------------- Revisión 1 · E5: budget

/**
 * Budget data (an event's budget and its expenses) is not withheld field by
 * field: a viewer without `budget.read` gets none of it (403 on its routes),
 * not even the activity entries or the `/changes` types that mention it.
 * The device never stores it (not a sync list, never queued in the outbox),
 * so nothing remains on a shared phone.
 */
export const BUDGET_ENTITY_TYPES = ['budget', 'expense'] as const;

/** True when this viewer may hold budget data (in memory only). */
export function mayHoldBudget(permissions: readonly Permission[]): boolean {
  return permissions.includes('budget.read');
}

/** Activity entity types this viewer may not see because of the budget. */
export function hiddenBudgetTypes(
  permissions: readonly Permission[],
): readonly string[] {
  return mayHoldBudget(permissions) ? [] : BUDGET_ENTITY_TYPES;
}

/**
 * Activity entries (or `/changes` types) as this viewer may hold them: the
 * budget's are dropped without `budget.read`. The server already does it;
 * the device applies it again before storing the activity feed.
 */
export function withoutBudgetEntries<T extends {entityType: string}>(
  entries: readonly T[],
  permissions: readonly Permission[],
): T[] {
  const hidden = hiddenBudgetTypes(permissions);
  return entries.filter(e => !hidden.includes(e.entityType));
}
