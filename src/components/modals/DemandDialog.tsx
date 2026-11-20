import React, {useEffect, useRef, useState} from 'react';
import {demandDefaults, demandPlan} from '../../engine/planning/demand';
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

/**
 * Modal dialog (`#demand-dialog`) for calculating initial food, seating, roof, commerce, and toilet demand.
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

  const [values, setValues] = useState<DemandInputs>({
    ...demandDefaults,
    ...scene.demandInputs,
  });
  const [result, setResult] = useState<DemandPlanOutput | null>(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      setValues({...demandDefaults, ...currentScene().demandInputs});
      setResult(null);
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

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
  };

  return (
    <dialog
      id="demand-dialog"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <div id="demand-body">
        <h2>¿Qué servicios necesita el evento?</h2>
        <p>
          Indica cuánto público esperas y cómo será su visita. Calcularemos una
          primera propuesta de puestos, mesas y baños. Puedes modificar todas
          las suposiciones. Pasa el cursor o pulsa en ? para ver una explicación
          y un ejemplo.
        </p>
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
          <button type="submit">Calcular</button>
        </form>
        <div id="demand-results">
          {result && (
            <>
              <h3>Primera propuesta para este público</h3>
              <p>
                {result.food} puestos de comida · {result.tables} mesas de seis
                plazas · {result.roofs} cubiertas · {result.shops} comercios ·{' '}
                {result.toilets} cabinas por demanda de uso.
              </p>
              <p>
                {result.seats} plazas calculadas para comer · referencia de{' '}
                {result.childSeats} menores y {result.olderSeats} mayores dentro
                de esa demanda. Las mesas deben permitir acompañamiento y
                accesibilidad.
              </p>
              <p>
                Ocupación media estimada {Math.round(result.occupied)} personas.
                Huella indicativa de módulos {Math.round(result.modules)} m².
                Resto {Math.round(result.remaining)} m² antes de escenarios,
                colas, vías, evacuación, servicios y mobiliario.
              </p>
              <p>
                La estimación de cabinas requiere contraste sanitario y de
                accesibilidad. La superficie restante no acredita aforo. La
                proporción se calcula con demanda × duración / capacidad, con
                las hipótesis que acabas de introducir.
              </p>
              <h3>Posibles colaboradores locales</h3>
              <p>
                Lífer · juegos familiares. Palmelita · café y dulces. Mercado de
                La Laguna · selección de comerciantes y restauración.
                Disponibilidad y condiciones pendientes de consulta.
              </p>
              <p>
                Ensayo inicial por unidad, pendiente de oferta del proveedor:
                puesto de juegos 3 clientes × 8 min = 22,5 servicios/h; café 2
                líneas × 2 min = 60 servicios/h. No son rendimientos medidos de
                estas empresas.
              </p>
            </>
          )}
        </div>
      </div>
      <form method="dialog">
        <button className="dark" type="submit">
          Cerrar
        </button>
      </form>
    </dialog>
  );
};
