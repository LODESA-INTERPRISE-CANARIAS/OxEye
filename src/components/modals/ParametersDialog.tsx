import React, {useEffect, useRef, useState} from 'react';
import {BUDGET_FIELDS} from '../../data/catalog';
import {phases} from '../../engine/logistics/phases';
import {shift} from '../../engine/logistics/shift';
import {useProjectStore} from '../../store/useProjectStore';

export interface ParametersDialogProps {
  onSceneChanged: () => void;
}

/**
 * Modal dialog (`#parameters`) for production parameters, shift durations, rates, and waste estimation.
 */
export const ParametersDialog: React.FC<ParametersDialogProps> = ({
  onSceneChanged,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'parameters';
  const s = currentScene();
  const m = currentMap();

  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(BUDGET_FIELDS.map(([k, , def]) => [k, Number(def)]))
  );
  const [estimateSource, setEstimateSource] = useState('Supuesto de ensayo');
  const [horizontalRain, setHorizontalRain] = useState(false);
  const [trained, setTrained] = useState(false);
  const [rebelSharePct, setRebelSharePct] = useState(1);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      const sc = currentScene();
      const rec = sc as unknown as Record<string, unknown>;
      setValues(
        Object.fromEntries(
          BUDGET_FIELDS.map(([k, , def]) => [k, Number(rec[k] ?? def)])
        )
      );
      setEstimateSource(sc.estimateSource || 'Supuesto de ensayo');
      setHorizontalRain(!!sc.horizontalRain);
      setTrained(!!sc.trained);
      setRebelSharePct(
        Math.round(Math.max(0, Math.min(1, sc.rebelShare ?? 0.01)) * 1000) / 10
      );
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

  const estimateText = (() => {
    const config = {...s, ...values};
    return (['pre', 'post'] as const)
      .map((p) => {
        const plan = shift(config, m, p);
        if (plan.error) return phases[p] + ' · ' + plan.error;
        const h = Math.min(plan.limit, plan.total) / 3600;
        const cost =
          h *
          (config.teamSize || 3) *
          (config.rate || 16) *
          (1 + (config.burden || 0) / 100);
        return (
          phases[p] +
          ' · ' +
          h.toFixed(2) +
          ' h · ' +
          cost.toFixed(2) +
          ' € de personal' +
          (plan.total > plan.limit ? ' · trabajo pendiente' : '')
        );
      })
      .join(' / ');
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (values.mealMax < values.mealMin) {
      showToast('La duración máxima debe ser igual o mayor que la mínima.');
      return;
    }
    updateScene((sc) => {
      Object.assign(sc, values, {
        estimateSource,
        trained,
        horizontalRain,
        rebelShare: Math.max(0, Math.min(1, (Number(rebelSharePct) || 0) / 100)),
      });
    }, true);
    setActiveModal(null);
    onSceneChanged();
  };

  return (
    <dialog
      id="parameters"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <form id="parameter-form" onSubmit={handleSubmit}>
        <h2>Ficha de producción</h2>
        <p>{s.title}</p>
        <fieldset>
          <legend>Personal y presupuesto</legend>
          {BUDGET_FIELDS.map(([k, label, , min, max, step]) => (
            <label key={k}>
              {label}
              <input
                required
                type="number"
                name={k}
                min={min}
                max={max}
                step={step}
                value={values[k] ?? 0}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [k]: Number(e.target.value),
                  }))
                }
              />
            </label>
          ))}
        </fieldset>
        <label>
          Asistentes que intentan saltar vallas (%) · 0 desactiva
          <input
            type="number"
            id="param-rebel-share"
            name="rebelSharePct"
            min={0}
            max={25}
            step={0.5}
            value={rebelSharePct}
            onChange={(e) => setRebelSharePct(Number(e.target.value))}
          />
        </label>
        <label>
          Fuente de rendimientos y tarifas
          <input
            name="estimateSource"
            maxLength={200}
            placeholder="Parte de trabajo, presupuesto o supuesto"
            value={estimateSource}
            onChange={(e) => setEstimateSource(e.target.value)}
          />
        </label>
        <label>
          <input
            name="horizontalRain"
            type="checkbox"
            checked={horizontalRain}
            onChange={(e) => setHorizontalRain(e.target.checked)}
          />{' '}
          Lluvia horizontal alcanza los bancos bajo carpa
        </label>
        <label>
          <input
            name="trained"
            type="checkbox"
            checked={trained}
            onChange={(e) => setTrained(e.target.checked)}
          />{' '}
          Personal designado y formado con material adecuado para primera
          intervención
        </label>
        <p>
          Referencia europea: Directiva 89/391/CEE, art. 8. La organización
          prepara la coordinación exterior y designa personal formado y
          equipado.
        </p>
        <p>
          La planificación sigue el apartado 7.2.1 del manual INSST de montaje y
          desmontaje (2020). Los minutos y tarifas iniciales son hipótesis
          editables. Sustitúyelos por tiempos medidos y costes del proveedor.
        </p>
        <a
          href="https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:31989L0391"
          target="_blank"
          rel="noopener noreferrer"
        >
          Directiva europea
        </a>{' '}
        ·{' '}
        <a
          href="https://www.insst.es/documentacion/material-tecnico/documentos-tecnicos/eventos-y-espectaculos-publicos-manual-buenas-practicas-planificacion-para-el-montaje-y-desmontaje-ano-2020"
          target="_blank"
          rel="noopener noreferrer"
        >
          Manual del INSST
        </a>
        <p id="estimate">{estimateText}</p>
        <button className="dark" type="submit">
          Guardar ficha
        </button>{' '}
        <button
          type="button"
          id="cancel-params"
          onClick={() => setActiveModal(null)}
        >
          Cancelar
        </button>
      </form>
    </dialog>
  );
};
