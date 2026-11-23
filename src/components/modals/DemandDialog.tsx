import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  buildObjectiveDemandReport,
  demandDefaults,
  demandPlan,
  suggestDemandInputsFromObjectives,
} from '../../engine/planning/demand';
import {ensureProjectObjectives} from '../../engine/planning/objectives';
import {useProjectStore} from '../../store/useProjectStore';
import type {DemandInputs, DemandPlanOutput} from '../../types';

const labels: Record<keyof DemandInputs, string> = {
  arrivals: 'Llegadas por hora',
  area: 'Superficie disponible (m²)',
  stayMinutes: 'Estancia media (min)',
  foodShare: 'Compra comida (%)',
  serviceHourly: 'Servicios/h por puesto',
  utilization: 'Utilización objetivo (%)',
  seatedShare: 'Comidas sentadas (%)',
  mealMin: 'Comida mínima (min)',
  mealMax: 'Comida máxima (min)',
  tablesPerRoof: 'Mesas por cubierta',
  shopShare: 'Visita comercios (%)',
  shopMinutes: 'Atención comercial (min)',
  shopPlaces: 'Clientes simultáneos por comercio',
  toiletShare: 'Usos de baño por llegada (%)',
  toiletMinutes: 'Uso del baño (min)',
  children: 'Menores en la mezcla (%)',
  older: 'Mayores en la mezcla (%)',
};

type DemandTab = 'demand' | 'needs' | 'proposals' | 'compare';

/**
 * Modal dialog (`#demand-dialog`) organizado en 4 pestañas conectadas a Objetivos SMART:
 * Demanda, Necesidades, Propuestas y Comparación.
 */
export const DemandDialog: React.FC = () => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'demand';
  const scene = currentScene();
  const objectives = useMemo(() => ensureProjectObjectives(scene), [scene]);

  const [tab, setTab] = useState<DemandTab>('demand');
  const [values, setValues] = useState<DemandInputs>({
    ...demandDefaults,
    ...scene.demandInputs,
  });
  const [result, setResult] = useState<DemandPlanOutput | null>(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      const sc = currentScene();
      const baseVals = {...demandDefaults, ...sc.demandInputs};
      setValues(baseVals);
      setResult(demandPlan(baseVals));
      setTab('demand');
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

  const report = useMemo(
    () => buildObjectiveDemandReport(scene, values),
    [scene, values]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (values.children + values.older > 100 || values.mealMax < values.mealMin) {
      showToast('Revisa las edades o los tiempos de comida.');
      return;
    }
    updateScene((s) => {
      s.demandInputs = {...values};
    });
    setResult(demandPlan(values));
    setTab('needs');
  };

  const handleApplySuggestedFromSmart = () => {
    const suggested = suggestDemandInputsFromObjectives(scene, values);
    setValues(suggested);
    setResult(demandPlan(suggested));
    showToast('Hipótesis sugeridas cargadas desde tus Objetivos SMART (revisa y confirma con Calcular).');
  };

  return (
    <dialog
      id="demand-dialog"
      className="wide-modal"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <div id="demand-body">
        <h2>¿Qué servicios necesita el evento?</h2>
        <p>
          Puente operativo desde tus <b>Objetivos SMART</b> (
          {objectives.selected.length} prioridad
          {objectives.selected.length === 1 ? '' : 'es'} · ejes:{' '}
          {objectives.profile.activeAxes.join(', ')}). Puedes revisar y ajustar
          todas las hipótesis antes de calcular.
        </p>

        <div className="smart-substep-bar" style={{marginBottom: '12px'}}>
          {(
            [
              ['demand', '1. Demanda'],
              ['needs', '2. Necesidades'],
              ['proposals', '3. Propuestas'],
              ['compare', '4. Comparación'],
            ] as Array<[DemandTab, string]>
          ).map(([tKey, tLabel]) => (
            <button
              key={tKey}
              type="button"
              data-demand-tab={tKey}
              className={`smart-subtab ${tab === tKey ? 'is-active' : ''}`}
              onClick={() => setTab(tKey)}
            >
              {tLabel}
            </button>
          ))}
        </div>

        {tab === 'demand' && (
          <>
            <div style={{marginBottom: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
              <button
                type="button"
                id="demand-suggest-smart"
                onClick={handleApplySuggestedFromSmart}
              >
                Cargar hipótesis sugeridas desde Objetivos SMART
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => setActiveModal('objectives')}
              >
                Editar Objetivos SMART
              </button>
            </div>
            <form id="demand-form" onSubmit={handleSubmit}>
              <div className="demand-grid">
                {(Object.entries(labels) as Array<[keyof DemandInputs, string]>).map(
                  ([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        required
                        type="number"
                        min={
                          [
                            'foodShare',
                            'shopShare',
                            'seatedShare',
                            'toiletShare',
                            'children',
                            'older',
                          ].includes(k)
                            ? 0
                            : 1
                        }
                        max={
                          [
                            'foodShare',
                            'shopShare',
                            'seatedShare',
                            'toiletShare',
                            'children',
                            'older',
                            'utilization',
                          ].includes(k)
                            ? 100
                            : 20000
                        }
                        name={k}
                        value={values[k]}
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [k]: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  )
                )}
              </div>
              <button type="submit" className="dark">
                Calcular necesidades y comparar con inventario
              </button>
            </form>
          </>
        )}

        {tab === 'needs' && (
          <div id="demand-results">
            {result && (
              <>
                <h3>Necesidades calculadas frente a inventario actual</h3>
                <p>
                  Ocupación media estimada: <b>{Math.round(result.occupied)} personas</b>{' '}
                  · Huella indicativa de módulos: <b>{Math.round(result.modules)} m²</b>{' '}
                  · Resto libre antes de escenarios y vías: <b>{Math.round(result.remaining)} m²</b>.
                </p>
                <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', marginBottom: '12px'}}>
                  <thead>
                    <tr style={{borderBottom: '1px solid var(--line-strong)', textAlign: 'left'}}>
                      <th style={{padding: '6px'}}>Servicio</th>
                      <th style={{padding: '6px'}}>Calculado</th>
                      <th style={{padding: '6px'}}>En plano</th>
                      <th style={{padding: '6px'}}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.inventoryComparison.map((row) => (
                      <tr key={row.key} style={{borderBottom: '1px solid var(--line)'}}>
                        <td style={{padding: '6px'}}>{row.label}</td>
                        <td style={{padding: '6px'}}>{row.required}</td>
                        <td style={{padding: '6px'}}>{row.placed}</td>
                        <td
                          style={{
                            padding: '6px',
                            fontWeight: 700,
                            color: row.delta < 0 ? '#b91c1c' : '#15803d',
                          }}
                        >
                          {row.delta === 0
                            ? 'Equilibrado'
                            : row.delta > 0
                              ? `+${row.delta} margen`
                              : `${row.delta} déficit`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3>Necesidades derivadas de tus Objetivos SMART</h3>
                <ul style={{margin: '6px 0 10px 18px', fontSize: '0.86rem'}}>
                  {report.objectiveNeeds.map((n) => (
                    <li key={n.objectiveId}>
                      <b>{n.objectiveLabel}:</b> {n.recommendation}{' '}
                      {n.resources.length ? `(recursos: ${n.resources.join(', ')})` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {tab === 'proposals' && (
          <div className="smart-priority-list">
            {report.proposals.map((prop) => (
              <article key={prop.key} className="batch-card" style={{padding: '10px'}}>
                <h3>{prop.title}</h3>
                <p>
                  <b>Dotación orientativa:</b> {prop.food} comida · {prop.tables} mesas ·{' '}
                  {prop.roofs} carpas · {prop.shops} comercios · {prop.toilets} aseos
                </p>
                <p>
                  <b>Ocupación:</b> {prop.occupiedAreaM2} m² ·{' '}
                  <b>Coste estimado orientativo:</b> {prop.estimatedCost.toLocaleString('es-ES')} €
                </p>
                <p style={{color: '#15803d', fontSize: '0.84rem'}}>
                  <b>Ventajas:</b> {prop.advantages.join(' ')}
                </p>
                <p style={{color: '#b45309', fontSize: '0.84rem'}}>
                  <b>Compromisos:</b> {prop.tradeoffs.join(' ')}
                </p>
              </article>
            ))}
          </div>
        )}

        {tab === 'compare' && (
          <div>
            <h3>Comparación de configuraciones y compromisos</h3>
            {report.tradeoffsSummary.length > 0 && (
              <div className="smart-tradeoffs-box" style={{marginBottom: '10px'}}>
                <b>Compromisos activos de objetivos:</b>
                {report.tradeoffsSummary.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
            <p className="small-note">
              Para evaluar cada alternativa en simulación real (colas, evacuación, lluvia y
              cumplimiento ponderado por tus Objetivos SMART), abre el comparador unificado.
            </p>
            <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px'}}>
              <button
                type="button"
                className="dark"
                onClick={() => setActiveModal('laboratory')}
              >
                Abrir comparador de diseños (simulación 15 min)
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('inventory')}
              >
                Ajustar inventario manualmente
              </button>
            </div>
          </div>
        )}
      </div>
      <form method="dialog" style={{marginTop: '12px'}}>
        <button className="dark" type="submit">
          Cerrar
        </button>
      </form>
    </dialog>
  );
};
