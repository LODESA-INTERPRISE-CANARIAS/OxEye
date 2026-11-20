import React, {useState} from 'react';
import {downloadFile} from '../../db/repository';
import {
  eventGoals,
  eventSchedule,
  goalChart,
} from '../../engine/director/director-logic';
import {useProjectStore} from '../../store/useProjectStore';

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
  const preferences = useProjectStore((s) => s.preferences);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setMenuOpen = useProjectStore((s) => s.setMenuOpen);
  const updatePreferences = useProjectStore((s) => s.updatePreferences);
  const createFromWizard = useProjectStore((s) => s.createFromWizard);
  const showToast = useProjectStore((s) => s.showToast);
  const save = useProjectStore((s) => s.save);

  const [screen, setScreen] = useState<MenuScreen>('main');
  const [step, setStep] = useState(0);
  const [wizardError, setWizardError] = useState('');
  const [settings, setSettings] = useState({
    name: 'Navidad en el Cristo',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    from: '10:00',
    to: '14:00',
    goals: ['family', 'local', 'comfort'],
    example: true,
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

  const canContinue = !!project.scenes.cristo;
  const activeTitle = currentScene().title;

  const handleClose = () => {
    setMenuOpen(false);
    onResume();
    if (preferences.help !== false) {
      showToast(
        'Inventario → Diseñar → Simular → Revisar. Guarda una copia con Exportar proyecto.'
      );
    }
  };

  const handleWizardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
        createFromWizard({...settings, ...schedule});
        setScreen('main');
        onResume();
        return;
      }
      setStep((s) => s + 1);
    } catch (err) {
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
                onClick={() => {
                  setStep(0);
                  setWizardError('');
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
              {activeTitle} ·{' '}
              {canContinue
                ? 'Guardado local disponible'
                : 'Crea tu primer modelo'}
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
          <h1>Partida guardada</h1>
          <p>
            Puedes cerrar esta pestaña. Exporta una copia para trasladar el
            proyecto a otro equipo.
          </p>
          <button
            type="button"
            id="game-export"
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
        </main>
      )}

      {screen === 'preferences' && (
        <main className="game-card">
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
            id="prefs-save"
            onClick={() => {
              updatePreferences({
                speed: prefSpeed,
                reduceMotion: prefMotion,
                help: prefHelp,
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
                <button
                  type="button"
                  className="map-choice"
                  aria-pressed="true"
                >
                  <b>Plaza del Cristo</b>
                  <span>La Laguna · espacio inicial del prototipo</span>
                </button>
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
                  El ejemplo incluye puestos, mesas, cubiertas y accesos que
                  podrás ajustar en el inventario.
                </p>
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
                <p>
                  El montaje y el desmontaje disponen de sus propios turnos de
                  hasta ocho horas.
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
                  <dd>Plaza del Cristo</dd>
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
                  <dt>Objetivos</dt>
                  <dd>
                    {settings.goals
                      .map((k) => eventGoals.find((g) => g[0] === k)?.[1])
                      .join(' · ')}
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
              <button className="game-primary" type="submit">
                {step === 4
                  ? 'Crear modelo y preparar inventario'
                  : 'Siguiente'}
              </button>
            </div>
          </form>
        </main>
      )}
    </div>
  );
};
