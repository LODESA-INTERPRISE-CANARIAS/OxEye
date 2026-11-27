/**
 * Fictitious data for the Revisión 1 mock-ups. Companies and people carry
 * «Demo», e-mails use `@example.com` and phones `+34 000 000 0XX`. The pilot
 * accounts keep the first names already used in the product documents (no
 * surnames, no real addresses). Nothing here reaches a server.
 */

/** Fixed «today» of the mock-ups, so every screen tells the same story. */
export const MOCK_TODAY = '2026-11-27';

export const ORG_NAME = 'Ayuntamiento de San Cristóbal de La Laguna';
export const ORG_SHORT = 'Ayuntamiento de La Laguna';

export const EVENT = {
  name: 'Navidad en la Plaza del Cristo',
  venue: 'Plaza del Cristo',
  dates: '11–14 dic',
  from: '2026-12-11',
  to: '2026-12-14',
};

// ---------------------------------------------------------------- F1 offers

export type CategoryId =
  | 'carpas'
  | 'limpieza'
  | 'sonido'
  | 'iluminacion'
  | 'vallas'
  | 'ocio'
  | 'aseos'
  | 'catering'
  | 'transporte'
  | 'personal'
  | 'seguridad'
  | 'otros';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** One line under the card: what we mean. */
  hint: string;
}

export const CATEGORIES: CategoryDef[] = [
  {id: 'carpas', label: 'Carpas', hint: 'Carpas, toldos, jaimas'},
  {id: 'limpieza', label: 'Limpieza', hint: 'Personal y servicio'},
  {id: 'sonido', label: 'Sonido', hint: 'Equipos y técnicos'},
  {id: 'iluminacion', label: 'Iluminación', hint: 'Focos, guirnaldas'},
  {id: 'vallas', label: 'Vallas', hint: 'Vallas y control'},
  {id: 'ocio', label: 'Ocio', hint: 'Hinchables, atracciones'},
  {id: 'aseos', label: 'Aseos portátiles', hint: 'Cabinas y limpieza'},
  {id: 'catering', label: 'Catering', hint: 'Comida y bebida'},
  {id: 'transporte', label: 'Transporte', hint: 'Camiones, furgonetas'},
  {id: 'personal', label: 'Personal', hint: 'Azafatas, montadores'},
  {id: 'seguridad', label: 'Seguridad', hint: 'Vigilancia, control'},
  {id: 'otros', label: 'Otro servicio', hint: 'Lo que no esté arriba'},
];

export const CATEGORY_LABEL: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map(c => [c.id, c.label]),
) as Record<CategoryId, string>;

export interface SupplierDef {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  categories: CategoryId[];
  /** Tax regime recorded for the company, if any. */
  tax: TaxInfo;
  lastOffer?: string;
}

export type TaxKind = 'igic' | 'iva' | 'none' | 'unknown';

export interface TaxInfo {
  kind: TaxKind;
  rate: number | null;
  /** «por verificar» until someone confirms it with the company. */
  verified: boolean;
}

export const TAX_LABEL: Record<TaxKind, string> = {
  igic: 'IGIC',
  iva: 'IVA',
  none: 'Sin impuesto',
  unknown: 'Impuesto sin saber',
};

export function taxText(tax: TaxInfo): string {
  if (tax.kind === 'unknown') return 'Impuesto sin saber';
  if (tax.kind === 'none') return 'Sin impuesto';
  return `${TAX_LABEL[tax.kind]} ${tax.rate ?? '?'} %`;
}

export const SUPPLIERS: SupplierDef[] = [
  {
    id: 's-mario',
    name: 'Carpas Mario Demo',
    contact: 'Mario Demo',
    email: 'mario@example.com',
    phone: '+34 000 000 012',
    categories: ['carpas'],
    tax: {kind: 'igic', rate: 7, verified: true},
    lastOffer: 'Oferta vigente · v3',
  },
  {
    id: 's-toldos',
    name: 'Toldos Atlántico Demo',
    contact: 'Lucía Demo',
    email: 'lucia@example.com',
    phone: '+34 000 000 023',
    categories: ['carpas'],
    tax: {kind: 'iva', rate: 21, verified: false},
    lastOffer: 'Sin ofertas aún',
  },
  {
    id: 's-teide',
    name: 'Eventos Teide Demo',
    contact: 'Andrés Demo',
    email: 'andres@example.com',
    phone: '+34 000 000 034',
    categories: ['carpas', 'iluminacion'],
    tax: {kind: 'igic', rate: 7, verified: true},
    lastOffer: 'Oferta vigente · v1',
  },
  {
    id: 's-lonas',
    name: 'Lonas del Norte Demo',
    contact: 'Rita Demo',
    email: '',
    phone: '+34 000 000 045',
    categories: ['carpas'],
    tax: {kind: 'unknown', rate: null, verified: false},
  },
  {
    id: 's-aguere',
    name: 'Limpiezas Aguere Demo',
    contact: 'Nieves Demo',
    email: 'nieves@example.com',
    phone: '+34 000 000 056',
    categories: ['limpieza'],
    tax: {kind: 'igic', rate: 7, verified: true},
  },
  {
    id: 's-brillo',
    name: 'Brillo Canario Demo',
    contact: 'Óscar Demo',
    email: 'oscar@example.com',
    phone: '+34 000 000 067',
    categories: ['limpieza'],
    tax: {kind: 'igic', rate: 7, verified: false},
  },
  {
    id: 's-risco',
    name: 'Hinchables Risco Demo',
    contact: 'Carmen Demo',
    email: 'carmen@example.com',
    phone: '+34 000 000 078',
    categories: ['ocio'],
    tax: {kind: 'igic', rate: 7, verified: true},
  },
];

/** A concrete need, as it is asked to suppliers and compared. */
export interface NeedDef {
  id: string;
  category: CategoryId;
  /** «3 carpas de 6 × 6 m · 4 jornadas · 11–14 dic». */
  label: string;
  short: string;
  quantity: number;
  quantityUnit: [string, string];
  days: number;
  /** Hours per day, for services paid by the hour. */
  hours?: number;
  dates: string;
  event: string;
  /** Season of the event's dates, to pick seasonal rates. */
  season: 'lluvias' | 'verano' | 'resto';
}

export const NEEDS: NeedDef[] = [
  {
    id: 'n-carpas',
    category: 'carpas',
    label: '3 carpas de 6 × 6 m · 4 jornadas · 11–14 dic',
    short: 'Carpas 6 × 6 m',
    quantity: 3,
    quantityUnit: ['carpa', 'carpas'],
    days: 4,
    dates: '11–14 dic 2026',
    event: EVENT.name,
    season: 'lluvias',
  },
  {
    id: 'n-limpieza',
    category: 'limpieza',
    label: 'Limpieza · 2 personas × 8 h · 4 jornadas',
    short: 'Limpieza',
    quantity: 2,
    quantityUnit: ['persona', 'personas'],
    days: 4,
    hours: 8,
    dates: '11–14 dic 2026',
    event: EVENT.name,
    season: 'lluvias',
  },
  {
    id: 'n-castillo',
    category: 'ocio',
    label: '1 castillo hinchable · 2 jornadas · 13–14 dic',
    short: 'Castillo hinchable',
    quantity: 1,
    quantityUnit: ['castillo', 'castillos'],
    days: 2,
    dates: '13–14 dic 2026',
    event: EVENT.name,
    season: 'lluvias',
  },
];

export type PriceUnit =
  'unit_day' | 'unit_event' | 'hour_person' | 'person_day';

export const PRICE_UNIT_LABEL: Record<PriceUnit, string> = {
  unit_day: 'por unidad y jornada',
  unit_event: 'por unidad, todo el evento',
  hour_person: 'por hora y persona',
  person_day: 'por persona y jornada',
};

export interface SeasonRate {
  season: 'verano' | 'lluvias';
  label: string;
  months: string;
  price: number;
}

export interface OfferExtra {
  label: string;
  /** null = included in the price. */
  amount: number | null;
  per: 'order' | 'unit';
}

export interface OfferVersion {
  version: number;
  price: number;
  from: string;
  until: string;
  state: 'vigente' | 'caducada' | 'sustituida';
  by: string;
  change?: string;
}

export interface MockOffer {
  id: string;
  supplierId: string;
  company: string;
  category: CategoryId;
  product: string;
  needIds: string[];
  version: number;
  unitPrice: number;
  priceUnit: PriceUnit;
  seasonal?: SeasonRate[];
  minimumDays?: number;
  extras: OfferExtra[];
  included: string[];
  notIncluded: string[];
  tax: TaxInfo;
  /** Date until which the offer can be accepted (ISO). */
  acceptUntil: string;
  /** When the supplier can provide the service. */
  serviceWindow: string;
  /** Months (1–12) when it can serve; omitted = all year, null = unknown. */
  serviceMonths?: number[] | null;
  /** Multi-year commitment, if offered. */
  commitment?: {years: number; price: number; note: string};
  availability: string;
  /** False when it does not cover the dates of the need. */
  available: boolean;
  /** A heavy element (ballast, generator) on the venue. */
  heavy?: string;
  source: 'link' | 'manual';
  approvedBy?: string;
  conditions: string;
  versions: OfferVersion[];
}

export const OFFERS: MockOffer[] = [
  {
    id: 'o-teide',
    supplierId: 's-teide',
    company: 'Eventos Teide Demo',
    category: 'carpas',
    product: 'Carpa 6 × 6 m con laterales',
    needIds: ['n-carpas'],
    version: 1,
    unitPrice: 160,
    priceUnit: 'unit_day',
    minimumDays: 5,
    extras: [
      {label: 'Montaje y desmontaje', amount: null, per: 'order'},
      {label: 'Transporte', amount: null, per: 'order'},
    ],
    included: ['Montaje', 'Transporte', 'Laterales'],
    notIncluded: ['Lastres'],
    tax: {kind: 'igic', rate: 7, verified: true},
    acceptUntil: '2027-03-31',
    serviceWindow: 'Todo el año',
    availability: '6 carpas de 6 × 6 m',
    available: true,
    heavy: 'Lastres no incluidos: hay que traerlos y revisar el subsuelo.',
    source: 'link',
    approvedBy: 'Yeray',
    conditions: 'Alquiler mínimo de 5 jornadas. Fianza del 10 %.',
    versions: [
      {
        version: 1,
        price: 160,
        from: '2026-11-26',
        until: '2027-03-31',
        state: 'vigente',
        by: 'Aprobada por Yeray',
      },
    ],
  },
  {
    id: 'o-mario',
    supplierId: 's-mario',
    company: 'Carpas Mario Demo',
    category: 'carpas',
    product: 'Carpa plegable 6 × 6 m',
    needIds: ['n-carpas'],
    version: 3,
    unitPrice: 180,
    priceUnit: 'unit_day',
    seasonal: [
      {
        season: 'verano',
        label: 'Verano',
        months: 'jun – sep',
        price: 165,
      },
      {
        season: 'lluvias',
        label: 'Temporada de lluvias',
        months: 'nov – mar',
        price: 195,
      },
    ],
    extras: [
      {label: 'Montaje y desmontaje', amount: null, per: 'order'},
      {label: 'Transporte', amount: 90, per: 'order'},
    ],
    included: ['Montaje', 'Lastres', 'Laterales'],
    notIncluded: ['Transporte'],
    tax: {kind: 'igic', rate: 7, verified: true},
    acceptUntil: '2026-12-27',
    serviceWindow: 'Todo el año salvo agosto',
    serviceMonths: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12],
    availability: '4 carpas de 6 × 6 m',
    available: true,
    heavy:
      'Lastres de 4 × 25 kg por carpa: revisar el subsuelo en el simulador.',
    source: 'link',
    approvedBy: 'Elvis',
    conditions:
      'Lastres incluidos. Cambios de fecha sin coste hasta 7 días antes.',
    versions: [
      {
        version: 3,
        price: 180,
        from: '2026-10-01',
        until: '2026-12-27',
        state: 'vigente',
        by: 'Aprobada por Elvis',
        change: 'Precio base 170 € → 180 €; añade tarifa de lluvias',
      },
      {
        version: 2,
        price: 170,
        from: '2025-10-01',
        until: '2026-09-30',
        state: 'sustituida',
        by: 'Aprobada por Dailos',
        change: 'Transporte pasa a cobrarse aparte (90 €)',
      },
      {
        version: 1,
        price: 150,
        from: '2024-11-15',
        until: '2025-09-30',
        state: 'caducada',
        by: 'Registrada a mano por Dailos',
      },
    ],
  },
  {
    id: 'o-toldos',
    supplierId: 's-toldos',
    company: 'Toldos Atlántico Demo',
    category: 'carpas',
    product: 'Carpa 6 × 6 m',
    needIds: ['n-carpas'],
    version: 1,
    unitPrice: 170,
    priceUnit: 'unit_day',
    extras: [
      {label: 'Montaje', amount: 40, per: 'unit'},
      {label: 'Transporte', amount: null, per: 'order'},
    ],
    included: ['Transporte', 'Lastres'],
    notIncluded: ['Montaje'],
    tax: {kind: 'iva', rate: 21, verified: false},
    acceptUntil: '2027-02-27',
    serviceWindow: 'Oct – may',
    serviceMonths: [1, 2, 3, 4, 5, 10, 11, 12],
    availability: '3 carpas de 6 × 6 m',
    available: true,
    heavy: 'Lastres incluidos: revisar el subsuelo en el simulador.',
    source: 'link',
    conditions: 'Montaje aparte, 40 € por carpa.',
    versions: [
      {
        version: 1,
        price: 170,
        from: '2026-11-27',
        until: '2027-02-27',
        state: 'vigente',
        by: 'Pendiente de aprobar',
      },
    ],
  },
  {
    id: 'o-lonas',
    supplierId: 's-lonas',
    company: 'Lonas del Norte Demo',
    category: 'carpas',
    product: 'Carpa 6 × 6 m',
    needIds: ['n-carpas'],
    version: 1,
    unitPrice: 150,
    priceUnit: 'unit_day',
    extras: [
      {label: 'Montaje', amount: null, per: 'order'},
      {label: 'Transporte', amount: null, per: 'order'},
    ],
    included: ['Montaje'],
    notIncluded: [],
    tax: {kind: 'unknown', rate: null, verified: false},
    acceptUntil: '2027-01-31',
    serviceWindow: 'Pendiente de verificar',
    serviceMonths: null,
    availability: 'Pendiente de verificar',
    available: true,
    source: 'manual',
    approvedBy: 'Dailos',
    conditions: 'Precio dicho por teléfono. Transporte sin precio.',
    versions: [
      {
        version: 1,
        price: 150,
        from: '2026-11-20',
        until: '2027-01-31',
        state: 'vigente',
        by: 'Registrada a mano por Dailos',
      },
    ],
  },
  {
    id: 'o-sur',
    supplierId: 's-sur',
    company: 'Carpas Sur Demo',
    category: 'carpas',
    product: 'Carpa 6 × 6 m',
    needIds: ['n-carpas'],
    version: 2,
    unitPrice: 140,
    priceUnit: 'unit_day',
    extras: [],
    included: ['Montaje', 'Transporte'],
    notIncluded: [],
    tax: {kind: 'igic', rate: 7, verified: true},
    acceptUntil: '2026-09-30',
    serviceWindow: 'Todo el año',
    availability: '—',
    available: true,
    source: 'manual',
    approvedBy: 'Dailos',
    conditions: '',
    versions: [
      {
        version: 2,
        price: 140,
        from: '2025-10-01',
        until: '2026-09-30',
        state: 'caducada',
        by: 'Aprobada por Dailos',
      },
    ],
  },
  {
    id: 'o-aguere',
    supplierId: 's-aguere',
    company: 'Limpiezas Aguere Demo',
    category: 'limpieza',
    product: 'Limpieza de plaza con material',
    needIds: ['n-limpieza'],
    version: 1,
    unitPrice: 18,
    priceUnit: 'hour_person',
    extras: [{label: 'Material de limpieza', amount: null, per: 'order'}],
    included: ['Material'],
    notIncluded: ['Turno de noche (+25 %)'],
    tax: {kind: 'igic', rate: 7, verified: true},
    acceptUntil: '2027-05-31',
    serviceWindow: 'Todo el año',
    availability: 'Hasta 6 personas',
    available: true,
    source: 'link',
    approvedBy: 'Elvis',
    conditions: 'Suplemento nocturno del 25 % de 22:00 a 06:00.',
    versions: [
      {
        version: 1,
        price: 18,
        from: '2026-06-01',
        until: '2027-05-31',
        state: 'vigente',
        by: 'Aprobada por Elvis',
      },
    ],
  },
  {
    id: 'o-brillo',
    supplierId: 's-brillo',
    company: 'Brillo Canario Demo',
    category: 'limpieza',
    product: 'Operario de limpieza por jornada',
    needIds: ['n-limpieza'],
    version: 1,
    unitPrice: 140,
    priceUnit: 'person_day',
    extras: [],
    included: ['Material', 'Uniforme'],
    notIncluded: [],
    tax: {kind: 'igic', rate: 7, verified: false},
    acceptUntil: '2027-01-15',
    serviceWindow: 'Todo el año',
    availability: '3 personas',
    available: true,
    source: 'link',
    approvedBy: 'Dailos',
    conditions: 'Jornada de 8 horas.',
    versions: [
      {
        version: 1,
        price: 140,
        from: '2026-11-10',
        until: '2027-01-15',
        state: 'vigente',
        by: 'Aprobada por Dailos',
      },
    ],
  },
  {
    id: 'o-risco',
    supplierId: 's-risco',
    company: 'Hinchables Risco Demo',
    category: 'ocio',
    product: 'Castillo hinchable 5 × 5 m con monitor',
    needIds: ['n-castillo'],
    version: 1,
    unitPrice: 300,
    priceUnit: 'unit_day',
    extras: [{label: 'Monitor', amount: null, per: 'order'}],
    included: ['Monitor', 'Montaje', 'Transporte'],
    notIncluded: ['Toma eléctrica (la pone el Ayuntamiento)'],
    tax: {kind: 'igic', rate: 7, verified: true},
    acceptUntil: '2028-11-30',
    serviceWindow: 'Todo el año',
    commitment: {
      years: 5,
      price: 240,
      note: 'Si os comprometéis a contratarlo 5 años (2027–2031), 240 € la jornada.',
    },
    availability: '2 castillos',
    available: true,
    source: 'link',
    conditions: 'Se suspende con viento fuerte o lluvia sin coste.',
    versions: [
      {
        version: 1,
        price: 300,
        from: '2026-11-25',
        until: '2028-11-30',
        state: 'vigente',
        by: 'Pendiente de aprobar',
      },
    ],
  },
];

export interface MockRequest {
  id: string;
  needId: string;
  event: string;
  sentAt: string;
  sentBy: string;
  linkExpires: string;
  recipients: {
    supplierId: string;
    state: 'answered' | 'waiting' | 'declined' | 'not_sent';
  }[];
}

export const REQUESTS: MockRequest[] = [
  {
    id: 'r-carpas',
    needId: 'n-carpas',
    event: EVENT.name,
    sentAt: '27 nov, 09:15',
    sentBy: 'Elvis',
    linkExpires: '4 dic',
    recipients: [
      {supplierId: 's-toldos', state: 'answered'},
      {supplierId: 's-mario', state: 'waiting'},
      {supplierId: 's-teide', state: 'answered'},
    ],
  },
  {
    id: 'r-castillo',
    needId: 'n-castillo',
    event: EVENT.name,
    sentAt: '25 nov, 12:40',
    sentBy: 'Dailos',
    linkExpires: '2 dic',
    recipients: [{supplierId: 's-risco', state: 'answered'}],
  },
];

export type ProposalState = 'pending' | 'approved' | 'rejected';

export interface MockProposal {
  id: string;
  offerId: string;
  state: ProposalState;
  receivedAt: string;
  via: string;
  requestId?: string;
  /** Change against the current version (renegotiation). */
  diff?: string;
  flags: string[];
  decidedBy?: string;
  reason?: string;
}

export const PROPOSALS: MockProposal[] = [
  {
    id: 'p-toldos',
    offerId: 'o-toldos',
    state: 'pending',
    receivedAt: 'Hoy, 10:42',
    via: 'Formulario por enlace',
    requestId: 'r-carpas',
    flags: ['IVA 21 % · por verificar'],
  },
  {
    id: 'p-risco',
    offerId: 'o-risco',
    state: 'pending',
    receivedAt: 'Ayer, 18:05',
    via: 'Formulario por enlace',
    requestId: 'r-castillo',
    flags: ['Compromiso de 5 años'],
  },
  {
    id: 'p-lonas',
    offerId: 'o-lonas',
    state: 'pending',
    receivedAt: '20 nov, 13:10',
    via: 'Registrada a mano por Dailos',
    flags: ['Falta el impuesto', 'Transporte sin precio'],
  },
  {
    id: 'p-teide',
    offerId: 'o-teide',
    state: 'approved',
    receivedAt: '26 nov, 08:30',
    via: 'Formulario por enlace',
    requestId: 'r-carpas',
    flags: [],
    decidedBy: 'Yeray · 26 nov, 11:02',
  },
  {
    id: 'p-mario',
    offerId: 'o-mario',
    state: 'approved',
    receivedAt: '1 oct, 09:00',
    via: 'Formulario por enlace',
    diff: '170 € → 180 € por carpa y jornada',
    flags: [],
    decidedBy: 'Elvis · 1 oct, 12:30',
  },
  {
    id: 'p-sur',
    offerId: 'o-sur',
    state: 'rejected',
    receivedAt: '18 nov, 16:20',
    via: 'Formulario por enlace',
    flags: [],
    decidedBy: 'Dailos · 19 nov, 09:12',
    reason: 'Solo mantenía el precio una semana.',
  },
];

export interface RenewalTask {
  id: string;
  title: string;
  offerId: string;
  company: string;
  expires: string;
  daysLeft: number;
  generatedAt: string;
  assignee: string | null;
  /** Events planned before the expiry that would use this price. */
  affects?: string;
  done?: string;
}

export const RENEWALS: RenewalTask[] = [
  {
    id: 't-aseos',
    title: 'Renegociar aseos portátiles con Aseos Express Demo',
    offerId: 'o-aseos',
    company: 'Aseos Express Demo',
    expires: '9 dic 2026',
    daysLeft: 12,
    generatedAt: '9 nov',
    assignee: 'Dailos',
    affects: `${EVENT.name} (11–14 dic) cae después del vencimiento`,
  },
  {
    id: 't-mario',
    title: 'Renegociar carpas con Carpas Mario Demo',
    offerId: 'o-mario',
    company: 'Carpas Mario Demo',
    expires: '27 dic 2026',
    daysLeft: 30,
    generatedAt: 'hoy',
    // Whoever approved the offer (Elvis); an administrator can change it.
    assignee: 'Elvis',
  },
  {
    id: 't-vallas',
    title: 'Renegociar vallas con Vallas Guanche Demo',
    offerId: 'o-vallas',
    company: 'Vallas Guanche Demo',
    expires: '15 nov 2026',
    daysLeft: 0,
    generatedAt: '16 oct',
    assignee: 'Elvis',
    done: 'Hecha por Elvis · nueva versión v2 aprobada el 12 nov',
  },
];

// ---------------------------------------------------------------- F2 access

export type RoleId = 'admin' | 'developer' | 'team' | 'guest';

export const ROLE_LABEL: Record<RoleId, string> = {
  admin: 'Administrador',
  developer: 'Desarrollador',
  team: 'Equipo',
  guest: 'Invitado',
};

export const ROLE_HINT: Record<RoleId, string> = {
  admin:
    'Ve presupuestos y gastos, aprueba ofertas recibidas y gestiona usuarios.',
  developer:
    'Diagnóstico técnico y contraseñas provisionales. Ve presupuestos (se puede retirar).',
  team: 'Cuenta compartida del equipo: planifica y registra, sin dinero.',
  guest: 'Solo lectura. Sin Contactos ni Catálogo.',
};

export interface MockUser {
  id: string;
  username: string;
  displayName: string;
  roles: RoleId[];
  description?: string;
  provisional: boolean;
  email: {address: string; verified: boolean} | null;
  /** Shared accounts cannot recover by e-mail or edit a profile. */
  kind: 'personal' | 'shared' | 'guest';
  lastSeen: string;
  sessions: number;
}

export const USERS: MockUser[] = [
  {
    id: 'u-yeray',
    username: 'Yeray',
    displayName: 'Yeray',
    roles: ['admin'],
    provisional: true,
    email: null,
    kind: 'personal',
    lastSeen: 'Ahora',
    sessions: 1,
  },
  {
    id: 'u-elvis',
    username: 'Elvis',
    displayName: 'Elvis',
    roles: ['admin'],
    description: 'Gestión de eventos',
    provisional: false,
    email: {address: 'elvis@example.com', verified: true},
    kind: 'personal',
    lastSeen: 'Hace 12 min',
    sessions: 2,
  },
  {
    id: 'u-dailos',
    username: 'Dailos',
    displayName: 'Dailos',
    roles: ['admin'],
    provisional: false,
    email: {address: 'dailos@example.com', verified: false},
    kind: 'personal',
    lastSeen: 'Ayer, 19:40',
    sessions: 1,
  },
  {
    id: 'u-fabian',
    username: 'Fabián',
    displayName: 'Fabián',
    roles: ['admin', 'developer'],
    provisional: false,
    email: {address: 'fabian@example.com', verified: true},
    kind: 'personal',
    lastSeen: 'Hace 1 h',
    sessions: 3,
  },
  {
    id: 'u-equipo',
    username: 'Equipo',
    displayName: 'Equipo',
    roles: ['team'],
    provisional: false,
    email: null,
    kind: 'shared',
    lastSeen: 'Hace 3 h',
    sessions: 4,
  },
  {
    id: 'u-invitado',
    username: 'Invitado',
    displayName: 'Invitado',
    roles: ['guest'],
    provisional: false,
    email: null,
    kind: 'guest',
    lastSeen: '24 nov',
    sessions: 0,
  },
];

export interface SessionInfo {
  id: string;
  device: string;
  where: string;
  when: string;
  current?: boolean;
}

export const MY_SESSIONS: SessionInfo[] = [
  {
    id: 'ses-1',
    device: 'Chrome en Windows',
    where: 'Oficina · La Laguna',
    when: 'Ahora',
    current: true,
  },
  {
    id: 'ses-2',
    device: 'Safari en iPhone',
    where: 'Plaza del Cristo',
    when: 'Hace 2 h',
  },
  {
    id: 'ses-3',
    device: 'Chrome en tableta Android',
    where: 'Almacén municipal',
    when: 'Hace 3 días',
  },
];

export interface SecurityEvent {
  id: string;
  kind: 'password' | 'session' | 'support' | 'email' | 'role' | 'failed';
  text: string;
  when: string;
  who?: string;
}

export const MY_SECURITY: SecurityEvent[] = [
  {
    id: 'se-1',
    kind: 'support',
    text: 'Fabián abrió una sesión de soporte en tu cuenta · motivo «el calendario no carga» · 14 min',
    when: '25 nov, 17:02',
  },
  {
    id: 'se-2',
    kind: 'session',
    text: 'Nuevo inicio de sesión · Safari en iPhone',
    when: '24 nov, 08:31',
  },
  {
    id: 'se-3',
    kind: 'password',
    text: 'Fabián puso una contraseña provisional en tu cuenta',
    when: '20 nov, 10:15',
  },
];

export const ADMIN_LOG: SecurityEvent[] = [
  {
    id: 'al-1',
    kind: 'support',
    text: 'Sesión de soporte en la cuenta de Elvis · motivo «el calendario no carga» · 14 min · terminada por Fabián',
    who: 'Fabián',
    when: '25 nov, 17:02',
  },
  {
    id: 'al-2',
    kind: 'password',
    text: 'Contraseña provisional puesta en la cuenta Equipo',
    who: 'Fabián',
    when: '24 nov, 09:00',
  },
  {
    id: 'al-3',
    kind: 'failed',
    text: '5 intentos fallidos de acceso con un usuario que no existe · bloqueo de 15 min',
    when: '23 nov, 22:47',
  },
  {
    id: 'al-4',
    kind: 'password',
    text: 'Dailos cambió su contraseña',
    who: 'Dailos',
    when: '22 nov, 18:20',
  },
  {
    id: 'al-5',
    kind: 'email',
    text: 'Elvis verificó su correo de recuperación',
    who: 'Elvis',
    when: '21 nov, 12:05',
  },
  {
    id: 'al-6',
    kind: 'role',
    text: 'Fabián recibió el rol Desarrollador además de Administrador',
    who: 'Yeray',
    when: '20 nov, 10:00',
  },
];

export interface ActivityItem {
  id: string;
  text: string;
  when: string;
}

export const MY_ACTIVITY: ActivityItem[] = [
  {
    id: 'ac-1',
    text: 'Creaste la tarea «Montaje de carpas»',
    when: 'Hoy, 09:20',
  },
  {
    id: 'ac-2',
    text: 'Aprobaste la oferta de Eventos Teide Demo',
    when: 'Ayer, 11:02',
  },
  {id: 'ac-3', text: 'Respondiste una pregunta abierta', when: 'Ayer, 10:47'},
  {
    id: 'ac-4',
    text: 'Añadiste el contacto Lucía Demo',
    when: '25 nov, 16:30',
  },
];
