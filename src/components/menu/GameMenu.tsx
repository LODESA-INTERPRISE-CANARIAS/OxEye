import React, {useState} from 'react';
import {
  applyPalette,
  COLOR_PALETTES,
  normalizePaletteId,
} from '../../data/palettes';
import {downloadFile} from '../../db/repository';
import {
  DEFAULT_MAP_CENTER,
  fetchOsmVectorContext,
} from '../../engine/cartography/custom-map';
import {
  eventGoals,
  eventSchedule,
  goalChart,
} from '../../engine/director/director-logic';
import {useProjectStore} from '../../store/useProjectStore';
import type {
  CustomLocationConfig,
  PaletteId,
  WorkDayKind,
  WorkShiftDay,
} from '../../types';
import {LocationPicker} from './LocationPicker';

const shiftDateByDays = (isoDate: string, delta: number): string => {
  const d = new Date(isoDate + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const computeShiftHours = (from: string, to: string): number => {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  if (![fh, fm, th, tm].every(Number.isFinite)) return 0;
  let diff = th + tm / 60 - (fh + fm / 60);
  if (diff <= 0) diff += 24;
  return Math.round(diff * 10) / 10;
};

export interface GameMenuProps {
  onResume: () => void;
}

type MenuScreen = 'main' | 'wizard' | 'preferences' | 'credits' | 'exit';

/**
 * Fullscreen launch screen & 4-step new-model wizard (`#game-menu`).
 */
export const GameMenu: React.FC<GameMenuProps> = ({onResume}) => {
  const menuOpen = useProjectStore((s) => s.menuOpen);
  const project = useProjectStore((s) => s.project);
  const hasSavedProject = useProjectStore((s) => s.hasSavedProject);
  const preferences = useProjectStore((s) => s.preferences);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setMenuOpen = useProjectStore((s) => s.setMenuOpen);
  const setTutorialActive = useProjectStore((s) => s.setTutorialActive);
  const updatePreferences = useProjectStore((s) => s.updatePreferences);
  const createFromWizard = useProjectStore((s) => s.createFromWizard);
  const showToast = useProjectStore((s) => s.showToast);
  const save = useProjectStore((s) => s.save);

  const [screen, setScreen] = useState<MenuScreen>('main');
  const [step, setStep] = useState(0);
  const [wizardError, setWizardError] = useState('');
  const [creatingModel, setCreatingModel] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [settings, setSettings] = useState<{
    name: string;
    locationMode: 'cristo' | 'custom';
    customLocation: CustomLocationConfig;
    startDate: string;
    endDate: string;
    from: string;
    to: string;
    goals: string[];
    example: boolean;
    startTutorial: boolean;
    workDays: WorkShiftDay[];
    smartGoal: {
      specific: string;
      metric: string;
      target: string;
      feasible: string;
      relevant: string;
      deadline: string;
    };
  }>({
    name: 'Navidad en el Cristo',
    locationMode: 'cristo',
    customLocation: {
      lat: DEFAULT_MAP_CENTER.lat,
      lon: DEFAULT_MAP_CENTER.lon,
      label: DEFAULT_MAP_CENTER.label,
      sizeMeters: DEFAULT_MAP_CENTER.sizeMeters,
    },
    startDate: today,
    endDate: today,
    from: '10:00',
    to: '14:00',
    goals: ['family', 'local', 'comfort'],
    example: true,
    startTutorial: !hasSavedProject,
    workDays: [
      {
        id: 'wd-pre-1',
        name: 'Montaje previo',
        kind: 'pre',
        date: shiftDateByDays(today, -1),
        from: '08:00',
        to: '16:00',
        hours: 8,
      },
      {
        id: 'wd-post-1',
        name: 'Recogida y limpieza',
        kind: 'post',
        date: shiftDateByDays(today, 1),
        from: '08:00',
        to: '16:00',
        hours: 8,
      },
    ],
    smartGoal: {
      specific: '',
      metric: '',
      target: '',
      feasible: '',
      relevant: '',
      deadline: '',
    },
  });

  const [prefSpeed, setPrefSpeed] = useState(preferences.speed);
  const [prefMotion, setPrefMotion] = useState(preferences.reduceMotion);
  const [prefHelp, setPrefHelp] = useState(preferences.help);
  const [prefPalette, setPrefPalette] = useState<PaletteId>(
    normalizePaletteId(preferences.palette)
  );

  const canContinue = hasSavedProject && !!project.scenes.cristo;
  const activeTitle = currentScene().title;

  const handleClose = () => {
    if (!canContinue) return;
    setMenuOpen(false);
    onResume();
    if (preferences.help !== false) {
      showToast(
        'Inventario → Diseñar → Simular → Revisar. Guarda una copia con Exportar proyecto.'
      );
    }
  };

  const handleWizardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingModel) return;
    setWizardError('');
    try {
      if (step === 0) {
        const sg = settings.smartGoal;
        for (const k of [
          'specific',
          'metric',
          'target',
          'feasible',
          'relevant',
          'deadline',
        ] as const) {
          if (!sg[k]?.trim()) {
            throw new Error('Completa los seis campos del objetivo.');
          }
        }
      }
      if (step === 1) {
        const trimmed = settings.name.trim();
        if (!trimmed) throw new Error('Escribe un nombre.');
        setSettings((prev) => ({...prev, name: trimmed}));
      }
      if (step === 2) {
        eventSchedule(
          settings.startDate,
          settings.endDate,
          settings.from,
          settings.to
        );
        for (const wd of settings.workDays) {
          if (!wd.name.trim()) {
            throw new Error('Escribe un nombre para cada jornada añadida.');
          }
          if (!wd.date) {
            throw new Error(`Indica la fecha de «${wd.name}».`);
          }
          const hrs = computeShiftHours(wd.from, wd.to);
          if (hrs < 0.5 || hrs > 12) {
            throw new Error(
              `El horario de «${wd.name}» debe durar entre 0,5 y 12 horas.`
            );
          }
        }
      }
      if (step === 3 && !settings.goals.length) {
        throw new Error('Selecciona al menos un objetivo.');
      }
      if (step === 4) {
        const schedule = eventSchedule(
          settings.startDate,
          settings.endDate,
          settings.from,
          settings.to
        );
        const normalizedWorkDays = settings.workDays.map((wd) => ({
          ...wd,
          name: wd.name.trim(),
          hours: computeShiftHours(wd.from, wd.to),
        }));
        let customLoc: CustomLocationConfig | undefined;
        if (settings.locationMode === 'custom') {
          setCreatingModel(true);
          const {streets, features} = await fetchOsmVectorContext(
            settings.customLocation.lat,
            settings.customLocation.lon,
            settings.customLocation.sizeMeters,
            6000
          );
          customLoc = {
            ...settings.customLocation,
            streets,
            features,
          };
          setCreatingModel(false);
        }
        createFromWizard({
          ...settings,
          ...schedule,
          workDays: normalizedWorkDays,
          customLocation: customLoc,
          startTutorial: settings.startTutorial,
        });
        setScreen('main');
        onResume();
        return;
      }
      setStep((s) => s + 1);
    } catch (err) {
      setCreatingModel(false);
      setWizardError((err as Error).message);
    }
  };

  const toggleGoal = (key: string) => {
    setSettings((prev) => ({
      ...prev,
      goals: prev.goals.includes(key)
        ? prev.goals.filter((g) => g !== key)
        : [...prev.goals, key],
    }));
  };

  const titles = [
    'Objetivo SMART',
    'Elige el lugar',
    'Fechas y horario',
    'El carácter del evento',
    'Revisa tu modelo',
  ];

  return (
    <div id="game-menu" className="game-menu" hidden={!menuOpen}>
      {screen === 'main' && (
        <>
          <main className="game-card">
            <span className="game-eyebrow">SAN CRISTÓBAL DE LA LAGUNA</span>
            <h1>Ojo de Buey</h1>
            <p>
              Imagina el evento.
              <br />
              Ensaya cada decisión.
            </p>
            <nav className="game-actions">
              <button
                type="button"
                id="game-continue"
                disabled={!canContinue}
                title={
                  canContinue
                    ? 'Retomar la última sesión guardada'
                    : 'Crea o carga primero un proyecto para poder continuar'
                }
                onClick={handleClose}
              >
                Continuar
              </button>
              <button
                type="button"
                id="game-load"
                onClick={() => document.getElementById('file')?.click()}
              >
                Cargar modelo
              </button>
              <button
                type="button"
                id="game-new"
                className={!canContinue ? 'game-primary' : ''}
                onClick={() => {
                  setStep(0);
                  setWizardError('');
                  setSettings((prev) => ({
                    ...prev,
                    startTutorial: !hasSavedProject,
                  }));
                  setScreen('wizard');
                }}
              >
                Crear nuevo modelo
              </button>
              <button
                type="button"
                id="game-settings"
                onClick={() => {
                  setPrefSpeed(preferences.speed);
                  setPrefMotion(preferences.reduceMotion);
                  setPrefHelp(preferences.help);
                  setPrefPalette(normalizePaletteId(preferences.palette));
                  setScreen('preferences');
                }}
              >
                Ajustes
              </button>
              <button
                type="button"
                id="game-credits"
                onClick={() => setScreen('credits')}
              >
                Créditos
              </button>
              <button
                type="button"
                id="game-exit"
                onClick={() => {
                  save();
                  setScreen('exit');
                }}
              >
                Salir
              </button>
            </nav>
            <small>
              {canContinue
                ? `${activeTitle} · Guardado local disponible`
                : 'Sin sesión previa · Crea o carga un proyecto para comenzar'}
            </small>
          </main>
          <aside className="game-visual">
            <div className="game-ring"></div>
            <span>PLANIFICAR · CELEBRAR · RECUPERAR</span>
          </aside>
        </>
      )}

      {screen === 'credits' && (
        <main className="game-card">
          <h1>Créditos</h1>
          <p>Ojo de Buey · proyecto de Yeray López de Saja.</p>
          <p>
            Cartografía © OpenStreetMap contributors, ODbL. Ortofotografía
            PNOA–IGN, CC BY 4.0.
          </p>
          <p>
            Prototipo independiente de planificación. Parámetros locales
            pendientes de contraste técnico.
          </p>
          <button
            type="button"
            id="game-back"
            onClick={() => setScreen('main')}
          >
            Volver
          </button>
        </main>
      )}

      {screen === 'exit' && (
        <main className="game-card">
          <h1>Sesión guardada</h1>
          <p>
            Puedes cerrar esta pestaña. Exporta una copia para trasladar el
            proyecto a otro equipo.
          </p>
          <div className="game-exit-actions">
            <button
              type="button"
              id="game-export"
              className="game-primary"
              onClick={() => {
                save();
                downloadFile(
                  'Ojo_de_Buey_Proyecto.json',
                  JSON.stringify(project, null, 2)
                );
                showToast(
                  'Proyecto exportado con los tres espacios y sus observaciones.'
                );
              }}
            >
              Exportar proyecto
            </button>
            <button
              type="button"
              id="game-back"
              onClick={() => setScreen('main')}
            >
              Volver
            </button>
          </div>
        </main>
      )}

      {screen === 'preferences' && (
        <main className="game-card preferences-card">
          <h1>Ajustes</h1>
          <label>
            Velocidad inicial
            <select
              id="game-speed"
              value={prefSpeed}
              onChange={(e) => setPrefSpeed(Number(e.target.value))}
            >
              {[1, 5, 10, 60, 120, 600, 1200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="palette-picker" role="radiogroup" aria-label="Paleta de color">
            <span className="palette-picker-label">Paleta de color</span>
            <div className="palette-grid">
              {COLOR_PALETTES.map((pal) => {
                const selected = prefPalette === pal.id;
                return (
                  <button
                    key={pal.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-palette-choice={pal.id}
                    className={`palette-card ${selected ? 'is-selected' : ''}`}
                    onClick={() => {
                      setPrefPalette(pal.id);
                      applyPalette(pal.id);
                    }}
                  >
                    <span className="palette-swatches" aria-hidden="true">
                      {pal.swatches.map((hex, i) => (
                        <i key={i} style={{background: hex}} />
                      ))}
                    </span>
                    <span className="palette-card-name">
                      {pal.code} · {pal.name}
                    </span>
                    {selected && (
                      <small className="palette-card-status">
                        ✓ Seleccionada
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <label>
            <input
              id="game-motion"
              type="checkbox"
              checked={prefMotion}
              onChange={(e) => setPrefMotion(e.target.checked)}
            />{' '}
            Reducir efectos visuales
          </label>
          <label>
            <input
              id="game-help"
              type="checkbox"
              checked={prefHelp}
              onChange={(e) => setPrefHelp(e.target.checked)}
            />{' '}
            Mostrar guía al entrar
          </label>
          <button
            type="button"
            id="game-open-tutorial"
            disabled={!canContinue}
            title={
              canContinue
                ? 'Abrir el tutorial interactivo sobre el proyecto actual'
                : 'Crea o carga primero un proyecto para abrir la guía de uso'
            }
            onClick={() => {
              if (!canContinue) return;
              setScreen('main');
              setMenuOpen(false);
              setTutorialActive(true);
              onResume();
            }}
          >
            Guía de uso (iniciar tutorial)
          </button>
          <button
            type="button"
            id="prefs-save"
            className="game-primary"
            onClick={() => {
              updatePreferences({
                speed: prefSpeed,
                reduceMotion: prefMotion,
                help: prefHelp,
                palette: prefPalette,
              });
              setScreen('main');
            }}
          >
            Guardar y volver
          </button>
        </main>
      )}

      {screen === 'wizard' && (
        <main className="game-card wizard">
          <span className="game-eyebrow">{step + 1} / 5 · NUEVO MODELO</span>
          <h1>{titles[step]}</h1>
          <form id="wizard-form" onSubmit={handleWizardSubmit}>
            {step === 0 && (
              <>
                <p>
                  Define primero qué quieres conseguir y cómo comprobarás el
                  resultado. Es una meta de proyecto; no un resultado calculado.
                </p>
                {(
                  [
                    ['specific', 'Resultado concreto'],
                    ['metric', 'Indicador y unidad'],
                    ['target', 'Valor objetivo'],
                    ['feasible', 'Recursos y viabilidad'],
                    ['relevant', 'A quién beneficia y por qué'],
                    ['deadline', 'Fecha límite'],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <input
                      required
                      id={`smart-${k}`}
                      type={k === 'deadline' ? 'date' : 'text'}
                      maxLength={250}
                      value={settings.smartGoal[k]}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          smartGoal: {
                            ...prev.smartGoal,
                            [k]: e.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                ))}
              </>
            )}

            {step === 1 && (
              <>
                <div className="location-mode-grid">
                  <button
                    type="button"
                    id="location-mode-cristo"
                    className={`map-choice ${settings.locationMode === 'cristo' ? 'is-selected' : ''}`}
                    aria-pressed={settings.locationMode === 'cristo'}
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        locationMode: 'cristo',
                      }))
                    }
                  >
                    <b>Plaza del Cristo</b>
                    <span>La Laguna · espacio de referencia</span>
                  </button>
                  <button
                    type="button"
                    id="location-mode-custom"
                    className={`map-choice ${settings.locationMode === 'custom' ? 'is-selected' : ''}`}
                    aria-pressed={settings.locationMode === 'custom'}
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        locationMode: 'custom',
                        example: false,
                        name:
                          prev.name === 'Navidad en el Cristo'
                            ? 'Mi evento personalizado'
                            : prev.name,
                      }))
                    }
                  >
                    <b>Elegir en el mapa real</b>
                    <span>Centro libre y área cuadrada editable</span>
                  </button>
                </div>

                {settings.locationMode === 'custom' && (
                  <LocationPicker
                    value={settings.customLocation}
                    onChange={(nextLoc) =>
                      setSettings((prev) => ({
                        ...prev,
                        customLocation: nextLoc,
                      }))
                    }
                    onLabelPicked={(shortName) =>
                      setSettings((prev) => ({
                        ...prev,
                        name:
                          !prev.name.trim() ||
                          prev.name === 'Mi evento personalizado' ||
                          prev.name === 'Navidad en el Cristo'
                            ? `Evento en ${shortName}`
                            : prev.name,
                      }))
                    }
                  />
                )}

                <label>
                  Nombre del modelo
                  <input
                    id="wizard-name"
                    maxLength={100}
                    required
                    value={settings.name}
                    onChange={(e) =>
                      setSettings((prev) => ({...prev, name: e.target.value}))
                    }
                  />
                </label>
                {settings.locationMode === 'cristo' ? (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        id="wizard-example"
                        checked={settings.example}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            example: e.target.checked,
                          }))
                        }
                      />{' '}
                      Usar el ejemplo de Navidad como base
                    </label>
                    <p>
                      Tras elegir la zona, primero delimitarás el perímetro
                      operativo sobre el mapa y después confirmarás el
                      inventario.
                    </p>
                  </>
                ) : (
                  <p>
                    El punto seleccionado actuará como centro de la escena. Al
                    entrar, primero dibujarás el perímetro del evento y luego
                    definirás el inventario.
                  </p>
                )}

                <div className="wizard-tutorial-card">
                  <label className="wizard-tutorial-toggle">
                    <input
                      type="checkbox"
                      id="wizard-tutorial"
                      checked={settings.startTutorial}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          startTutorial: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      <b>Iniciar tutorial guiado al crear el proyecto</b>
                      <small>
                        Visita guiada paso a paso por los elementos básicos del
                        plano, fases, herramientas y simulación, previo a todo
                        lo demás.
                      </small>
                    </span>
                  </label>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="wizard-fields">
                  <label>
                    Primer día
                    <input
                      required
                      id="wizard-startDate"
                      type="date"
                      value={settings.startDate}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          startDate: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Último día
                    <input
                      required
                      id="wizard-endDate"
                      type="date"
                      value={settings.endDate}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          endDate: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Apertura diaria
                    <input
                      required
                      id="wizard-from"
                      type="time"
                      step="3600"
                      value={settings.from}
                      onChange={(e) =>
                        setSettings((prev) => ({...prev, from: e.target.value}))
                      }
                    />
                  </label>
                  <label>
                    Cierre diario
                    <input
                      required
                      id="wizard-to"
                      type="time"
                      step="3600"
                      value={settings.to}
                      onChange={(e) =>
                        setSettings((prev) => ({...prev, to: e.target.value}))
                      }
                    />
                  </label>
                </div>
                <div className="wizard-shifts">
                  <div className="wizard-shifts-head">
                    <b>Jornadas de montaje, recogida y limpieza</b>
                    <button
                      type="button"
                      id="wizard-add-shift"
                      className="wizard-add-shift-btn"
                      onClick={() => {
                        const idx = settings.workDays.length + 1;
                        setSettings((prev) => ({
                          ...prev,
                          workDays: [
                            ...prev.workDays,
                            {
                              id: crypto.randomUUID(),
                              name: `Jornada ${idx} · montaje/recogida`,
                              kind: 'pre',
                              date: shiftDateByDays(prev.startDate, -1),
                              from: '08:00',
                              to: '14:00',
                              hours: 6,
                            },
                          ],
                        }));
                      }}
                    >
                      + Añadir jornada
                    </button>
                  </div>
                  {settings.workDays.length === 0 ? (
                    <p className="wizard-shifts-empty">
                      Sin jornadas específicas: se usará un turno genérico de 8 h
                      por fase.
                    </p>
                  ) : (
                    <div className="wizard-shifts-list">
                      {settings.workDays.map((wd) => {
                        const hrs = computeShiftHours(wd.from, wd.to);
                        const updateWd = (patch: Partial<WorkShiftDay>) =>
                          setSettings((prev) => ({
                            ...prev,
                            workDays: prev.workDays.map((item) => {
                              if (item.id !== wd.id) return item;
                              const next = {...item, ...patch};
                              next.hours = computeShiftHours(next.from, next.to);
                              return next;
                            }),
                          }));
                        return (
                          <div key={wd.id} className="wizard-shift-card">
                            <div className="wizard-shift-top">
                              <label className="wizard-shift-field">
                                <span>Nombre</span>
                                <input
                                  type="text"
                                  aria-label="Nombre de la jornada"
                                  placeholder="Ej. Montaje escenario"
                                  maxLength={80}
                                  value={wd.name}
                                  onChange={(e) =>
                                    updateWd({name: e.target.value})
                                  }
                                />
                              </label>
                              <label className="wizard-shift-field">
                                <span>Fase</span>
                                <select
                                  aria-label="Tipo de jornada"
                                  value={wd.kind}
                                  onChange={(e) =>
                                    updateWd({
                                      kind: e.target.value as WorkDayKind,
                                    })
                                  }
                                >
                                  <option value="pre">Montaje (Pre)</option>
                                  <option value="post">
                                    Recogida y limpieza (Post)
                                  </option>
                                </select>
                              </label>
                              <div className="wizard-shift-meta">
                                <span className="wizard-shift-hours">
                                  {hrs} h
                                </span>
                                <button
                                  type="button"
                                  className="wizard-shift-remove"
                                  aria-label={`Eliminar ${wd.name}`}
                                  title="Eliminar jornada"
                                  onClick={() =>
                                    setSettings((prev) => ({
                                      ...prev,
                                      workDays: prev.workDays.filter(
                                        (item) => item.id !== wd.id
                                      ),
                                    }))
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            <div className="wizard-shift-bottom">
                              <label className="wizard-shift-field">
                                <span>Fecha</span>
                                <input
                                  type="date"
                                  aria-label="Fecha de la jornada"
                                  value={wd.date}
                                  onChange={(e) =>
                                    updateWd({date: e.target.value})
                                  }
                                />
                              </label>
                              <label className="wizard-shift-field">
                                <span>Inicio</span>
                                <input
                                  type="time"
                                  aria-label="Hora de inicio"
                                  step="1800"
                                  value={wd.from}
                                  onChange={(e) =>
                                    updateWd({from: e.target.value})
                                  }
                                />
                              </label>
                              <label className="wizard-shift-field">
                                <span>Fin</span>
                                <input
                                  type="time"
                                  aria-label="Hora de fin"
                                  step="1800"
                                  value={wd.to}
                                  onChange={(e) =>
                                    updateWd({to: e.target.value})
                                  }
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <p>
                  Las horas de cada jornada de montaje y recogida determinan el
                  tiempo disponible real en los turnos logísticos y su cálculo de
                  costes.
                </p>
              </>
            )}

            {step === 3 && (
              <>
                <p>
                  Selecciona los objetivos que deberán guiar la propuesta y su
                  evaluación.
                </p>
                <div className="goal-buttons">
                  {eventGoals.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      data-goal-choice={k}
                      aria-pressed={settings.goals.includes(k)}
                      onClick={() => toggleGoal(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  id="wizard-radar"
                  dangerouslySetInnerHTML={{
                    __html: goalChart(settings.goals),
                  }}
                />
                <p>El gráfico expresa prioridades seleccionadas.</p>
              </>
            )}

            {step === 4 && (
              <>
                <dl>
                  <dt>Ubicación</dt>
                  <dd>
                    {settings.locationMode === 'custom'
                      ? `${settings.customLocation.label} · ${settings.customLocation.sizeMeters} × ${settings.customLocation.sizeMeters} m`
                      : 'Plaza del Cristo'}
                  </dd>
                  <dt>Modelo</dt>
                  <dd>{settings.name}</dd>
                  <dt>Fechas</dt>
                  <dd>
                    {settings.startDate} — {settings.endDate}
                  </dd>
                  <dt>Horario</dt>
                  <dd>
                    {settings.from} — {settings.to}
                  </dd>
                  {settings.workDays.length > 0 && (
                    <>
                      <dt>Jornadas logísticas</dt>
                      <dd>
                        {settings.workDays
                          .map(
                            (wd) =>
                              `${wd.name} (${wd.kind === 'pre' ? 'Montaje' : 'Recogida'} · ${wd.date} · ${computeShiftHours(wd.from, wd.to)} h)`
                          )
                          .join(' · ')}
                      </dd>
                    </>
                  )}
                  <dt>Objetivos</dt>
                  <dd>
                    {settings.goals
                      .map((k) => eventGoals.find((g) => g[0] === k)?.[1])
                      .join(' · ')}
                  </dd>
                  <dt>Tutorial inicial</dt>
                  <dd>
                    {settings.startTutorial
                      ? 'Activado (visita guiada antes de empezar)'
                      : 'Desactivado'}
                  </dd>
                </dl>
                <p>
                  Se sustituirá el modelo activo del Cristo. Puedes volver al
                  menú y exportar el proyecto antes de crear otro.
                </p>
              </>
            )}

            <p id="wizard-error" role="alert">
              {wizardError}
            </p>
            <div className="wizard-nav">
              <button
                type="button"
                id="wizard-back"
                onClick={() => {
                  setWizardError('');
                  if (step > 0) setStep((s) => s - 1);
                  else setScreen('main');
                }}
              >
                {step ? 'Anterior' : 'Menú principal'}
              </button>
              <button
                className="game-primary"
                type="submit"
                disabled={creatingModel}
              >
                {creatingModel
                  ? 'Preparando cartografía…'
                  : step === 4
                    ? 'Crear modelo y delimitar perímetro'
                    : 'Siguiente'}
              </button>
            </div>
          </form>
        </main>
      )}
    </div>
  );
};
