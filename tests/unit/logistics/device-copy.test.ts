import {describe, expect, it} from 'vitest';
import {
  forDevice,
  fromDevice,
  withoutBudgetActivity,
} from '../../../src/logistics/store/device-copy';

/**
 * What of the Gestor's lists may rest on the device: redacted like the API
 * (role and directory access), and never the budget's activity entries.
 */

const activity = [
  {id: 'a1', entityType: 'task', entityLabel: 'Montar carpa'},
  {id: 'a2', entityType: 'budget', entityLabel: 'Presupuesto'},
  {id: 'a3', entityType: 'expense', entityLabel: 'Grupo electrógeno'},
  {id: 'a4', entityType: 'event', entityLabel: 'Concierto'},
];

const contact = {
  id: 'p1',
  name: 'Ana Pérez',
  phone: '600 000 000',
  email: 'ana@example.org',
  description: 'Montadora',
  notes: 'Llamar antes de las 9',
};

describe('device copy · activity', () => {
  it('drops budget and expense entries before saving, for any viewer', () => {
    const saved = forDevice('activity', activity, 'member', true);
    expect(saved.map(a => (a as {id: string}).id)).toEqual(['a1', 'a4']);
  });

  it('drops them again when an older copy is read', () => {
    expect(fromDevice('activity', activity).map(a => a.id)).toEqual([
      'a1',
      'a4',
    ]);
  });

  it('leaves other lists as they are when read', () => {
    const tasks = [{id: 't1', entityType: 'budget'}];
    expect(fromDevice('tasks', tasks)).toEqual(tasks);
  });

  it('tolerates entries without a type', () => {
    expect(withoutBudgetActivity([null, {id: 'x'}])).toEqual([null, {id: 'x'}]);
  });
});

describe('device copy · withholding like the API', () => {
  it('a member with the directory keeps the contact whole', () => {
    const [saved] = forDevice('contacts', [contact], 'member', true) as Record<
      string,
      unknown
    >[];
    expect(saved).toMatchObject({phone: '600 000 000', restricted: false});
  });

  it('a member without the directory keeps what the API sends it', () => {
    const [saved] = forDevice('contacts', [contact], 'member', false) as Record<
      string,
      unknown
    >[];
    expect(saved).toMatchObject({
      phone: null,
      email: null,
      notes: null,
      restricted: true,
    });
  });

  it('a guest never keeps withheld values, whatever the flag says', () => {
    const [saved] = forDevice('contacts', [contact], 'guest', true) as Record<
      string,
      unknown
    >[];
    expect(saved).toMatchObject({phone: null, restricted: true});
  });

  it('lists without withheld fields pass through', () => {
    const venues = [{id: 'v1', name: 'Plaza del Cristo'}];
    expect(forDevice('venues', venues, 'guest', false)).toEqual(venues);
  });
});
