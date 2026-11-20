/**
 * @module engine/crowd/demography
 * Cuotas marginales demográficas basadas en el padrón de San Cristóbal de La Laguna
 * y generador de identidades sintéticas para los agentes del simulador.
 */

export const DEMOGRAPHY = {
  total: 167176,
  ageCounts: [
    8920, 15168, 21491, 22165, 25436, 27513, 23163, 13762, 7480, 1981, 97,
  ],
  sexCounts: {woman: 86902, man: 80274},
  ageSource: 'https://sede.aytolalaguna.es/publico/habitantes/edad',
  sexSource: 'https://sede.aytolalaguna.es/publico/habitantes/genero',
  consulted: '2026-11-12',
  note: 'Márgenes independientes del padrón municipal consultado. Sin fecha de referencia visible; no confundir con el padrón INE 2025. No se dispone de cruces edad/sexo/barrio/formación/hábitos.',
};

const women = [
  'Lucía',
  'Carmen',
  'Elena',
  'Sara',
  'Nora',
  'Inés',
  'Alicia',
  'Clara',
  'Eva',
  'Julia',
  'Lara',
  'Vera',
  'Paula',
  'Alba',
  'Irene',
  'Marina',
  'Ana',
  'María',
  'Noelia',
  'Laura',
  'Sofía',
  'Andrea',
  'Isabel',
  'Cristina',
  'Patricia',
  'Beatriz',
];

const men = [
  'Mateo',
  'Hugo',
  'Daniel',
  'Adrián',
  'Pablo',
  'Leo',
  'Bruno',
  'Iván',
  'Marcos',
  'Óscar',
  'Álex',
  'Nicolás',
  'Darío',
  'Sergio',
  'Samuel',
  'Tomás',
  'José',
  'David',
  'Javier',
  'Manuel',
  'Juan',
  'Antonio',
  'Carlos',
  'Rubén',
  'Diego',
  'Yeray',
];

const surnames = [
  'Pérez',
  'García',
  'Díaz',
  'Hernández',
  'Martín',
  'Rodríguez',
  'Alonso',
  'Suárez',
  'González',
  'Cabrera',
  'Torres',
  'Méndez',
  'Delgado',
  'Castro',
  'Morales',
  'Navarro',
  'Gutiérrez',
  'Dorta',
  'Acosta',
  'Marrero',
  'Gómez',
  'Reyes',
  'Padrón',
  'León',
  'Santos',
  'Rivero',
  'Vega',
  'Domínguez',
  'Ramos',
  'Medina',
  'Cruz',
  'Luis',
  'Vera',
  'López',
  'Sosa',
  'Perera',
  'Quintero',
  'Guerra',
  'Rojas',
  'Brito',
];

const homes = [
  'Casco de La Laguna',
  'San Benito',
  'La Cuesta',
  'Taco',
  'Finca España',
  'Tejina',
  'Valle de Guerra',
  'Bajamar',
  'Punta del Hidalgo',
  'Guamasa',
  'Las Mercedes',
  'Los Baldíos',
  'Gracia',
  'Geneto',
  'Vega Lagunera',
];

/**
 * Reparte proporcionalmente las frecuencias marginales en una muestra de tamaño `n`.
 */
export function quotas(counts: number[], n = 1000): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  const q = counts.map(v => Math.floor((v * n) / total));
  const order = counts
    .map((v, i) => ({i, remainder: (v * n) / total - q[i]}))
    .sort((a, b) => b.remainder - a.remainder);
  const remaining = n - q.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) q[order[i].i]++;
  return q;
}

const bands = quotas(DEMOGRAPHY.ageCounts).flatMap((n, i) =>
  Array<number>(n).fill(i),
);

/**
 * Genera los atributos sociodemográficos sintéticos para el índice de persona `i`.
 */
export function identity(i: number) {
  const slot = (i * 541) % 1000;
  const band = bands[slot];
  const age = band === 10 ? 100 + (i % 4) : band * 10 + ((i * 7) % 10);
  const sex = (i * 613) % 1000 < 520 ? 'woman' : 'man';
  const names = sex === 'woman' ? women : men;
  const name =
    names[i % names.length] +
    ' ' +
    surnames[Math.floor(i / names.length) % surnames.length] +
    ' ' +
    surnames[(i * 7 + 13) % surnames.length];
  const home = homes[(i * 11) % homes.length];
  const education =
    age < 6
      ? 'Etapa infantil'
      : age < 12
        ? 'Educación primaria en curso'
        : age < 18
          ? 'Estudios secundarios en curso'
          : age < 24
            ? ['FP en curso', 'Universidad en curso', 'Secundaria', 'FP'][i % 4]
            : [
                'Estudios primarios',
                'Secundaria',
                'Formación profesional',
                'Estudios universitarios',
                'Formación de posgrado',
              ][i % 5];

  return {
    personName: name,
    age,
    sex,
    gender: sex === 'woman' ? 'Mujer' : 'Hombre',
    home,
    education,
    household:
      age < 18
        ? 'Visita acompañada por un adulto'
        : ['Solo/a', 'En pareja', 'Con amistades', 'En familia'][i % 4],
    travelMode: ['A pie', 'Guagua', 'Coche compartido', 'Bicicleta', 'Coche'][
      i % 5
    ],
    identitySynthetic: true,
  };
}
