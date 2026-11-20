import type {EventEngine} from '../crowd/event-engine';

/**
 * Available event goal tuples `[key, label]` for the new-model wizard.
 */
export const eventGoals: Array<[string, string]> = [
  ['family', 'Familias'],
  ['local', 'Comercio local'],
  ['food', 'Gastronomía'],
  ['culture', 'Cultura y talleres'],
  ['music', 'Música'],
  ['comfort', 'Descanso y accesibilidad'],
];

/**
 * Validates and calculates schedule parameters from start/end dates and daily opening/closing times.
 *
 * @param startDate - ISO date string (`YYYY-MM-DD`).
 * @param endDate - ISO date string (`YYYY-MM-DD`).
 * @param from - Daily opening time (`HH:MM`).
 * @param to - Daily closing time (`HH:MM`).
 * @returns Validated schedule object.
 */
export function eventSchedule(
  startDate: string,
  endDate: string,
  from: string,
  to: string
): {
  startDate: string;
  endDate: string;
  eventDays: number;
  start: number;
  hours: number;
  endTime: string;
} {
  const first = Date.parse(startDate + 'T00:00:00Z');
  const last = Date.parse(endDate + 'T00:00:00Z');
  const days = Math.round((last - first) / 86400000) + 1;
  const hoursOf = (t: string): number =>
    Number(t.split(':')[0]) + Number(t.split(':')[1]) / 60;
  const start = hoursOf(from);
  const end = hoursOf(to);
  const hours = (end - start + 24) % 24;
  if (!Number.isFinite(first) || !Number.isFinite(last) || days < 1 || days > 30) {
    throw new Error('Selecciona entre 1 y 30 días consecutivos.');
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > 12) {
    throw new Error(
      'Selecciona un horario de 1 a 12 horas completas. Puede terminar después de medianoche.'
    );
  }
  return {startDate, endDate, eventDays: days, start, hours, endTime: to};
}

/**
 * Generates an SVG radar chart string for the selected event goals.
 *
 * @param selected - List of selected goal keys.
 * @returns SVG markup string.
 */
export function goalChart(selected: string[]): string {
  const center = [150, 135];
  const radius = 86;
  const points = eventGoals.map((_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const polygon = (scale: number): string =>
    points
      .map((p) =>
        [
          center[0] + p[0] * radius * scale,
          center[1] + p[1] * radius * scale,
        ].join(',')
      )
      .join(' ');
  return (
    '<svg viewBox="0 0 300 280" role="img" aria-label="Perfil de objetivos del evento">' +
    [0.25, 0.5, 0.75, 1]
      .map(
        (n) =>
          '<polygon points="' +
          polygon(n) +
          '" fill="none" stroke="#66877f" stroke-width=".6"/>'
      )
      .join('') +
    points
      .map(
        (p) =>
          '<line x1="150" y1="135" x2="' +
          (150 + p[0] * 86) +
          '" y2="' +
          (135 + p[1] * 86) +
          '" stroke="#66877f" stroke-width=".5"/>'
      )
      .join('') +
    '<polygon points="' +
    points
      .map((p, i) => {
        const scale = selected.includes(eventGoals[i][0]) ? 1 : 0.15;
        return [150 + p[0] * 86 * scale, 135 + p[1] * 86 * scale].join(',');
      })
      .join(' ') +
    '" fill="#c4a774" fill-opacity=".35" stroke="#dfc48b" stroke-width="2"/>' +
    points
      .map(
        (p, i) =>
          '<text x="' +
          (150 + p[0] * 114) +
          '" y="' +
          (139 + p[1] * 112) +
          '" text-anchor="middle" fill="currentColor" font-size="8">' +
          eventGoals[i][1] +
          '</text>'
      )
      .join('') +
    '</svg>'
  );
}

/**
 * Updates live weather in a running `EventEngine` and recalculates hourly arrivals.
 *
 * @param engine - Running `EventEngine` instance.
 * @param weather - Weather condition (`'sun'`, `'cloud'`, `'rain'`, `'wind'`).
 */
export function applyLiveWeather(
  engine: EventEngine,
  weather: 'sun' | 'cloud' | 'rain' | 'wind'
): void {
  if (!['sun', 'cloud', 'rain', 'wind'].includes(weather)) return;
  engine.s.base.weather = weather;
  engine.hourly = engine.arrivalProfile();
}

/**
 * Updates live hourly arrivals in a running `EventEngine` and recalculates arrival profile.
 *
 * @param engine - Running `EventEngine` instance.
 * @param value - Hourly arrival rate (`0–3000`).
 */
export function applyLiveArrivals(engine: EventEngine, value: number): void {
  engine.s.base.arrivals = Math.max(0, Math.min(3000, Number(value) || 0));
  engine.hourly = engine.arrivalProfile();
}
