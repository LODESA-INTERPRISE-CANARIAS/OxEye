/**
 * Presentation helpers for contacts, companies and the catalogue: ordering,
 * alphabetical groups, euro inputs typed the Spanish way, and the records
 * related to a company. No React, no store. Ranking, look-alikes, price
 * labels and contact links live in `shared/logistics/`.
 */
import type {
  Category,
  Company,
  Contact,
  Offer,
  Task,
  Uuid,
} from '../../../shared/logistics/contracts.ts';
import {isValidAmount} from '../../../shared/logistics/rules.ts';
import {normalize} from '../../../shared/logistics/search.ts';
import {nameKey} from './tasks';

const collator = new Intl.Collator('es', {sensitivity: 'base'});

export function byName<T extends {name: string}>(list: T[]): T[] {
  return [...list].sort((a, b) => collator.compare(a.name, b.name));
}

/** Server order of contacts and companies: by name, ignoring case. */
export const sortContacts = (list: Contact[]) => byName(list);
export const sortCompanies = (list: Company[]) => byName(list);

/** Server order of offers: by company, then name. */
export function sortOffers(list: Offer[]): Offer[] {
  return [...list].sort(
    (a, b) =>
      collator.compare(a.company.name, b.company.name) ||
      collator.compare(a.name, b.name),
  );
}

/**
 * Letter a name is filed under: «Á» with «A», «Ñ» on its own (as in a
 * Spanish address book), digits and symbols under «#».
 */
export function letterOf(name: string): string {
  // Checked before normalising, which folds «ñ» into «n».
  if (name.trim().charAt(0).toLocaleLowerCase('es-ES') === 'ñ') return 'Ñ';
  const first = normalize(name).charAt(0);
  if (/[a-z]/.test(first)) return first.toUpperCase();
  return '#';
}

export interface LetterGroup<T> {
  letter: string;
  items: T[];
}

/** Groups an already sorted list by first letter, keeping its order. */
export function groupByLetter<T extends {name: string}>(
  list: T[],
): LetterGroup<T>[] {
  const groups: LetterGroup<T>[] = [];
  for (const item of list) {
    const letter = letterOf(item.name);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.items.push(item);
    else groups.push({letter, items: [item]});
  }
  // «#» goes last, like a phone's address book.
  const hash = groups.findIndex(g => g.letter === '#');
  if (hash >= 0 && hash < groups.length - 1) {
    groups.push(...groups.splice(hash, 1));
  }
  return groups;
}

// ---------------------------------------------------------------- euros

/**
 * Reads an amount typed on a Spanish keyboard: «85,50», «1.250», «1.250,5»,
 * «12.5», «0.500», with or without «€» and spaces. Empty → null (unknown,
 * never 0). Anything else → NaN, which the form reports.
 */
export function parseEuros(text: string): number | null {
  const raw = text.replace(/€|\s/g, '');
  if (!raw) return null;
  let canonical: string;
  if (raw.includes(',')) {
    // Comma decimals; dots can only be thousands separators.
    if (!/^\d{1,3}(\.\d{3})*,\d*$|^\d+,\d*$/.test(raw)) return NaN;
    canonical = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^0\.\d+$/.test(raw)) {
    // «0.500» is half a euro: nobody writes thousands after a zero.
    canonical = raw;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    // «1.250»: thousands, as written in Spain.
    canonical = raw.replace(/\./g, '');
  } else if (/^\d+(\.\d*)?$/.test(raw)) {
    canonical = raw;
  } else {
    return NaN;
  }
  const value = Number(canonical);
  return Number.isFinite(value) ? value : NaN;
}

/** «85,5» → problem message, or null when the text is a valid amount or empty. */
export function euroProblem(text: string): string | null {
  const value = parseEuros(text);
  if (value === null) return null;
  if (Number.isNaN(value)) {
    return 'Escribe un importe en euros, por ejemplo 120 o 85,50.';
  }
  if (!isValidAmount(value)) {
    return 'El importe tiene que estar entre 0 y 10.000.000 € y tener como mucho dos decimales.';
  }
  return null;
}

/** An amount as the input shows it: 1250.5 → «1250,50», 120 → «120». */
export function eurosForInput(amount: number | null): string {
  if (amount === null) return '';
  return Number.isInteger(amount)
    ? String(amount)
    : amount.toFixed(2).replace('.', ',');
}

// ---------------------------------------------------------------- relations

/** A company's people, by name. */
export function contactsOfCompany(contacts: Contact[], id: Uuid): Contact[] {
  return contacts.filter(c => c.company?.id === id);
}

export function offersOfCompany(offers: Offer[], id: Uuid): Offer[] {
  return offers.filter(o => o.company.id === id);
}

export function tasksOfCompany(tasks: Task[], id: Uuid): Task[] {
  return tasks.filter(t => t.company?.id === id);
}

export function tasksOfContact(tasks: Task[], id: Uuid): Task[] {
  return tasks.filter(t => t.contact?.id === id);
}

/** The company a typed name resolves to (case-insensitive), as the server does. */
export function companyByName(
  companies: Company[],
  name: string,
): Company | null {
  const key = nameKey(name);
  if (!key) return null;
  return companies.find(c => nameKey(c.name) === key) ?? null;
}

/** Category names by id, for chips and labels. */
export function categoryNames(categories: Category[]): Map<Uuid, string> {
  return new Map(categories.map(c => [c.id, c.name]));
}

/** Service categories in display order (the server's: built-ins, then custom). */
export function serviceCategories(categories: Category[]): Category[] {
  return categories.filter(c => c.scope === 'service');
}
