import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {
  activities,
  type ActivitySpec,
  planProgramme,
  providers,
  type ScheduledSession,
} from '../../engine/planning/programme';
import {useProjectStore} from '../../store/useProjectStore';

const clock = (min: number): string =>
  String(Math.floor(min / 60)).padStart(2, '0') +
  ':' +
  String(min % 60).padStart(2, '0');

const hourOf = (v: string): number => {
  const parts = v.split(':');
  return Number(parts[0] || 0) + Number(parts[1] || 0) / 60;
};

/**
 * Modal dialog (`#programme-dialog`) for scheduling multi-day event activities within a budget.
 */
export const ProgrammeDialog: React.FC = () => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'programme';
  const s = currentScene();

  const [budget, setBudget] = useState(3000);
  const [reserve, setReserve] = useState(20);
  const [sessions, setSessions] = useState(2);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('14:00');
  const [area, setArea] = useState(60);
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<ActivitySpec[]>([]);
  const [planResult, setPlanResult] = useState<{
    schedule: ScheduledSession[];
    pending: Array<{day: number; reason: string}>;
    spent: number;
    reserved: number;
    unspent: number;
    assumptions: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      const sc = currentScene();
      const prior = sc.programmeOptions || {};
      const prices = sc.activityPrices || {};
      setBudget(Number(prior.budget ?? 3000));
      setReserve(Number(prior.reserve ?? 20));
      setSessions(Number(prior.sessions ?? 2));
      setStartTime('10:00');
      setEndTime('14:00');
      setArea(Number(prior.area ?? 60));
      setQuery('');
      setChoices(
        activities.map((a) => ({
          ...a,
          cost: prices[a.id] ?? a.cost,
          enabled: prior.selected ? prior.selected.includes(a.id) : true,
        }))
      );
      setPlanResult(null);
      setErrorMsg('');
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

  const filteredChoices = choices.filter((a) =>
    (a.name + ' ' + a.category)
      .toLocaleLowerCase('es')
      .includes(query.toLocaleLowerCase('es'))
  );

  const dayLabel = (day: number): string => {
    const start = s.startDate || s.eventDate;
    if (!start) return 'Día ' + (day + 1);
    const date = new Date(start + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime())) return 'Día ' + (day + 1);
    date.setUTCDate(date.getUTCDate() + day);
    return (
      'Día ' +
      (day + 1) +
      ' · ' +
      date.toLocaleDateString('es-ES', {timeZone: 'UTC'})
    );
  };

  const handlePlan = () => {
    setErrorMsg('');
    try {
      const options = {
        budget,
        reserve,
        sessions,
        start: hourOf(startTime),
        finish: hourOf(endTime),
        area,
        items: choices,
      };
      const result = planProgramme(s, options);
      setPlanResult(result);
    } catch (err) {
      setPlanResult(null);
      setErrorMsg((err as Error).message);
    }
  };

  const handleSaveProgramme = () => {
    if (!planResult) return;
    updateScene((sc) => {
      sc.activityPrices = Object.fromEntries(choices.map((a) => [a.id, a.cost]));
      sc.programmeOptions = {
        budget,
        reserve,
        sessions,
        start: hourOf(startTime),
        finish: hourOf(endTime),
        area,
        selected: choices.filter((a) => a.enabled).map((a) => a.id),
      };
      sc.programme = planResult;
    });
    showToast(
      'Programa guardado en este modelo. Pendiente de confirmar con proveedores.'
    );
  };

  const handleExportCSV = () => {
    if (!planResult) return;
    const rowsCsv = [
      ['Dia', 'Inicio', 'Fin', 'Actividad', 'Coste_estimado_EUR'],
      ...planResult.schedule.map((r) => [
        r.day + 1,
        clock(r.start),
        clock(r.end),
        r.name,
        r.cost,
      ]),
    ];
    const csvContent =
      '\uFEFF' +
      rowsCsv
        .map((row) =>
          row
            .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
            .join(';')
        )
        .join('\r\n');
    downloadFile('Programa_Ojo_de_Buey.csv', csvContent, 'text/csv;charset=utf-8');
  };

  return (
    <dialog
      id="programme-dialog"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <form method="dialog">
        <button type="submit">Cerrar</button>
      </form>
      <div id="programme-body">
        <h2>Actividades para cada día</h2>
        <p>
          Catálogo de ideas para un evento de varios días. Los costes iniciales
          son hipótesis por sesión, sin presupuesto confirmado del proveedor.
          Revisa transporte, montaje, personal, impuestos y requisitos técnicos.
        </p>
        <label>
          Presupuesto total para actividades (€)
          <input
            id="programme-budget"
            type="number"
            min="0"
            max="1000000"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
        </label>
        <label>
          Reserva presupuestaria (%)
          <input
            id="programme-reserve"
            type="number"
            min="0"
            max="50"
            value={reserve}
            onChange={(e) => setReserve(Number(e.target.value))}
          />
        </label>
        <label>
          Sesiones por día
          <input
            id="programme-sessions"
            type="number"
            min="1"
            max="6"
            value={sessions}
            onChange={(e) => setSessions(Number(e.target.value))}
          />
        </label>
        <label>
          Inicio
          <input
            id="programme-start"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label>
          Final
          <input
            id="programme-end"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </label>
        <label>
          Superficie prevista por actividad (m²)
          <input
            id="programme-area"
            type="number"
            min="1"
            max="1000"
            value={area}
            onChange={(e) => setArea(Number(e.target.value))}
          />
        </label>
        <label>
          Buscar actividades
          <input
            id="activity-query"
            type="search"
            placeholder="Pintacaras, Navidad, música…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <p>
          {Math.max(1, s.eventDays || 1)} días según el modelo. Ajusta las
          fechas desde un nuevo modelo o la Ficha de producción.
        </p>
        <div id="activity-catalog">
          {filteredChoices.map((a) => (
            <article key={a.id} className="activity-row">
              <label>
                <input
                  data-enable={a.id}
                  type="checkbox"
                  checked={!!a.enabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setChoices((prev) =>
                      prev.map((item) =>
                        item.id === a.id ? {...item, enabled: checked} : item
                      )
                    );
                  }}
                />
                {a.name}
                <small>
                  {a.category} · {a.minutes} min · {a.places} plazas · {a.area}{' '}
                  m²
                </small>
              </label>
              <label>
                Coste por sesión (€)
                <input
                  data-cost={a.id}
                  type="number"
                  min="0"
                  max="20000"
                  value={a.cost}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val) && val >= 0 && val <= 20000) {
                      setChoices((prev) =>
                        prev.map((item) =>
                          item.id === a.id ? {...item, cost: val} : item
                        )
                      );
                    }
                  }}
                />
              </label>
            </article>
          ))}
        </div>
        <button
          id="programme-plan"
          type="button"
          className="dark"
          onClick={handlePlan}
        >
          Proponer programa dentro del presupuesto
        </button>
        <div id="programme-result">
          {errorMsg && <p>{errorMsg}</p>}
          {planResult && (
            <>
              <h3>Propuesta de programa</h3>
              <p>
                {planResult.schedule.length} sesiones ·{' '}
                {planResult.spent.toFixed(2)} € previstos ·{' '}
                {planResult.reserved.toFixed(2)} € reservados ·{' '}
                {planResult.unspent.toFixed(2)} € sin comprometer.
              </p>
              {Array.from(
                {length: Math.max(1, s.eventDays || 1)},
                (_, day) => (
                  <section key={day} className="note-card">
                    <b>{dayLabel(day)}</b>
                    {planResult.schedule
                      .filter((r) => r.day === day)
                      .map((r, idx) => (
                        <p key={idx}>
                          {clock(r.start)}–{clock(r.end)} · {r.name} · {r.cost}{' '}
                          €
                        </p>
                      ))}
                    {planResult.pending
                      .filter((r) => r.day === day)
                      .map((r, idx) => (
                        <p key={`p-${idx}`}>{r.reason}</p>
                      ))}
                  </section>
                )
              )}
              <p>
                Las sesiones se programan sucesivamente con 15 minutos de
                cambio. Comprueba en el plano las posiciones, la cubierta, las
                plazas y la interferencia con música y circulación. El catálogo
                exige los recursos declarados, pero no valida su reparto
                espacial.
              </p>
              <button
                id="programme-keep"
                type="button"
                onClick={handleSaveProgramme}
              >
                Guardar propuesta
              </button>{' '}
              <button
                id="programme-export"
                type="button"
                onClick={handleExportCSV}
              >
                Descargar programa CSV
              </button>
            </>
          )}
        </div>
        <h3>Proveedores para consultar</h3>
        {providers.map((p) => (
          <article key={p.name} className="note-card">
            <b>{p.name}</b>
            <p>
              {p.offer} · {p.region}
            </p>
            <a target="_blank" rel="noopener noreferrer" href={p.url}>
              Consultar oferta en su web
            </a>
            <small>
              Referencia consultada el 15/11/2026. Disponibilidad y presupuesto
              pendientes.
            </small>
          </article>
        ))}
      </div>
    </dialog>
  );
};
