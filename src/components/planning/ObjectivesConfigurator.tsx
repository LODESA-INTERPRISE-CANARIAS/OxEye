import React, {useMemo, useState} from 'react';
import {
  createProjectObjectives,
  NON_NEGOTIABLE_CONSTRAINTS,
  OBJECTIVE_BY_ID,
  OBJECTIVE_CATEGORIES,
  OBJECTIVE_CATALOG,
} from '../../engine/planning/objectives';
import type {
  BehaviorHypotheses,
  ObjectiveCategoryKey,
  ObjectivePriority,
  ProjectObjectives,
  SelectedObjective,
} from '../../types';
import {ObjectiveCategoryIcon} from './ObjectiveCategoryIcon';

export interface ObjectivesConfiguratorProps {
  value: ProjectObjectives;
  onChange: (next: ProjectObjectives) => void;
  /** Vista interna: selección de tarjetas (`cards`) o jerarquía e hipótesis (`priority`). */
  substep?: 'cards' | 'priority';
  onSubstepChange?: (s: 'cards' | 'priority') => void;
  compact?: boolean;
}

const PRIORITY_LABELS: Record<ObjectivePriority, string> = {
  essential: 'Esencial',
  important: 'Importante',
  desirable: 'Deseable',
};

/**
 * Configurador visual multi-selección de objetivos SMART sin formularios de texto libre.
 * Genera y sincroniza `ProjectObjectives` (perfil operativo, compromisos e hipótesis).
 */
export const ObjectivesConfigurator: React.FC<ObjectivesConfiguratorProps> = ({
  value,
  onChange,
  substep: controlledSubstep,
  onSubstepChange,
  compact = false,
}) => {
  const [internalSubstep, setInternalSubstep] = useState<'cards' | 'priority'>('cards');
  const substep = controlledSubstep ?? internalSubstep;
  const setSubstep = onSubstepChange ?? setInternalSubstep;

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<ObjectiveCategoryKey | 'all'>('all');
  const [advancedMode, setAdvancedMode] = useState(false);

  const selectedMap = useMemo(
    () => new Map(value.selected.map((s) => [s.id, s])),
    [value.selected]
  );

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('es');
    return OBJECTIVE_CATALOG.filter((item) => {
      if (catFilter !== 'all' && item.category !== catFilter) return false;
      if (!q) return true;
      const hay = `${item.label} ${item.shortDesc} ${item.subcategory}`.toLocaleLowerCase('es');
      return hay.includes(q);
    });
  }, [search, catFilter]);

  const applySelection = (
    nextSelected: SelectedObjective[],
    keepConfirmed = false
  ) => {
    const next = createProjectObjectives(nextSelected, {
      version: value.version + 1,
      legacySmartGoal: value.legacySmartGoal,
      ...(keepConfirmed ? {confirmedHypotheses: value.confirmedHypotheses} : {}),
    });
    onChange(next);
  };

  const toggleCard = (id: string) => {
    const exists = selectedMap.has(id);
    if (exists) {
      applySelection(value.selected.filter((s) => s.id !== id));
    } else {
      const def = OBJECTIVE_BY_ID[id];
      const nextItem: SelectedObjective = {
        id,
        priority: 'important',
        ...(def?.defaultTarget !== undefined ? {targetValue: def.defaultTarget} : {}),
        ...(def?.contextOptions?.length ? {contexts: [def.contextOptions[0].key]} : {}),
      };
      applySelection([...value.selected, nextItem]);
    }
  };

  const updateSelectedItem = (
    id: string,
    patch: Partial<SelectedObjective>
  ) => {
    applySelection(
      value.selected.map((s) => (s.id === id ? {...s, ...patch} : s))
    );
  };

  const toggleContextOption = (objId: string, ctxKey: string) => {
    const cur = selectedMap.get(objId);
    if (!cur) return;
    const prev = cur.contexts || [];
    const nextCtx = prev.includes(ctxKey)
      ? prev.filter((k) => k !== ctxKey)
      : [...prev, ctxKey];
    updateSelectedItem(objId, {contexts: nextCtx});
  };

  const updateHypothesis = (patch: Partial<BehaviorHypotheses>) => {
    const nextHyp: BehaviorHypotheses = {
      ...value.confirmedHypotheses,
      ...patch,
      origin: patch.confirmed ? 'user_confirmed' : value.confirmedHypotheses.origin,
    };
    onChange({
      ...value,
      confirmedHypotheses: nextHyp,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className={`smart-configurator ${compact ? 'is-compact' : ''}`}>
      <div className="smart-substep-bar">
        <button
          type="button"
          className={`smart-subtab ${substep === 'cards' ? 'is-active' : ''}`}
          onClick={() => setSubstep('cards')}
        >
          1. Prioridades ({value.selected.length})
        </button>
        <button
          type="button"
          className={`smart-subtab ${substep === 'priority' ? 'is-active' : ''}`}
          onClick={() => setSubstep('priority')}
        >
          2. Jerarquía e hipótesis
        </button>
        <span className="smart-counter-pill" id="smart-selected-count">
          {value.selected.length} seleccionado{value.selected.length === 1 ? '' : 's'}
        </span>
      </div>

      {value.legacySmartGoal?.specific && (
        <div className="smart-legacy-note">
          <b>Objetivo manual previo conservado:</b> {value.legacySmartGoal.specific}
        </div>
      )}

      {substep === 'cards' ? (
        <>
          <div className="smart-filter-row">
            <input
              type="search"
              id="smart-search"
              className="smart-search-input"
              placeholder="Buscar objetivo (ej. esperas, comer sentado, talleres, costes…)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="smart-category-pills" role="tablist" aria-label="Categorías de objetivos">
            <button
              type="button"
              className={`smart-cat-pill ${catFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setCatFilter('all')}
            >
              Todos
            </button>
            {OBJECTIVE_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`smart-cat-pill ${catFilter === c.key ? 'is-active' : ''}`}
                onClick={() => setCatFilter(c.key)}
              >
                <ObjectiveCategoryIcon category={c.key} />
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          <div className="smart-cards-grid" id="smart-cards-grid">
            {filteredCatalog.map((item) => {
              const sel = selectedMap.get(item.id);
              const isSelected = !!sel;
              const cat = OBJECTIVE_CATEGORIES.find((c) => c.key === item.category);
              return (
                <div
                  key={item.id}
                  className={`smart-card-wrap ${isSelected ? 'is-selected' : ''}`}
                >
                  <button
                    type="button"
                    data-smart-card={item.id}
                    aria-pressed={isSelected}
                    className={`smart-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => toggleCard(item.id)}
                  >
                    <span className="smart-card-cat">
                      <ObjectiveCategoryIcon category={item.category} size={13} />
                      <span>{cat?.label}</span>
                    </span>
                    <b className="smart-card-title">{item.label}</b>
                    <small className="smart-card-desc">{item.shortDesc}</small>
                  </button>

                  {isSelected &&
                    (item.contextOptions?.length || item.defaultTarget !== undefined) && (
                      <div className="smart-contextual-panel">
                        {item.contextOptions && item.contextOptions.length > 0 && (
                          <div className="smart-context-chips">
                            <span>¿Dónde aplicar?</span>
                            <div>
                              {item.contextOptions.map((opt) => {
                                const on = (sel.contexts || []).includes(opt.key);
                                return (
                                  <button
                                    key={opt.key}
                                    type="button"
                                    aria-pressed={on}
                                    className={`smart-ctx-chip ${on ? 'is-active' : ''}`}
                                    onClick={() => toggleContextOption(item.id, opt.key)}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {item.defaultTarget !== undefined && (
                          <label className="smart-target-inline">
                            <span>{item.targetLabel || `Meta (${item.unit})`}</span>
                            <input
                              type="number"
                              min={0}
                              max={10000}
                              step="any"
                              value={sel.targetValue ?? item.defaultTarget}
                              onChange={(e) =>
                                updateSelectedItem(item.id, {
                                  targetValue: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        )}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="smart-priority-panel">
          <div className="smart-priority-head">
            <div>
              <h3>¿Qué es lo más importante para ti?</h3>
              <p>
                Clasifica cada objetivo para ponderar alternativas y detectar compromisos.
              </p>
            </div>
            <label className="smart-adv-toggle">
              <input
                type="checkbox"
                checked={advancedMode}
                onChange={(e) => setAdvancedMode(e.target.checked)}
              />{' '}
              Modo avanzado (0–5)
            </label>
          </div>

          {value.selected.length === 0 ? (
            <p className="smart-empty-msg">
              Selecciona al menos una tarjeta en el paso anterior.
            </p>
          ) : (
            <div className="smart-priority-list">
              {value.selected.map((sel) => {
                const def = OBJECTIVE_BY_ID[sel.id];
                if (!def) return null;
                return (
                  <div key={sel.id} className="smart-priority-row">
                    <div>
                      <b>{def.label}</b>
                      <small>
                        Indicadores: {def.indicators.slice(0, 2).join(' · ')} ({def.unit})
                      </small>
                    </div>
                    <div className="smart-priority-controls">
                      {(['essential', 'important', 'desirable'] as ObjectivePriority[]).map(
                        (pr) => (
                          <button
                            key={pr}
                            type="button"
                            className={`smart-prio-btn ${sel.priority === pr ? 'is-active' : ''}`}
                            onClick={() =>
                              updateSelectedItem(sel.id, {
                                priority: pr,
                                weight: undefined,
                              })
                            }
                          >
                            {PRIORITY_LABELS[pr]}
                          </button>
                        )
                      )}
                      {advancedMode && (
                        <input
                          type="number"
                          min={0}
                          max={5}
                          step={1}
                          aria-label={`Peso de ${def.label}`}
                          className="smart-weight-input"
                          value={
                            sel.weight ??
                            (sel.priority === 'essential'
                              ? 5
                              : sel.priority === 'important'
                                ? 3
                                : 1)
                          }
                          onChange={(e) =>
                            updateSelectedItem(sel.id, {
                              weight: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
                            })
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {value.profile.tradeoffs.length > 0 && (
            <div className="smart-tradeoffs-box" id="smart-tradeoffs">
              <b>Compromisos detectados entre objetivos</b>
              {value.profile.tradeoffs.map((t) => (
                <p key={t.id}>
                  <strong>{t.title}:</strong> {t.description}
                </p>
              ))}
            </div>
          )}

          <div className="smart-hypotheses-box" id="smart-hypotheses">
            <div className="smart-hypotheses-head">
              <b>Hipótesis de demanda y comportamiento</b>
              <label className="smart-hyp-confirm">
                <input
                  type="checkbox"
                  id="smart-confirm-hypotheses"
                  checked={value.confirmedHypotheses.confirmed}
                  onChange={(e) => updateHypothesis({confirmed: e.target.checked})}
                />{' '}
                Confirmar uso en simulación
              </label>
            </div>
            <small className="smart-provenance-note">
              Origen: {value.confirmedHypotheses.origin === 'user_confirmed' ? 'Confirmado por el organizador' : 'Sugerido a partir de tus objetivos (no asumido como público real sin confirmación)'}
            </small>
            <div className="smart-mix-row">
              {(
                [
                  ['buyer', 'Compradores'],
                  ['foodie', 'Gastro'],
                  ['culture', 'Cultura/Fam.'],
                  ['music', 'Música'],
                  ['walker', 'Paseo'],
                ] as const
              ).map(([mk, mlabel]) => (
                <label key={mk}>
                  <span>{mlabel} (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={value.confirmedHypotheses.mix[mk] ?? 20}
                    onChange={(e) =>
                      updateHypothesis({
                        confirmed: true,
                        mix: {
                          ...value.confirmedHypotheses.mix,
                          [mk]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="smart-constraints-box">
            <b>Restricciones no negociables</b>
            <ul>
              {NON_NEGOTIABLE_CONSTRAINTS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
