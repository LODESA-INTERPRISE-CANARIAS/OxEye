/**
 * The supplier's guided conversation as data: which questions each activity
 * gets, which ones appear after an answer, and the resulting list of steps.
 * Mock-up only; if approved, E7 turns this into the public form's contract.
 */
import type {CategoryId, TaxKind} from '../data';

export type Mode = 'request' | 'open' | 'manual';

export type Value = string | number | null;

export interface ProductDraft {
  key: string;
  category: CategoryId;
  v: Record<string, Value>;
}

export interface Draft {
  intent: 'yes' | 'similar' | 'no' | null;
  decline: string | null;
  company: {name: string; contact: string; phone: string; email: string};
  /** Manual mode: how the offer reached us (data quality: origin). */
  origin: string | null;
  categories: CategoryId[];
  products: ProductDraft[];
  tax: TaxKind | null;
  taxRate: string;
  taxIncluded: 'no' | 'yes' | null;
  validity: '30d' | '3m' | '6m' | '1y' | '2y' | 'date' | null;
  validityDate: string;
  service: 'all' | 'some' | 'year' | 'season' | null;
  serviceNote: string;
  commitment: 'no' | 'yes' | null;
  commitmentYears: number;
  commitmentPrice: string;
  notes: string;
  privacy: boolean;
}

export interface Question {
  key: string;
  kind: 'choice' | 'number' | 'money' | 'text';
  label: string;
  hint?: string;
  options?: {value: string; label: string; sub?: string}[];
  unit?: string;
  columns?: 1 | 2 | 3;
  /** Appears only after a previous answer. */
  showIf?: (v: Record<string, Value>) => boolean;
}

export type Part = 'what' | 'price' | 'extras' | 'conditions';

export const PART_TITLE: Record<Part, string> = {
  what: 'Qué ofreces',
  price: 'Precio',
  extras: 'Qué incluye',
  conditions: 'Condiciones',
};

const INCLUDED = [
  {value: 'included', label: 'Incluido en el precio'},
  {value: 'extra', label: 'Se cobra aparte'},
  {value: 'no', label: 'No lo hacemos'},
];

const PRICE_PER_DAY_OR_EVENT = [
  {value: 'unit_day', label: 'Por jornada', sub: 'Cada día de evento'},
  {value: 'unit_event', label: 'Por todo el evento', sub: 'Un precio cerrado'},
];

const price = (label: string): Question => ({
  key: 'price',
  kind: 'money',
  label,
  hint: 'Sin impuestos. Te preguntamos el impuesto más adelante.',
});

type Spec = Record<Exclude<Part, 'conditions'>, Question[]>;

const GENERIC: Spec = {
  what: [
    {
      key: 'name',
      kind: 'text',
      label: '¿Qué ofreces?',
      hint: 'En pocas palabras, como lo pondrías en una factura.',
    },
    {
      key: 'units',
      kind: 'number',
      label: '¿Cuántas unidades tienes?',
      unit: 'unidades',
    },
  ],
  price: [
    {
      key: 'priceUnit',
      kind: 'choice',
      label: '¿Cómo lo cobras?',
      columns: 2,
      options: [
        {value: 'unit_day', label: 'Por unidad y jornada'},
        {value: 'unit_event', label: 'Por unidad, todo el evento'},
        {value: 'hour', label: 'Por hora'},
        {value: 'pack', label: 'Por paquete'},
      ],
    },
    price('Precio'),
  ],
  extras: [
    {key: 'transport', kind: 'choice', label: 'Transporte', options: INCLUDED},
    {
      key: 'transportPrice',
      kind: 'money',
      label: 'Precio del transporte, por pedido',
      showIf: v => v.transport === 'extra',
    },
  ],
};

export const SPEC: Partial<Record<CategoryId, Spec>> = {
  carpas: {
    what: [
      {
        key: 'size',
        kind: 'choice',
        label: '¿De qué medida?',
        columns: 3,
        options: [
          {value: '3x3', label: '3 × 3 m'},
          {value: '6x3', label: '6 × 3 m'},
          {value: '6x6', label: '6 × 6 m'},
          {value: '8x4', label: '8 × 4 m'},
          {value: '10x5', label: '10 × 5 m'},
          {value: 'other', label: 'Otra'},
        ],
      },
      {
        key: 'sizeOther',
        kind: 'text',
        label: 'Escribe la medida',
        showIf: v => v.size === 'other',
      },
      {
        key: 'units',
        kind: 'number',
        label: '¿Cuántas tienes disponibles?',
        unit: 'carpas',
      },
    ],
    price: [
      {
        key: 'priceUnit',
        kind: 'choice',
        label: '¿Cómo la cobras?',
        options: [
          {
            value: 'unit_day',
            label: 'Por carpa y jornada',
            sub: 'Lo más habitual',
          },
          {value: 'unit_event', label: 'Por carpa, todo el evento'},
          {value: 'order', label: 'Un precio cerrado por todo el pedido'},
        ],
      },
      price('Precio'),
    ],
    extras: [
      {
        key: 'assembly',
        kind: 'choice',
        label: 'Montaje y desmontaje',
        options: INCLUDED,
      },
      {
        key: 'assemblyPrice',
        kind: 'money',
        label: 'Montaje, por carpa',
        showIf: v => v.assembly === 'extra',
      },
      {
        key: 'transport',
        kind: 'choice',
        label: 'Transporte',
        options: [
          {value: 'included', label: 'Incluido en el precio'},
          {value: 'extra', label: 'Se cobra aparte'},
          {value: 'pickup', label: 'La recogéis vosotros'},
        ],
      },
      {
        key: 'transportPrice',
        kind: 'money',
        label: 'Transporte, por pedido',
        showIf: v => v.transport === 'extra',
      },
      {
        key: 'ballast',
        kind: 'choice',
        label: 'Lastres o anclajes',
        hint: 'Los pesos sobre la plaza los revisamos aparte.',
        options: [
          {value: 'included', label: 'Los ponemos nosotros'},
          {value: 'extra', label: 'Se cobran aparte'},
          {value: 'none', label: 'No hacen falta'},
        ],
      },
    ],
  },
  limpieza: {
    what: [
      {
        key: 'staff',
        kind: 'number',
        label: '¿Cuántas personas puedes poner?',
        unit: 'personas',
      },
      {
        key: 'hours',
        kind: 'choice',
        label: '¿Cuántas horas por jornada?',
        columns: 3,
        options: [
          {value: '4', label: '4 h'},
          {value: '6', label: '6 h'},
          {value: '8', label: '8 h'},
          {value: '12', label: '12 h'},
          {value: '24', label: '24 h', sub: 'En turnos'},
        ],
      },
      {
        key: 'material',
        kind: 'choice',
        label: 'Material de limpieza',
        options: [
          {value: 'included', label: 'Lo traemos nosotros'},
          {value: 'extra', label: 'Se cobra aparte'},
        ],
      },
    ],
    price: [
      {
        key: 'priceUnit',
        kind: 'choice',
        label: '¿Cómo lo cobras?',
        options: [
          {value: 'hour_person', label: 'Por hora y persona'},
          {value: 'person_day', label: 'Por persona y jornada'},
          {value: 'service', label: 'Por servicio completo'},
        ],
      },
      price('Tarifa'),
    ],
    extras: [
      {
        key: 'night',
        kind: 'choice',
        label: '¿Trabajáis de noche?',
        options: [
          {value: 'no', label: 'No'},
          {value: 'same', label: 'Sí, mismo precio'},
          {value: 'extra', label: 'Sí, con suplemento'},
        ],
      },
      {
        key: 'nightExtra',
        kind: 'text',
        label: 'Suplemento nocturno',
        hint: 'Por ejemplo «+25 %» o «5 € la hora».',
        showIf: v => v.night === 'extra',
      },
      {
        key: 'waste',
        kind: 'choice',
        label: 'Residuos',
        options: [
          {value: 'yes', label: 'Nos los llevamos'},
          {value: 'no', label: 'Quedan en los contenedores'},
        ],
      },
    ],
  },
  sonido: {
    what: [
      {
        key: 'scale',
        kind: 'choice',
        label: '¿Para qué tamaño de acto?',
        options: [
          {value: 's', label: 'Acto pequeño', sub: 'Hasta 200 personas'},
          {value: 'm', label: 'Plaza', sub: 'Hasta 2.000 personas'},
          {value: 'l', label: 'Concierto', sub: 'Más de 2.000 personas'},
        ],
      },
    ],
    price: [
      {
        key: 'priceUnit',
        kind: 'choice',
        label: '¿Cómo lo cobras?',
        options: PRICE_PER_DAY_OR_EVENT,
      },
      price('Precio'),
    ],
    extras: [
      {
        key: 'tech',
        kind: 'choice',
        label: 'Técnico de sonido',
        options: INCLUDED,
      },
      {
        key: 'techPrice',
        kind: 'money',
        label: 'Técnico, por jornada',
        showIf: v => v.tech === 'extra',
      },
      {
        key: 'power',
        kind: 'choice',
        label: 'Corriente',
        options: [
          {value: 'grid', label: 'Necesitamos una toma'},
          {value: 'generator', label: 'Traemos generador'},
        ],
      },
    ],
  },
  ocio: {
    what: [
      {
        key: 'kind',
        kind: 'choice',
        label: '¿Qué es?',
        columns: 2,
        options: [
          {value: 'castle', label: 'Castillo hinchable'},
          {value: 'slide', label: 'Tobogán hinchable'},
          {value: 'ride', label: 'Atracción'},
          {value: 'other', label: 'Otra cosa'},
        ],
      },
      {
        key: 'size',
        kind: 'text',
        label: 'Medidas',
        hint: 'Por ejemplo «5 × 5 m».',
      },
      {
        key: 'units',
        kind: 'number',
        label: '¿Cuántos tienes?',
        unit: 'unidades',
      },
    ],
    price: [
      {
        key: 'priceUnit',
        kind: 'choice',
        label: '¿Cómo lo cobras?',
        options: PRICE_PER_DAY_OR_EVENT,
      },
      price('Precio'),
    ],
    extras: [
      {key: 'monitor', kind: 'choice', label: 'Monitor', options: INCLUDED},
      {
        key: 'power',
        kind: 'choice',
        label: '¿Necesita toma eléctrica?',
        options: [
          {value: 'yes', label: 'Sí'},
          {value: 'no', label: 'No'},
        ],
      },
    ],
  },
};

export function specFor(category: CategoryId): Spec {
  return SPEC[category] ?? GENERIC;
}

export type Section =
  | 'Solicitud'
  | 'Tu empresa'
  | 'Lo que ofreces'
  | 'Impuestos y vigencia'
  | 'Revisión';

export const SECTIONS: Section[] = [
  'Tu empresa',
  'Lo que ofreces',
  'Impuestos y vigencia',
  'Revisión',
];

export interface Step {
  id: string;
  section: Section;
  product?: ProductDraft;
  part?: Part;
}

/** The steps for the current answers: they change as the supplier answers. */
export function stepsFor(draft: Draft, mode: Mode): Step[] {
  const out: Step[] = [{id: 'start', section: 'Tu empresa'}];
  if (draft.intent === 'no') {
    out.push({id: 'decline', section: 'Revisión'});
    return out;
  }
  if (mode !== 'request') out.push({id: 'contact', section: 'Tu empresa'});
  out.push({id: 'categories', section: 'Lo que ofreces'});
  for (const p of draft.products) {
    for (const part of ['what', 'price', 'extras', 'conditions'] as Part[]) {
      out.push({
        id: `p:${p.key}:${part}`,
        section: 'Lo que ofreces',
        product: p,
        part,
      });
    }
  }
  out.push({id: 'more', section: 'Lo que ofreces'});
  out.push({id: 'tax', section: 'Impuestos y vigencia'});
  out.push({id: 'validity', section: 'Impuestos y vigencia'});
  out.push({id: 'special', section: 'Impuestos y vigencia'});
  out.push({id: 'review', section: 'Revisión'});
  return out;
}

let seq = 0;

export function newProduct(
  category: CategoryId,
  v: Record<string, Value> = {},
): ProductDraft {
  seq += 1;
  return {key: `${category}-${seq}`, category, v: {...v}};
}

export function emptyDraft(mode: Mode): Draft {
  const fromRequest = mode === 'request';
  return {
    intent: null,
    decline: null,
    company: fromRequest
      ? {
          name: 'Carpas Mario Demo',
          contact: 'Mario Demo',
          phone: '+34 000 000 012',
          email: 'mario@example.com',
        }
      : {name: '', contact: '', phone: '', email: ''},
    origin: null,
    categories: fromRequest ? ['carpas'] : [],
    products: fromRequest
      ? [newProduct('carpas', {size: '6x6', units: 3, priceUnit: 'unit_day'})]
      : [],
    tax: null,
    taxRate: '',
    taxIncluded: null,
    validity: null,
    validityDate: '',
    service: null,
    serviceNote: '',
    commitment: null,
    commitmentYears: 5,
    commitmentPrice: '',
    notes: '',
    privacy: false,
  };
}

const SIZE_LABEL: Record<string, string> = {
  '3x3': '3 × 3 m',
  '6x3': '6 × 3 m',
  '6x6': '6 × 6 m',
  '8x4': '8 × 4 m',
  '10x5': '10 × 5 m',
};

const OCIO_LABEL: Record<string, string> = {
  castle: 'Castillo hinchable',
  slide: 'Tobogán hinchable',
  ride: 'Atracción',
  other: 'Ocio',
};

/** «Carpa 6 × 6 m», «Limpieza · 2 personas», for cards and the review. */
export function productTitle(p: ProductDraft): string {
  const v = p.v;
  switch (p.category) {
    case 'carpas': {
      const size =
        v.size === 'other'
          ? String(v.sizeOther ?? '').trim()
          : SIZE_LABEL[String(v.size)];
      return size ? `Carpa ${size}` : 'Carpa';
    }
    case 'limpieza':
      return v.staff ? `Limpieza · ${v.staff} personas` : 'Limpieza';
    case 'sonido':
      return 'Equipo de sonido';
    case 'ocio':
      return [OCIO_LABEL[String(v.kind)] ?? 'Ocio', v.size]
        .filter(Boolean)
        .join(' ');
    default:
      return String(v.name ?? '').trim() || 'Producto o servicio';
  }
}

export const PRICE_UNIT_SHORT: Record<string, string> = {
  unit_day: 'por unidad y jornada',
  unit_event: 'por unidad, todo el evento',
  order: 'por todo el pedido',
  hour_person: 'por hora y persona',
  person_day: 'por persona y jornada',
  service: 'por servicio',
  hour: 'por hora',
  pack: 'por paquete',
};
