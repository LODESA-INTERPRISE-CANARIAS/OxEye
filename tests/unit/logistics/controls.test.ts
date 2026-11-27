import {createElement, Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {
  addMinutes,
  clampDate,
  dateInRange,
  dateLong,
  foldText,
  formatDate,
  monthLabel,
  monthWeeks,
  parseDate,
  parseTime,
  roundTime,
  shiftMonth,
  stepTime,
  weekdayShort,
} from '../../../src/logistics/ui/controls';
import {
  DateField,
  MultiSelectField,
  SelectField,
  TimeField,
  optionsFromChildren,
} from '../../../src/logistics/ui';

// Wednesday.
const TODAY = '2026-11-25';

describe('parseTime', () => {
  it.each([
    ['930', '09:30'],
    ['0930', '09:30'],
    ['9:30', '09:30'],
    ['9.30', '09:30'],
    ['9,30', '09:30'],
    ['9h30', '09:30'],
    ['9 h 30', '09:30'],
    ['9 30', '09:30'],
    ['9', '09:00'],
    ['9:', '09:00'],
    ['21h', '21:00'],
    ['21 h', '21:00'],
    ['21 horas', '21:00'],
    ['2130', '21:30'],
    ['0', '00:00'],
    ['24', '00:00'],
    ['24:00', '00:00'],
    ['  18:05 ', '18:05'],
    ['mediodía', '12:00'],
    ['Medianoche', '00:00'],
  ])('«%s» → %s', (text, value) => {
    expect(parseTime(text)).toBe(value);
  });

  it('empty text is an unknown time', () => {
    expect(parseTime('')).toBe('');
    expect(parseTime('   ')).toBe('');
  });

  it.each(['25', '9:3', '9:60', '24:30', '960', '12345', 'nueve', '9:30:00'])(
    '«%s» is not understood',
    text => {
      expect(parseTime(text)).toBeNull();
    },
  );

  it('«ahora» uses the time it is given', () => {
    expect(parseTime('ahora', '10:35')).toBe('10:35');
    expect(parseTime('ahora')).toBeNull();
  });
});

describe('time steps', () => {
  it('moves to the next or previous multiple of five', () => {
    expect(stepTime('09:07', 1)).toBe('09:10');
    expect(stepTime('09:07', -1)).toBe('09:05');
    expect(stepTime('09:10', 1)).toBe('09:15');
    expect(stepTime('09:10', -1)).toBe('09:05');
  });

  it('wraps around midnight', () => {
    expect(stepTime('23:55', 1)).toBe('00:00');
    expect(stepTime('00:00', -1)).toBe('23:55');
  });

  it('rounds and adds minutes', () => {
    expect(roundTime('09:32')).toBe('09:30');
    expect(roundTime('09:33')).toBe('09:35');
    expect(roundTime('23:58')).toBe('00:00');
    expect(addMinutes('22:30', 120)).toBe('00:30');
  });
});

describe('parseDate', () => {
  it.each([
    ['hoy', '2026-11-25'],
    ['Mañana', '2026-11-26'],
    ['manana', '2026-11-26'],
    ['pasado mañana', '2026-11-27'],
    ['ayer', '2026-11-24'],
    ['2/12', '2026-12-02'],
    ['2-12', '2026-12-02'],
    ['2.12', '2026-12-02'],
    ['02/12/2026', '2026-12-02'],
    ['2-12-2026', '2026-12-02'],
    ['2/12/26', '2026-12-02'],
    ['2026-12-02', '2026-12-02'],
    ['0212', '2026-12-02'],
    ['02122026', '2026-12-02'],
    ['2 dic', '2026-12-02'],
    ['2 de diciembre', '2026-12-02'],
    ['2 de diciembre de 2027', '2027-12-02'],
    ['2 sept', '2026-09-02'],
    ['viernes', '2026-11-27'],
    ['el vie', '2026-11-27'],
    ['miércoles', '2026-11-25'],
    ['lunes', '2026-11-30'],
    ['28', '2026-11-28'],
    ['3', '2026-12-03'],
  ])('«%s» → %s', (text, value) => {
    expect(parseDate(text, TODAY)).toBe(value);
  });

  it('without a year, takes the date closest to today', () => {
    expect(parseDate('5/1', TODAY)).toBe('2027-01-05');
    expect(parseDate('20/11', TODAY)).toBe('2026-11-20');
    expect(parseDate('5/1', '2027-06-30')).toBe('2027-01-05');
    expect(parseDate('29/2', '2027-12-20')).toBe('2028-02-29');
  });

  it.each(['31/11', '29/2/2027', '2/13', '32', 'dicx 2', 'pronto', '2/12/2'])(
    '«%s» is not understood',
    text => {
      expect(parseDate(text, TODAY)).toBeNull();
    },
  );

  it('empty text is an unknown date', () => {
    expect(parseDate('', TODAY)).toBe('');
  });
});

describe('dates for the calendar', () => {
  it('formats the Spanish way', () => {
    expect(formatDate('2026-12-02')).toBe('02/12/2026');
    expect(weekdayShort('2026-12-02')).toBe('mié');
    expect(dateLong('2026-12-02')).toBe('Miércoles, 2 de diciembre de 2026');
    expect(monthLabel('2026-12-15')).toBe('Diciembre 2026');
  });

  it('builds Monday-first weeks', () => {
    const weeks = monthWeeks('2026-12-10');
    // 1 December 2026 is a Tuesday.
    expect(weeks[0]).toEqual([
      null,
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ]);
    expect(weeks.at(-1)).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      null,
      null,
      null,
    ]);
    expect(weeks.every(w => w.length === 7)).toBe(true);
  });

  it('moves by months without overflowing', () => {
    expect(shiftMonth('2027-01-31', 1)).toBe('2027-02-28');
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-15');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('keeps dates inside min and max', () => {
    expect(dateInRange('2026-12-02', '2026-12-03')).toBe(false);
    expect(dateInRange('2026-12-02', undefined, '2026-12-02')).toBe(true);
    expect(clampDate('2026-12-02', '2026-12-03')).toBe('2026-12-03');
    expect(clampDate('2026-12-09', undefined, '2026-12-05')).toBe('2026-12-05');
  });

  it('folds accents and case for search', () => {
    expect(foldText('  Peñón  Árbol ')).toBe('penon arbol');
  });
});

describe('optionsFromChildren', () => {
  it('reads options, groups and fragments like a native select', () => {
    const children = [
      createElement('option', {key: 'n', value: ''}, 'Sin persona'),
      false,
      createElement(
        'optgroup',
        {key: 'g', label: 'De Sonido'},
        createElement('option', {value: 'p1'}, 'Ana', ' · Técnica'),
      ),
      createElement(
        Fragment,
        {key: 'f'},
        createElement('option', {value: 'p2', disabled: true}, 'Luis'),
      ),
    ];
    expect(optionsFromChildren(children)).toEqual([
      {value: '', label: 'Sin persona', disabled: undefined, group: undefined},
      {
        value: 'p1',
        label: 'Ana · Técnica',
        disabled: undefined,
        group: 'De Sonido',
      },
      {value: 'p2', label: 'Luis', disabled: true, group: undefined},
    ]);
  });
});

describe('controls markup', () => {
  const noop = () => {};

  it('time and date keep the id on a text input with the value attached', () => {
    const time = renderToStaticMarkup(
      createElement(TimeField, {id: 't', value: '09:30', onChange: noop}),
    );
    expect(time).toContain('id="t"');
    expect(time).toContain('value="09:30"');
    expect(time).toContain('data-value="09:30"');
    expect(time).toContain('aria-haspopup="dialog"');
    expect(time).toContain('aria-label="Elegir hora, ahora 09:30"');

    const date = renderToStaticMarkup(
      createElement(DateField, {id: 'd', value: '2026-12-02', onChange: noop}),
    );
    expect(date).toContain('value="02/12/2026"');
    expect(date).toContain('data-value="2026-12-02"');
    expect(date).toContain('Miércoles, 2 de diciembre de 2026');
    expect(date).toContain('aria-describedby="d-weekday"');
  });

  it('select is a combobox button showing the chosen label', () => {
    const html = renderToStaticMarkup(
      createElement(SelectField, {
        id: 's',
        value: '',
        emptyLabel: 'Sin evento',
        options: [{value: 'e1', label: 'Fiestas del Cristo'}],
        onChange: noop,
      }),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-value=""');
    expect(html).toContain('Sin evento');
  });

  it('multi-select says «Ninguno» when empty and lists chips otherwise', () => {
    const options = [
      {value: 'a', label: 'Sonido'},
      {value: 'b', label: 'Vallas'},
    ];
    const none = renderToStaticMarkup(
      createElement(MultiSelectField, {
        id: 'm',
        values: [],
        options,
        onChange: noop,
      }),
    );
    expect(none).toContain('Ninguno');
    expect(none).not.toContain('Quitar Sonido');
    const two = renderToStaticMarkup(
      createElement(MultiSelectField, {
        id: 'm',
        values: ['b', 'a'],
        options,
        onChange: noop,
      }),
    );
    expect(two).toContain('aria-label="Quitar Vallas"');
    expect(two).toContain('2 elegidos: Vallas, Sonido');
  });
});
