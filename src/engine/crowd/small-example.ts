/**
 * @module engine/crowd/small-example
 * Builds the promoter's compact operational baseline example (1 food, 1 table of 6, 1 cover, 1 shop, 1 toilet).
 */
import type {Scene} from '../../types';
import {demandDefaults} from '../planning/demand';

export function smallExample(raw: Scene): Scene {
  const s = structuredClone(raw);
  const food = s.base.booths.find((o) => o.type === 'food');
  const shop = s.base.booths.find((o) => o.type === 'commerce');
  if (!food || !shop) {
    throw new Error(
      'El ejemplo necesita una base con un puesto de comida y un comercio.'
    );
  }
  const table = s.infrastructure.find((o) => o.kind === 'picnic');
  const roof =
    s.infrastructure.find((o) => o.id === 'picnic-roof') ||
    s.infrastructure.find((o) => o.role === 'cover');
  const toilet = s.infrastructure.find((o) => o.kind === 'toilet');
  if (!table || !roof || !toilet) {
    throw new Error('No se encuentra el mobiliario de referencia.');
  }
  s.base.booths = [
    {
      ...food,
      name: 'Café y comida · oferta por confirmar',
      labCapacity: 2,
      labTime: 2,
    },
    {
      ...shop,
      name: 'Juegos familiares · oferta por confirmar',
      labCapacity: 3,
      labTime: 8,
    },
  ];
  const keep = s.infrastructure.filter(
    (o) => o.role === 'emergency' || o.kind === 'extinguisher'
  );
  s.infrastructure = [
    ...keep,
    {...table, capacity: 6, coverGroup: roof.id},
    {...roof, x: table.x, y: table.y, width: 6, depth: 4, capacity: 6},
    {...toilet, capacity: 1},
  ];
  s.demandInputs = {...demandDefaults, arrivals: 50};
  s.base.arrivals = 50;
  s.base.stay = 60;
  s.mealMin = 10;
  s.mealMax = 20;
  s.pendingStock = [];
  s.flows = [];
  s.corridors = [];
  s.fences = [];
  s.exampleRecommendation =
    'Propuesta inicial del promotor: 1 comida, 1 mesa de 6, 1 cubierta, 1 comercio y 1 cabina. 50 personas de ocupación media; aforo autorizado pendiente.';
  s.collaboratorNotes = [
    'Lífer: juegos familiares, 3 clientes/8 min; hipótesis, pendiente de oferta.',
    'Palmelita: café y dulces, 2 líneas/2 min; hipótesis, pendiente de oferta.',
    'Mercado de La Laguna: selección y condiciones pendientes.',
  ];
  return s;
}
