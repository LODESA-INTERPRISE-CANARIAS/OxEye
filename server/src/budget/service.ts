/**
 * Revisión 1 · E5: an event's budget (one total, taxes included) and its
 * expenses. Not accounting: no invoices, no payments.
 *
 * Access is all or nothing: reading needs `budget.read`, writing
 * `budget.edit` (403 otherwise; a provisional password holds both back), and
 * an event or expense of another organization is «not found». There is no
 * field-level withholding because nobody without the permission receives
 * any of it (see shared/logistics/redaction.ts, BUDGET_ENTITY_TYPES).
 *
 * Every write holds the organization's catalogue lock (expenses point at
 * companies and copy offers) and appends to the activity log in the same
 * transaction, with field names only: amounts never reach the log. An
 * expense created from an offer keeps a copy of it (`offer_snapshot`,
 * `snapshotOf`) that nothing ever updates.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIsoOrNull} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {COMPANY_NOT_FOUND} from '../companies/service.ts';
import {findOfferRow, toFullOffer} from '../offers/service.ts';
import {toAmount} from '../offers/domain.ts';
import {
  checkAccess,
  isUuid,
  requireAccess,
  requireMembership,
} from '../organizations/service.ts';
import type {Membership} from '../organizations/service.ts';
import {createOnce, findReplay, fresh} from '../records/device-id.ts';
import type {Created, DeviceCreate} from '../records/device-id.ts';
import {lockCatalogue} from '../records/locks.ts';
import {authorJoins, metaColumns, toMeta} from '../records/meta.ts';
import type {MetaRow} from '../records/meta.ts';
import {changedFields} from '../records/slot.ts';
import {taxColumns, taxParams, toTax} from './tax.ts';
import type {TaxRow} from './tax.ts';
import {BUDGET_AMOUNT_REQUIRED} from './schemas.ts';
import type {
  BudgetBody,
  CreateExpenseBody,
  UpdateExpenseBody,
} from './schemas.ts';
import {
  budgetSummary,
  effectiveTax,
  priceEstimate,
  sameTax,
  snapshotOf,
} from '../../../shared/logistics/money.ts';
import {MAX_EXPENSES_PER_EVENT} from '../../../shared/logistics/rules.ts';
import type {
  BudgetSummary,
  DataSource,
  EventBudget,
  EventBudgetResponse,
  Expense,
  ExpenseStatus,
  OfferSnapshot,
  Permission,
  SessionUser,
  TaxInfo,
  Verification,
} from '../../../shared/logistics/contracts.ts';

const EVENT_NOT_FOUND =
  'No encontramos ese evento en esta organización: puede que se haya eliminado.';
const EXPENSE_NOT_FOUND =
  'No encontramos ese gasto: puede que se haya eliminado.';
const CONCEPT_REQUIRED =
  'Escribe el concepto del gasto (por ejemplo, «Alquiler de carpas»).';
const OFFER_UNKNOWN =
  'Esa oferta ya no existe o no es de esta organización: elige otra o escribe el gasto a mano.';
const TOO_MANY_EXPENSES = `Un evento admite como máximo ${MAX_EXPENSES_PER_EVENT} gastos.`;

// ---------------------------------------------------------------- rows

interface EventRef {
  id: string;
  name: string;
  organization_id: string;
  is_demo: boolean;
}

interface BudgetRow {
  event_id: string;
  amount: unknown;
  version: number;
  updated_by: string;
  updated_by_name: string;
  updated_at: unknown;
}

interface ExpenseRow extends MetaRow, TaxRow {
  organization_id: string;
  event_id: string;
  concept: string;
  company_id: string | null;
  company_name: string | null;
  amount: unknown;
  status: ExpenseStatus;
  offer_snapshot: unknown;
  notes: string | null;
}

// The live company name while linked; the copy once it was deleted.
const SELECT_EXPENSE = `
  SELECT ${metaColumns('x')}, x.organization_id, x.event_id, x.concept,
         x.company_id, COALESCE(c.name, x.company_name) AS company_name,
         x.amount::text AS amount, ${taxColumns('x')}, x.status,
         x.offer_snapshot, x.notes
    FROM expenses x
    LEFT JOIN companies c ON c.id = x.company_id
    ${authorJoins('x')}`;

function parseSnapshot(value: unknown): OfferSnapshot | null {
  if (value === null || value === undefined) return null;
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return parsed && typeof parsed === 'object'
    ? (parsed as OfferSnapshot)
    : null;
}

function toExpense(row: ExpenseRow): Expense {
  return {
    ...toMeta(row),
    organizationId: row.organization_id,
    eventId: row.event_id,
    concept: row.concept,
    company: row.company_name
      ? {id: row.company_id, name: row.company_name}
      : null,
    amount: toAmount(row.amount),
    tax: toTax(row),
    status: row.status,
    snapshot: parseSnapshot(row.offer_snapshot),
    notes: row.notes,
  };
}

function toBudget(eventId: string, row: BudgetRow | undefined): EventBudget {
  if (!row) {
    return {
      eventId,
      amount: null,
      version: 0,
      updatedBy: null,
      updatedAt: null,
    };
  }
  return {
    eventId,
    amount: toAmount(row.amount),
    version: Number(row.version),
    updatedBy: {id: row.updated_by, displayName: row.updated_by_name},
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

async function loadBudgetRow(
  q: Queryable,
  eventId: string,
  lock = false,
): Promise<BudgetRow | undefined> {
  const rows = await q.query<BudgetRow>(
    `SELECT b.event_id, b.amount::text AS amount, b.version, b.updated_by,
            u.display_name AS updated_by_name, b.updated_at
       FROM event_budgets b JOIN users u ON u.id = b.updated_by
      WHERE b.event_id = $1${lock ? ' FOR UPDATE OF b' : ''}`,
    [eventId],
  );
  return rows[0];
}

async function loadExpense(
  q: Queryable,
  id: string,
  lock = false,
): Promise<ExpenseRow | undefined> {
  const rows = await q.query<ExpenseRow>(
    `${SELECT_EXPENSE} WHERE x.id = $1${lock ? ' FOR UPDATE OF x' : ''}`,
    [id],
  );
  return rows[0];
}

// ---------------------------------------------------------------- access

function eventNotFound(): AppError {
  return notFound(EVENT_NOT_FOUND);
}

function expenseNotFound(): AppError {
  return notFound(EXPENSE_NOT_FOUND);
}

async function findEvent(
  q: Queryable,
  eventId: string,
): Promise<EventRef | undefined> {
  if (!isUuid(eventId)) return undefined;
  const rows = await q.query<EventRef>(
    'SELECT id, name, organization_id, is_demo FROM events WHERE id = $1',
    [eventId],
  );
  return rows[0];
}

/**
 * The event and the membership if the user may use `permission` on its
 * budget: 404 for an unknown or foreign event, 403 without the permission.
 */
async function eventAccess(
  q: Queryable,
  actor: SessionUser,
  eventId: string,
  permission: Permission,
): Promise<{event: EventRef; org: Membership}> {
  const event = await findEvent(q, eventId);
  if (!event) throw eventNotFound();
  let org: Membership;
  try {
    org = await requireMembership(q, actor.id, event.organization_id);
  } catch {
    throw eventNotFound();
  }
  checkAccess(org, actor, permission);
  return {event, org};
}

async function expenseAccess(
  q: Queryable,
  actor: SessionUser,
  id: string,
  permission: Permission,
): Promise<{row: ExpenseRow; org: Membership}> {
  if (!isUuid(id)) throw expenseNotFound();
  const row = await loadExpense(q, id);
  if (!row) throw expenseNotFound();
  let org: Membership;
  try {
    org = await requireMembership(q, actor.id, row.organization_id);
  } catch {
    throw expenseNotFound();
  }
  checkAccess(org, actor, permission);
  return {row, org};
}

function throwIfFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

/** A company of the organization with its tax (expenses copy it). */
async function findCompanyWithTax(
  q: Queryable,
  organizationId: string,
  id: string,
): Promise<{id: string; name: string; tax: TaxInfo | null} | undefined> {
  const rows = await q.query<{id: string; name: string} & TaxRow>(
    `SELECT c.id, c.name, ${taxColumns('c')} FROM companies c
      WHERE c.id = $1 AND c.organization_id = $2`,
    [id, organizationId],
  );
  const row = rows[0];
  return row ? {id: row.id, name: row.name, tax: toTax(row)} : undefined;
}

// ---------------------------------------------------------------- budget

export async function getBudget(
  db: Db,
  actor: SessionUser,
  eventId: string,
): Promise<EventBudgetResponse> {
  const {event} = await eventAccess(db, actor, eventId, 'budget.read');
  const [row, expenses] = await Promise.all([
    loadBudgetRow(db, event.id),
    db.query<ExpenseRow>(
      `${SELECT_EXPENSE} WHERE x.event_id = $1 ORDER BY x.created_at, x.id`,
      [event.id],
    ),
  ]);
  return {budget: toBudget(event.id, row), expenses: expenses.map(toExpense)};
}

/**
 * Sets or clears the event's budget at the given version (0 = not set yet);
 * 409 VERSION_CONFLICT with `current` otherwise. Logged as entityType
 * `budget` (entityId = the event) with `changedFields` ['amount'].
 */
export async function setBudget(
  db: Db,
  actor: SessionUser,
  eventId: string,
  input: BudgetBody,
  now: Date,
): Promise<EventBudget> {
  if (input.amount === undefined) {
    throw validationError({amount: BUDGET_AMOUNT_REQUIRED});
  }
  const amount = input.amount;
  return db.transaction(async tx => {
    const {event} = await eventAccess(tx, actor, eventId, 'budget.edit');
    await lockCatalogue(tx, event.organization_id);
    const row = await loadBudgetRow(tx, event.id, true);
    const current = toBudget(event.id, row);
    if (current.version !== input.version) {
      throw new AppError(
        'VERSION_CONFLICT',
        'Otra persona ha cambiado el presupuesto de este evento mientras lo editabas. Revisa el importe actual antes de guardar.',
        {current},
      );
    }
    if (current.amount === amount && (row || amount === null)) return current;
    const at = now.toISOString();
    if (row) {
      await tx.query(
        `UPDATE event_budgets
            SET amount = $2::numeric, version = version + 1, updated_by = $3,
                updated_at = $4::timestamptz
          WHERE event_id = $1`,
        [event.id, amount, actor.id, at],
      );
    } else {
      await tx.query(
        `INSERT INTO event_budgets
           (event_id, organization_id, amount, updated_by, updated_at)
         VALUES ($1, $2, $3::numeric, $4, $5::timestamptz)`,
        [event.id, event.organization_id, amount, actor.id, at],
      );
    }
    await appendActivity(tx, {
      organizationId: event.organization_id,
      userId: actor.id,
      entityType: 'budget',
      entityId: event.id,
      entityLabel: event.name,
      action: row ? 'update' : 'create',
      changedFields: ['amount'],
      at: now,
      isDemo: event.is_demo,
    });
    return toBudget(event.id, await loadBudgetRow(tx, event.id));
  });
}

/**
 * Every event of the organization with a budget or an expense, sorted like
 * events, with its sums (`budgetSummary`).
 */
export async function listBudgetSummaries(
  db: Db,
  actor: SessionUser,
  organizationId: string,
): Promise<BudgetSummary[]> {
  const org = await requireAccess(db, actor, organizationId, 'budget.read');
  const [events, expenses] = await Promise.all([
    db.query<{event_id: string; amount: unknown}>(
      `SELECT e.id AS event_id, b.amount::text AS amount
         FROM events e
         LEFT JOIN event_budgets b ON b.event_id = e.id
        WHERE e.organization_id = $1
          AND (b.event_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM expenses x WHERE x.event_id = e.id))
        ORDER BY e.local_date ASC NULLS LAST, e.starts_at ASC NULLS LAST,
                 lower(e.name), e.id`,
      [org.id],
    ),
    db.query<
      {event_id: string; amount: unknown; status: ExpenseStatus} & TaxRow
    >(
      `SELECT x.event_id, x.amount::text AS amount, x.status, ${taxColumns('x')}
         FROM expenses x WHERE x.organization_id = $1`,
      [org.id],
    ),
  ]);
  const byEvent = new Map<
    string,
    Pick<Expense, 'amount' | 'tax' | 'status'>[]
  >();
  for (const x of expenses) {
    const list = byEvent.get(x.event_id) ?? [];
    list.push({amount: toAmount(x.amount), tax: toTax(x), status: x.status});
    byEvent.set(x.event_id, list);
  }
  return events.map(e =>
    budgetSummary(
      {eventId: e.event_id, amount: toAmount(e.amount)},
      byEvent.get(e.event_id) ?? [],
    ),
  );
}

// ---------------------------------------------------------------- expenses

/** The editable state of an expense, in comparable form. */
interface ExpenseState {
  concept: string;
  /** Company id, or `name:<name>` once the company was deleted. */
  company: string | null;
  companyId: string | null;
  companyName: string | null;
  amount: number | null;
  status: ExpenseStatus;
  notes: string | null;
  source: DataSource | null;
  verification: Verification;
  /** Compared with `sameTax` (not in FIELD_NAMES). */
  tax: TaxInfo | null;
}

const FIELD_NAMES: readonly (readonly [keyof ExpenseState, string])[] = [
  ['concept', 'concept'],
  ['company', 'company'],
  ['amount', 'amount'],
  ['status', 'status'],
  ['notes', 'notes'],
  ['source', 'source'],
  ['verification', 'verification'],
];

function companyKey(id: string | null, name: string | null): string | null {
  return id ?? (name ? `name:${name}` : null);
}

function stateOf(row: ExpenseRow): ExpenseState {
  return {
    concept: row.concept,
    company: companyKey(row.company_id, row.company_name),
    companyId: row.company_id,
    companyName: row.company_name,
    amount: toAmount(row.amount),
    status: row.status,
    notes: row.notes,
    source: row.source,
    verification: row.verification,
    tax: toTax(row),
  };
}

function staleExpense(row: ExpenseRow): AppError {
  return new AppError(
    'VERSION_CONFLICT',
    'Otra persona ha cambiado este gasto mientras lo editabas. Revisa la versión actual antes de guardar tus cambios.',
    {current: toExpense(row)},
  );
}

/**
 * Creates an expense. From an offer: the snapshot is copied here, from the
 * offer as stored now, and omitted company, amount and tax default to the
 * offer's company, its price before tax (null when it cannot be derived)
 * and its effective tax. Without an offer, an omitted tax copies the
 * company's.
 */
export async function createExpense(
  db: Db,
  actor: SessionUser,
  input: CreateExpenseBody,
  now: Date,
): Promise<Created<Expense>> {
  // The event's organization never changes: read it once for the device id.
  const known = await findEvent(db, input.eventId);
  if (!known) throw eventNotFound();
  const device: DeviceCreate<Expense> = {
    table: 'expenses',
    id: input.id,
    organizationId: known.organization_id,
    actorId: actor.id,
    load: async (q, id) => {
      const row = await loadExpense(q, id);
      return row && toExpense(row);
    },
  };
  return createOnce(db, device, async tx => {
    const {event, org} = await eventAccess(
      tx,
      actor,
      input.eventId,
      'budget.edit',
    );
    // A copy of an offer carries its prices: the catalogue's permission too.
    if (input.offerId) checkAccess(org, actor, 'directory.read');
    await lockCatalogue(tx, org.id);
    const replay = await findReplay(tx, device, org.id);
    if (replay) return replay;

    const fields: Record<string, string> = {};
    const counted = await tx.query<{n: number}>(
      'SELECT count(*)::int AS n FROM expenses WHERE event_id = $1',
      [event.id],
    );
    if ((counted[0]?.n ?? 0) >= MAX_EXPENSES_PER_EVENT) {
      fields.eventId = TOO_MANY_EXPENSES;
    }

    const offerRow = input.offerId
      ? await findOfferRow(tx, org.id, input.offerId)
      : undefined;
    if (input.offerId && !offerRow) fields.offerId = OFFER_UNKNOWN;
    const offer = offerRow ? toFullOffer(offerRow) : null;

    const companyId =
      input.companyId !== undefined
        ? input.companyId
        : (offer?.company.id ?? null);
    const company = companyId
      ? await findCompanyWithTax(tx, org.id, companyId)
      : undefined;
    if (companyId && !company) fields.companyId = COMPANY_NOT_FOUND;

    const concept = input.concept ?? offer?.name ?? null;
    if (!concept) fields.concept = CONCEPT_REQUIRED;
    throwIfFields(fields);

    const snapshot = offer ? snapshotOf(offer, now.toISOString()) : null;
    const tax =
      input.tax !== undefined
        ? input.tax
        : offer
          ? effectiveTax(offer)
          : (company?.tax ?? null);
    const amount =
      input.amount !== undefined
        ? input.amount
        : offer
          ? priceEstimate(offer).beforeTax
          : null;

    const inserted = await tx.query<{id: string}>(
      `INSERT INTO expenses
         (organization_id, event_id, concept, company_id, company_name, amount,
          tax_regime, tax_name, tax_rate, tax_verification, status,
          offer_snapshot, notes, source, verification, is_demo,
          created_by, created_at, updated_by, updated_at, id)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9::numeric, $10, $11,
               $12::jsonb, $13, $14, $15, $16,
               $17, $18::timestamptz, $17, $18::timestamptz,
               COALESCE($19::uuid, gen_random_uuid()))
       RETURNING id`,
      [
        org.id,
        event.id,
        concept,
        company?.id ?? null,
        company?.name ?? null,
        amount,
        ...taxParams(tax),
        input.status ?? 'planned',
        snapshot ? JSON.stringify(snapshot) : null,
        input.notes ?? null,
        input.source ?? null,
        input.verification ?? 'draft',
        event.is_demo,
        actor.id,
        now.toISOString(),
        input.id ?? null,
      ],
    );
    const id = (inserted[0] as {id: string}).id;
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'expense',
      entityId: id,
      entityLabel: concept as string,
      action: 'create',
      at: now,
      isDemo: event.is_demo,
    });
    return fresh(toExpense((await loadExpense(tx, id)) as ExpenseRow));
  });
}

/** Updates an expense at the given version; its snapshot never changes. */
export async function updateExpense(
  db: Db,
  actor: SessionUser,
  id: string,
  input: UpdateExpenseBody,
  now: Date,
): Promise<Expense> {
  return db.transaction(async tx => {
    const {org} = await expenseAccess(tx, actor, id, 'budget.edit');
    await lockCatalogue(tx, org.id);
    const row = await loadExpense(tx, id, true);
    if (!row) throw expenseNotFound();
    if (row.version !== input.version) throw staleExpense(row);

    const before = stateOf(row);
    const after: ExpenseState = {...before};
    if (input.concept !== undefined) after.concept = input.concept;
    if (input.amount !== undefined) after.amount = input.amount;
    if (input.status !== undefined) after.status = input.status;
    if (input.notes !== undefined) after.notes = input.notes;
    if (input.source !== undefined) after.source = input.source;
    if (input.verification !== undefined) {
      after.verification = input.verification;
    }
    if (input.tax !== undefined) after.tax = input.tax;

    const fields: Record<string, string> = {};
    if (input.companyId !== undefined && input.companyId !== row.company_id) {
      if (input.companyId === null) {
        after.companyId = null;
        after.companyName = null;
      } else {
        const company = await findCompanyWithTax(tx, org.id, input.companyId);
        if (company) {
          after.companyId = company.id;
          after.companyName = company.name;
        } else {
          fields.companyId = COMPANY_NOT_FOUND;
        }
      }
      after.company = companyKey(after.companyId, after.companyName);
    }
    throwIfFields(fields);

    const changed = changedFields(before, after, FIELD_NAMES);
    if (!sameTax(before.tax, after.tax)) changed.push('tax');
    if (changed.length === 0) return toExpense(row);

    await tx.query(
      `UPDATE expenses
          SET concept = $3, company_id = $4, company_name = $5,
              amount = $6::numeric, tax_regime = $7, tax_name = $8,
              tax_rate = $9::numeric, tax_verification = $10, status = $11,
              notes = $12, source = $13, verification = $14,
              version = version + 1, updated_by = $15, updated_at = $16::timestamptz
        WHERE id = $1 AND version = $2`,
      [
        id,
        input.version,
        after.concept,
        after.companyId,
        after.companyName,
        after.amount,
        ...taxParams(after.tax),
        after.status,
        after.notes,
        after.source,
        after.verification,
        actor.id,
        now.toISOString(),
      ],
    );
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'expense',
      entityId: id,
      entityLabel: after.concept,
      action: 'update',
      changedFields: changed,
      at: now,
      isDemo: row.is_demo,
    });
    return toExpense((await loadExpense(tx, id)) as ExpenseRow);
  });
}

export async function deleteExpense(
  db: Db,
  actor: SessionUser,
  id: string,
  version: number,
  now: Date,
): Promise<void> {
  await db.transaction(async tx => {
    const {org} = await expenseAccess(tx, actor, id, 'budget.edit');
    await lockCatalogue(tx, org.id);
    const row = await loadExpense(tx, id, true);
    if (!row) throw expenseNotFound();
    if (row.version !== version) throw staleExpense(row);
    await tx.query('DELETE FROM expenses WHERE id = $1', [id]);
    await appendActivity(tx, {
      organizationId: org.id,
      userId: actor.id,
      entityType: 'expense',
      entityId: id,
      entityLabel: row.concept,
      action: 'delete',
      at: now,
      isDemo: row.is_demo,
    });
  });
}
