import {describe, expect, it} from 'vitest';
import {
  compareOffer,
  comparisonKey,
  costLines,
  formatEuros,
  pendingExtras,
  priceLabel,
} from '../../../shared/logistics/catalogue';
import {
  contactShareText,
  mailtoHref,
  phoneInfo,
  shareableFields,
  telHref,
  whatsappHref,
} from '../../../shared/logistics/contact-links';
import {
  missingForCompany,
  missingForContact,
  missingForOffer,
} from '../../../shared/logistics/quality';
import {
  isPlausibleEmail,
  isPlausiblePhone,
  isValidAmount,
} from '../../../shared/logistics/rules';
import {
  findLookAlikes,
  namesLookAlike,
  universalSearch,
} from '../../../shared/logistics/search';

describe('phones and links', () => {
  it('adds +34 to Spanish national numbers', () => {
    const p = phoneInfo('600 00 00 01')!;
    expect(p.international).toBe('34600000001');
    expect(telHref(p)).toBe('tel:+34600000001');
    expect(whatsappHref(p)).toBe('https://wa.me/34600000001');
    expect(p.warning).toBeNull();
  });

  it('keeps an explicit country code and accepts 00', () => {
    expect(phoneInfo('+44 20 7946 0000')!.international).toBe('442079460000');
    expect(phoneInfo('0034 922 000 000')!.international).toBe('34922000000');
  });

  it('dials short public numbers but never sends them to WhatsApp', () => {
    const p = phoneInfo('010')!;
    expect(telHref(p)).toBe('tel:010');
    expect(whatsappHref(p)).toBeNull();
    expect(p.warning).toBeNull();
  });

  it('warns about incomplete numbers and unknown countries', () => {
    expect(phoneInfo('600 000')!.warning).toMatch(/incompleto/);
    expect(phoneInfo('+34 600 000')!.warning).toMatch(/incompleto/);
    const foreign = phoneInfo('0123456789')!;
    expect(foreign.international).toBeNull();
    expect(foreign.warning).toMatch(/prefijo/);
    expect(phoneInfo('sin número')).toBeNull();
  });

  it('asks for the 34 after a bare + and spots two numbers in one field', () => {
    const bare = phoneInfo('+600 000 000')!;
    expect(bare.warning).toMatch(/Falta el 34/);
    expect(whatsappHref(bare)).toBeNull();
    expect(whatsappHref(phoneInfo('+34 600 000')!)).toBeNull();
    const two = phoneInfo('000 00 00 00 / 000 00 00 01')!;
    expect(two.warning).toMatch(/dos números/);
    expect(two.international).toBeNull();
    expect(phoneInfo('+34 000 000 001')!.warning).toBeNull();
  });

  it('builds mailto links without breaking the address', () => {
    expect(mailtoHref(' ana@example.com ')).toBe('mailto:ana@example.com');
    expect(mailtoHref('ana@example.com', 'Montaje 2 dic')).toBe(
      'mailto:ana@example.com?subject=Montaje%202%20dic',
    );
  });

  it('validates phones, e-mails and amounts at the boundary', () => {
    expect(isPlausiblePhone('000 00 00 00')).toBe(true);
    expect(isPlausiblePhone('+34 (000) 00-00-01')).toBe(true);
    expect(isPlausiblePhone('112')).toBe(true);
    expect(isPlausiblePhone('mañana lo paso')).toBe(false);
    expect(isPlausiblePhone('12')).toBe(false);
    expect(isPlausibleEmail('ana@example.com')).toBe(true);
    expect(isPlausibleEmail('ana@example')).toBe(false);
    expect(isValidAmount(0)).toBe(true);
    expect(isValidAmount(12.5)).toBe(true);
    expect(isValidAmount(12.345)).toBe(false);
    expect(isValidAmount(-1)).toBe(false);
    expect(isValidAmount(Number.NaN)).toBe(false);
  });
});

describe('sharing a contact', () => {
  const c = {
    name: 'Ana Demo',
    role: 'Coordinadora',
    company: {id: 'k1', name: 'Carpas Demo'},
    phone: '600 000 001',
    email: 'ana@example.com',
  };

  it('includes only the chosen fields, in card order', () => {
    expect(contactShareText(c, ['phone', 'name'])).toBe(
      'Ana Demo\nTeléfono: 600 000 001',
    );
    expect(contactShareText(c, ['name', 'role', 'company', 'email'])).toBe(
      'Ana Demo · Coordinadora · Carpas Demo\nCorreo: ana@example.com',
    );
  });

  it('offers only fields that have a value', () => {
    expect(shareableFields({...c, email: null, role: null})).toEqual([
      'name',
      'company',
      'phone',
    ]);
  });
});

describe('catalogue honesty', () => {
  const base = {
    id: 'o1',
    name: 'Carpa 3×3',
    categoryId: 'carpas',
    unit: 'day' as const,
    customUnit: null,
    price: 120,
    vatIncluded: true as boolean | null,
    transportCost: null,
    assemblyCost: 40,
    maintenanceCost: null,
    restricted: false,
  };

  it('formats euros the Spanish way', () => {
    expect(formatEuros(1250).replace(/\s/g, ' ')).toBe('1250 €');
    expect(formatEuros(12345).replace(/\s/g, ' ')).toBe('12.345 €');
    expect(formatEuros(12.5).replace(/\s/g, ' ')).toBe('12,50 €');
    expect(priceLabel(base)!.replace(/\s/g, ' ')).toBe('120 € / día');
    expect(priceLabel({...base, price: null})).toBeNull();
  });

  it('never invents a total: lines stay apart and unknowns stay null', () => {
    const lines = costLines(base);
    expect(lines.map(l => l.amount)).toEqual([120, null, 40, null]);
    expect(lines).toHaveLength(4);
    expect(pendingExtras(base)).toEqual(['transporte', 'mantenimiento']);
    expect(pendingExtras({...base, restricted: true})).toEqual([]);
  });

  it('compares only offers of the same category and unit', () => {
    const offers = [
      base,
      {...base, id: 'o2', name: 'Carpa B', price: 90},
      {
        ...base,
        id: 'o3',
        name: 'Carpa por metro',
        unit: 'metre' as const,
        price: 5,
      },
      {...base, id: 'o4', name: 'Carpa sin precio', price: null},
      {
        ...base,
        id: 'o5',
        name: 'Otra categoría',
        categoryId: 'vallas',
        price: 1,
      },
    ];
    const cmp = compareOffer(base, offers)!;
    expect(cmp.peers.map(o => o.id)).toEqual(['o2', 'o1']);
    expect(cmp.position).toBe(2);
    expect(cmp.unpriced.map(o => o.id)).toEqual(['o4']);
    expect(cmp.otherTax).toEqual([]);
  });

  it('never ranks prices with a different or unknown tax treatment', () => {
    const offers = [
      base,
      {...base, id: 'o2', name: 'Sin impuestos', price: 95, vatIncluded: false},
      {
        ...base,
        id: 'o3',
        name: 'Impuestos sin saber',
        price: 80,
        vatIncluded: null,
      },
      {...base, id: 'o4', name: 'Con impuestos', price: 130},
    ];
    const cmp = compareOffer(base, offers)!;
    expect(cmp.peers.map(o => o.id)).toEqual(['o1', 'o4']);
    expect(cmp.position).toBe(1);
    expect(cmp.otherTax.map(o => o.id)).toEqual(['o3', 'o2']);

    const unknown = compareOffer(offers[2], offers)!;
    expect(unknown.peers).toEqual([]);
    expect(unknown.position).toBeNull();
    expect(unknown.otherTax.map(o => o.id)).toEqual(['o2', 'o1', 'o4']);
  });

  it('has nothing to compare without a category or a known custom unit', () => {
    expect(compareOffer({...base, categoryId: null}, [base])).toBeNull();
    expect(
      comparisonKey({...base, unit: 'custom', customUnit: null}),
    ).toBeNull();
    expect(
      comparisonKey({...base, unit: 'custom', customUnit: 'Por escenario'}),
    ).toBe(comparisonKey({...base, unit: 'custom', customUnit: 'escenario'}));
  });

  it('a «kg» billing unit is only wording', () => {
    const kg = {...base, unit: 'custom' as const, customUnit: 'kg', price: 2};
    expect(priceLabel(kg)!.replace(/\s/g, ' ')).toBe('2 € / kg');
    expect(Object.keys(kg)).not.toContain('heavyLoad');
  });
});

describe('quality with withheld fields', () => {
  it('does not ask a guest for data it cannot see', () => {
    const contact = {phone: null, email: null, role: 'Jefe', company: null};
    expect(missingForContact(contact)).toEqual([
      'teléfono o correo',
      'empresa o entidad',
    ]);
    expect(missingForContact({...contact, restricted: true})).toEqual([
      'empresa o entidad',
    ]);
    expect(
      missingForCompany({
        phone: null,
        email: null,
        mainContactId: null,
        categoryIds: [],
        restricted: true,
      }),
    ).toEqual(['persona responsable', 'categoría']);
    expect(
      missingForOffer({
        price: null,
        unit: 'day',
        customUnit: null,
        categoryId: null,
        restricted: true,
      }),
    ).toEqual(['categoría']);
  });
});

describe('possible duplicates', () => {
  it('spots the same company written differently', () => {
    expect(namesLookAlike('Carpas Prueba', 'Carpas de Prueba, S.L.')).toBe(
      true,
    );
    expect(namesLookAlike('Vallas Prueba Norte', 'Valas Prueba Norte')).toBe(
      true,
    );
    expect(namesLookAlike('Prueba Carpas', 'Carpas Prueba')).toBe(true);
    expect(namesLookAlike('Áreas de Pruebas', 'areas pruebas')).toBe(true);
  });

  it('does not flag a single shared word', () => {
    expect(namesLookAlike('Carpas', 'Carpas Prueba')).toBe(false);
    expect(namesLookAlike('Sonido Norte', 'Sonido Sur')).toBe(false);
  });

  it('lists exact matches first and skips the record being edited', () => {
    const list = [
      {id: '1', name: 'Carpas de Prueba'},
      {id: '2', name: 'Carpas Prueba'},
      {id: '3', name: 'Vallas Prueba'},
    ];
    expect(findLookAlikes('carpas prueba', list).map(c => c.id)).toEqual([
      '2',
      '1',
    ]);
    expect(
      findLookAlikes('Carpas Prueba', list, {excludeId: '2'}).map(c => c.id),
    ).toEqual(['1']);
    expect(findLookAlikes('  ', list)).toEqual([]);
  });
});

describe('universal search', () => {
  const sources = {
    categories: [
      {id: 'carpas', name: 'Carpas'},
      {id: 'sonido', name: 'Sonido'},
    ],
    companies: [
      {
        id: 'k1',
        name: 'Carpas Demo',
        kind: 'supplier' as const,
        categoryIds: ['carpas'],
      },
      {
        id: 'k2',
        name: 'Concejalía Demo',
        kind: 'public_body' as const,
        categoryIds: [],
      },
    ],
    contacts: [
      {
        id: 'p1',
        name: 'Ana Demo',
        role: 'Coordinadora',
        company: {id: 'k1', name: 'Carpas Demo'},
        description: 'Lleva las carpas grandes',
      },
    ],
    offers: [
      {
        id: 'o1',
        name: 'Carpa 6×6',
        company: {id: 'k1', name: 'Carpas Demo'},
        categoryId: 'carpas',
        description: null,
      },
      {
        id: 'o2',
        name: 'Equipo de sonido',
        company: {id: 'k3', name: 'Sonido Demo'},
        categoryId: 'sonido',
        description: null,
      },
    ],
    events: [
      {
        id: 'e1',
        name: 'Navidad en la Plaza',
        venue: {id: 'v1', name: 'Plaza del Cristo'},
      },
    ],
    tasks: [
      {
        id: 't1',
        title: 'Montaje de carpas',
        venue: {id: 'v1', name: 'Plaza del Cristo'},
        company: {id: 'k1', name: 'Carpas Demo'},
      },
    ],
    venues: [{id: 'v1', name: 'Plaza del Cristo', address: null}],
  };

  it('finds across types, accent-insensitive', () => {
    const hits = universalSearch('concejalia', sources);
    expect(hits[0]).toMatchObject({type: 'company', id: 'k2'});
    expect(hits[0].subtitle).toBe('Organismo público');
    const carpas = universalSearch('carpas', sources).map(
      h => `${h.type}:${h.id}`,
    );
    expect(carpas).toEqual(
      expect.arrayContaining([
        'company:k1',
        'contact:p1',
        'offer:o1',
        'task:t1',
      ]),
    );
  });

  it('matches by category name and filters by category and type', () => {
    expect(
      universalSearch('sonido', sources, {types: ['offer']}).map(h => h.id),
    ).toEqual(['o2']);
    const inCarpas = universalSearch('demo', sources, {categoryId: 'carpas'});
    expect(inCarpas.map(h => h.id).sort()).toEqual(['k1', 'o1']);
  });

  it('lists a filter with an empty query, and nothing without one', () => {
    expect(universalSearch('', sources)).toEqual([]);
    expect(
      universalSearch('', sources, {types: ['venue']}).map(h => h.id),
    ).toEqual(['v1']);
  });

  it('subtitles never quote free-text descriptions', () => {
    const hit = universalSearch('grandes', sources)[0];
    expect(hit).toMatchObject({type: 'contact', id: 'p1'});
    expect(hit.subtitle).toBe('Coordinadora · Carpas Demo');
  });
});
