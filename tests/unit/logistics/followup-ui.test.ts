import {describe, expect, it} from 'vitest';
import {analyzeDelay} from '../../../shared/logistics/followup';
import type {Task} from '../../../shared/logistics/contracts';
import type {WorkOrder} from '../../../shared/logistics/work-order';
import {
  canDelay,
  delayCandidates,
  groupDay,
  lateFlag,
  minutesUntilNext,
} from '../../../src/logistics/followup/day';
import {
  amountText,
  hypothesisChipLabel,
  hypothesisSummary,
  marginText,
  parseDelayMinutes,
  slotText,
} from '../../../src/logistics/followup/text';
import {
  clashChoice,
  fieldList,
  mergeFieldLabel,
  mergeForm,
  mergeValueText,
} from '../../../src/logistics/forms/merge';
import {
  defaultOrderDay,
  generatedAtText,
  MAILTO_MAX,
  MAILTO_SHORT_BODY,
  orderDays,
  orderDaysLabel,
  orderMailto,
  orderWhatsapp,
  tasksOnDay,
  WHATSAPP_SHORT_TEXT,
} from '../../../src/logistics/orders/text';
import {
  SUBSOIL_MERGE_NOTE,
  subsoilAfterMerge,
} from '../../../src/logistics/tasks/subsoil';
import {phoneInfo} from '../../../shared/logistics/contact-links';

/** December in Canarias is UTC+0: the wall clock equals UTC. */
const at = (hhmm: string, day = '02') => `2026-12-${day}T${hhmm}:00.000Z`;
const ms = (hhmm: string) => Date.parse(at(hhmm));
const user = {id: 'u1', displayName: 'Elvis Demo'};

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    version: 1,
    createdBy: user,
    createdAt: at('07:00'),
    updatedBy: user,
    updatedAt: at('07:00'),
    source: null,
    verification: 'draft',
    isDemo: false,
    organizationId: 'org',
    id,
    eventId: null,
    venue: {id: 'v1', name: 'Plaza del Cristo'},
    title: id,
    kind: 'assembly',
    status: 'planned',
    date: '2026-12-02',
    endDate: null,
    startsAt: at('09:00'),
    endsAt: at('10:00'),
    timezone: 'Atlantic/Canary',
    company: null,
    contact: null,
    dependsOn: [],
    heavyLoad: false,
    resourceIds: [],
    subsoilReview: null,
    notes: null,
    restricted: false,
    ...extra,
  } as Task;
}

describe('la jornada: groupDay', () => {
  const now = ms('10:30');
  const tasks = [
    task('late-start', {startsAt: at('08:00'), endsAt: at('13:00')}),
    task('overrun', {
      status: 'in_progress',
      startsAt: at('08:00'),
      endsAt: at('10:00'),
    }),
    task('running', {
      status: 'in_progress',
      startsAt: at('10:00'),
      endsAt: at('12:00'),
    }),
    task('grace', {startsAt: at('10:27'), endsAt: at('11:00')}),
    task('next-a', {startsAt: at('11:00'), endsAt: at('12:00')}),
    task('next-b', {startsAt: at('11:00'), endsAt: at('11:30')}),
    task('later', {startsAt: at('17:30'), endsAt: at('18:30')}),
    task('untimed', {startsAt: null, endsAt: null}),
    task('done', {status: 'done'}),
    task('cancelled', {status: 'cancelled'}),
  ];
  const g = groupDay(tasks, now);
  const ids = (list: {task: Task}[]) => list.map(i => i.task.id);

  it('puts each task in one group, late first', () => {
    expect(ids(g.late)).toEqual(['late-start', 'overrun']);
    expect(ids(g.now)).toEqual(['running', 'grace']);
    expect(ids(g.next)).toEqual(['next-a', 'next-b']);
    expect(ids(g.later)).toEqual(['later']);
    expect(ids(g.untimed)).toEqual(['untimed']);
    expect(ids(g.done)).toEqual(['done', 'cancelled']);
  });

  it('flags lateness in plain words', () => {
    expect(g.late[0].flag).toBe('+2 h 30 min');
    expect(g.late[1].flag).toBe('Se alarga 30 min');
    expect(g.now.find(i => i.task.id === 'grace')?.flag).toBe(
      'Debería empezar',
    );
    expect(lateFlag({kind: 'late_start', minutes: 20})).toBe('+20 min');
  });

  it('counts down to the next tasks', () => {
    expect(minutesUntilNext(g, now)).toBe(30);
  });

  it('offers «¿Y si…?» only for timed, unfinished tasks', () => {
    const c = delayCandidates(g).map(t => t.id);
    expect(c).toContain('late-start');
    expect(c).not.toContain('untimed');
    expect(c).not.toContain('done');
    expect(canDelay(task('x', {startsAt: null}))).toBe(false);
  });
});

describe('hypothesis texts', () => {
  it('formats amounts, slots and the minutes field', () => {
    expect(amountText(15, true)).toBe('≈ 15 min');
    expect(amountText(60, false)).toBe('1 h');
    expect(slotText(at('08:15'), at('13:15'))).toBe('08:15–13:15');
    expect(slotText(at('22:00'), at('01:00', '03'))).toBe(
      '22:00–01:00 (+1 día)',
    );
    expect(slotText(at('08:00'), at('18:00', '04'))).toBe(
      '2 dic 08:00 – 4 dic 18:00',
    );
    expect(slotText(null, null)).toBe('Sin hora');
    expect(parseDelayMinutes(' 45 ')).toEqual({value: 45, error: null});
    expect(parseDelayMinutes('0').error).toMatch(/entre 1 y 1440/);
    expect(parseDelayMinutes('1441').value).toBeNull();
    expect(parseDelayMinutes('15.5').value).toBeNull();
  });

  it('summarises what moves and the margin before it', () => {
    const tasks = [
      task('Camión Demo', {
        id: 'a',
        startsAt: at('08:00'),
        endsAt: at('09:00'),
      }),
      task('Montaje', {
        id: 'b',
        startsAt: at('09:10'),
        endsAt: at('11:00'),
        dependsOn: ['a'],
      }),
    ].map(t => ({...t, title: t.id === 'a' ? 'Camión Demo' : 'Montaje'}));
    const analysis = analyzeDelay({tasks, rootId: 'a', minutes: 30});
    const text = hypothesisSummary({
      title: 'Camión Demo',
      minutes: 30,
      estimated: true,
      analysis,
    });
    expect(text).toBe(
      'Si «Camión Demo» empieza ≈ 30 min más tarde, se mueve 1 tarea más. Tenía 10 min de margen antes de mover nada más.',
    );
  });

  it('says when a delay enters the event', () => {
    expect(
      marginText({
        eventId: 'e',
        eventName: 'Concierto',
        before: 30,
        after: -15,
      }),
    ).toEqual({text: 'Entra 15 min en el horario de «Concierto».', over: true});
    expect(
      marginText({eventId: 'e', eventName: 'Concierto', before: 60, after: 45})
        .over,
    ).toBe(false);
  });

  it('labels a saved hypothesis without its note', () => {
    const label = hypothesisChipLabel(
      {
        delayMinutes: 15,
        mode: 'shift',
        estimated: true,
        taskTitle: 'Camión Demo',
        createdBy: {id: 'u1', displayName: 'Elvis'},
        createdAt: at('10:32'),
      },
      '2026-12-02',
    );
    expect(label).toMatch(/15 min/);
    expect(label).toMatch(/Camión Demo/);
    expect(label.endsWith('Elvis, 10:32')).toBe(true);
  });
});

describe('form merge after a 409', () => {
  const base = {
    title: 'Montaje',
    venueName: 'Plaza',
    notes: '',
    status: 'planned',
    date: '2026-12-02',
    endDate: '',
    multiDay: false,
    startTime: '08:00',
    endTime: '10:00',
  };

  it('takes their fields, keeps mine and folds date and times together', () => {
    const mine = {...base, title: 'Montaje escenario', startTime: '09:00'};
    const theirs = {
      ...base,
      venueName: 'Plaza del Adelantado',
      endTime: '11:00',
    };
    const r = mergeForm(base, mine, theirs);
    expect(r.merged.title).toBe('Montaje escenario');
    expect(r.merged.venueName).toBe('Plaza del Adelantado');
    // Both touched the slot: one clash, mine kept until the user chooses.
    expect(r.clashes.map(c => c.key)).toEqual(['slot']);
    expect(r.merged.startTime).toBe('09:00');
    expect(r.merged.endTime).toBe('10:00');
    expect(r.fromTheirs).toEqual(['venueName']);
    const clash = r.clashes[0];
    expect(clashChoice(r.merged, clash)).toBe('mine');
    const chosen = {...r.merged, ...clash.theirs};
    expect(clashChoice(chosen, clash)).toBe('theirs');
    expect(chosen.startTime).toBe('08:00');
    expect(chosen.endTime).toBe('11:00');
  });

  it('describes fields and values in Spanish', () => {
    expect(mergeFieldLabel('slot')).toBe('Fecha y horario');
    expect(mergeFieldLabel('unknownKey')).toBe('Otro dato');
    expect(fieldList(['venueName', 'status', 'notes'])).toBe(
      'Lugar, Estado y Observaciones',
    );
    expect(mergeValueText('slot', base)).toBe('2 dic, 08:00–10:00');
    expect(mergeValueText('notes', {notes: ''})).toBe('vacío');
    expect(mergeValueText('title', {title: 'x'.repeat(80)})).toMatch(/…»$/);
    expect(mergeValueText('status', {status: 'planned'})).toBeNull();
    expect(
      mergeValueText('status', {status: 'planned'}, () => 'Prevista'),
    ).toBe('Prevista');
  });
});

describe('subsoil mark after a 409 merge', () => {
  const form = {
    venueName: 'Plaza del Cristo',
    heavy: 'yes',
    resourceIds: ['r1'],
    subsoilReviewed: false,
    subsoilRedeclare: false,
    notes: '',
  };

  it('resets an earlier tick when they changed the placement', () => {
    const mine = {...form, subsoilReviewed: true, notes: 'Mío'};
    const theirs = {...form, venueName: 'Plaza del Adelantado'};
    const r = subsoilAfterMerge(mergeForm(form, mine, theirs), false);
    expect(r.merged.venueName).toBe('Plaza del Adelantado');
    expect(r.merged.subsoilReviewed).toBe(false);
    expect(r.merged.subsoilRedeclare).toBe(false);
    expect(r.merged.notes).toBe('Mío');
    expect(r.note).toBe(SUBSOIL_MERGE_NOTE);
  });

  it('also resets when both changed the resources, and drops a mark clash', () => {
    const mine = {...form, resourceIds: ['r2'], subsoilRedeclare: true};
    const theirs = {...form, resourceIds: ['r3'], subsoilReviewed: true};
    const r = subsoilAfterMerge(mergeForm(form, mine, theirs), true);
    expect(r.clashes.map(c => c.key)).toEqual(['resourceIds']);
    expect(r.merged.subsoilReviewed).toBe(true);
    expect(r.merged.subsoilRedeclare).toBe(false);
  });

  it('keeps the user tick when the placement did not change', () => {
    const mine = {...form, subsoilReviewed: true};
    const theirs = {...form, notes: 'Suyo'};
    const r = subsoilAfterMerge(mergeForm(form, mine, theirs), false);
    expect(r.merged.subsoilReviewed).toBe(true);
    expect(r.note).toBeNull();
  });
});

describe('work-order helpers', () => {
  const tasks = [
    task('a', {
      date: '2026-12-01',
      startsAt: at('08:00', '01'),
      endsAt: at('09:00', '01'),
    }),
    task('b', {
      date: '2026-12-03',
      startsAt: at('08:00', '03'),
      endsAt: at('09:00', '03'),
    }),
    task('c', {date: null, startsAt: null, endsAt: null}),
  ];

  it('lists days and picks today or the next day with tasks', () => {
    const {days, undated} = orderDays(tasks);
    expect(days).toEqual(['2026-12-01', '2026-12-03']);
    expect(undated).toBe(true);
    expect(defaultOrderDay(days, '2026-12-01')).toBe('2026-12-01');
    expect(defaultOrderDay(days, '2026-12-02')).toBe('2026-12-03');
    expect(defaultOrderDay(days, '2026-12-04')).toBe('all');
    expect(tasksOnDay(tasks, 'undated').map(t => t.id)).toEqual(['c']);
    expect(tasksOnDay(tasks, 'all')).toHaveLength(3);
  });

  it('stamps the order with date, year and time', () => {
    expect(generatedAtText(Date.parse(at('10:32')), 'Atlantic/Canary')).toBe(
      '2 dic 2026, 10:32',
    );
  });

  it('builds a mailto with the order text, or a short one when too long', () => {
    const shortOne = orderMailto('ana@example.com', 'Orden', 'Texto breve');
    expect(shortOne.short).toBe(false);
    expect(shortOne.href).toBe(
      'mailto:ana@example.com?subject=Orden&body=Texto%20breve',
    );
    const long = orderMailto(null, 'Orden', 'x'.repeat(MAILTO_MAX));
    expect(long.short).toBe(true);
    expect(long.href.startsWith('mailto:?subject=Orden&body=')).toBe(true);
    expect(decodeURIComponent(long.href.split('body=')[1])).toBe(
      MAILTO_SHORT_BODY,
    );
    // Without a successful copy, nothing may claim the text was copied.
    expect(long.plainHref).toBe('mailto:?subject=Orden');
  });

  it('guards long WhatsApp links the same way', () => {
    const info = phoneInfo('+34 600 00 00 01')!;
    expect(orderWhatsapp(info, 'Hola')?.short).toBe(false);
    const long = orderWhatsapp(info, 'x'.repeat(MAILTO_MAX))!;
    expect(long.short).toBe(true);
    expect(decodeURIComponent(long.href.split('text=')[1])).toBe(
      WHATSAPP_SHORT_TEXT,
    );
    expect(long.plainHref).not.toMatch(/text=/);
    expect(orderWhatsapp(phoneInfo('010')!, 'Hola')).toBeNull();
  });

  it('labels the days an order covers', () => {
    const order = {
      items: [{day: 'Miércoles, 2 de diciembre de 2026'}, {day: null}],
    } as unknown as WorkOrder;
    expect(orderDaysLabel(order)).toBe('Miércoles, 2 de diciembre de 2026');
  });
});
