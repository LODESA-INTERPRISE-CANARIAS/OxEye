import React, {useRef, useState} from 'react';
import {CATALOG, ICONS} from '../../data/catalog';
import {MAPS_DATA} from '../../data/geodata';
import {downloadFile, exportNotesCSV} from '../../db/repository';
import {cellAt, polylineLength, world} from '../../engine/cartography/geometry';
import type {EventEngine} from '../../engine/crowd/event-engine';
import {
  applyLiveArrivals,
  applyLiveWeather,
} from '../../engine/director/director-logic';
import {INCIDENTS} from '../../engine/emergency/emergency-lab';
import {addResponseExample} from '../../engine/emergency/response-example';
import {serviceLoad} from '../../engine/emergency/response-model';
import {
  analyze,
  TOPICS,
} from '../../engine/experience/experience-monitor';
import {deferIssue} from '../../engine/experience/review-memory';
import {membership, phaseScene} from '../../engine/logistics/phases';
import {type LayoutOptions, redesign} from '../../engine/planning/layout';
import {useProjectStore} from '../../store/useProjectStore';
import type {LensMode, PhaseKey, PolygonElement} from '../../types';
import {PostSimDiagnosticsView} from '../modals/PostSimDiagnosticsView';

export interface ProposalState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  moves: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  objects: any[];
  zones: Array<{id: string; x: number; y: number; w: number; h: number}>;
  routing?: {
    fences: PolygonElement[];
    flows: PolygonElement[];
    corridors: PolygonElement[];
  };
  reason: string;
}

export interface SidebarProps {
  engine: EventEngine | null;
  running: boolean;
  layoutOptions: LayoutOptions;
  onLayoutOptionsChange: (opts: LayoutOptions) => void;
  proposal: ProposalState | null;
  showAlternative: boolean;
  onSetProposal: (p: ProposalState | null) => void;
  onToggleAlternative: () => void;
  onApplyProposal: () => void;
  onTogglePlay: () => void;
  onSceneChanged: () => void;
  onRecordAction: (kind: string, value: unknown) => void;
  reviewTick: number;
  safetyStop?: boolean;
}

const designHistory = new Map<
  string,
  Array<Array<{id: string; x: number; y: number; w: number; h: number}>>
>();

const panelTexts = {
  design: [
    '01 / PLANIFICACIÓN',
    'El evento,\nsobre el terreno.',
    'Diseña el espacio. Comprueba cómo se relacionan sus piezas.',
  ],
  simulate: [
    '02 / SIMULACIÓN',
    'Antes de abrir,\nensaya.',
    'Compara hipótesis de público, atención y clima.',
  ],
  review: [
    '03 / REVISIÓN',
    'Un lugar.\nMuchas miradas.',
    'Anota lo que cambiarías y sitúalo con precisión.',
  ],
} as const;

const itemColor = (o: {kind?: string; type?: string; role?: string}): string =>
  (o.kind && CATALOG[o.kind]?.color) ||
  (o.type && CATALOG[o.type]?.color) ||
  (o.role && CATALOG[o.role]?.color) ||
  '#bac7ac';

const num = (n: number): string =>
  Number(n).toLocaleString('es-ES', {maximumFractionDigits: 1});

const statuses: Record<string, string> = {
  owner: 'Primera intervención',
  pending: 'Aviso',
  waiting: 'Sin recurso disponible',
  assigned: 'En camino',
  assisting: 'Atendiendo',
  resolved: 'Resuelto',
  blocked: 'Acceso bloqueado',
  waiting_transport: 'Esperando ambulancia',
};

/**
 * Left contextual sidebar (`#sidebar`) rendering Planificar, Simular (with Director controls), and Revisar panels.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  engine,
  running,
  layoutOptions,
  onLayoutOptionsChange,
  proposal,
  showAlternative,
  onSetProposal,
  onToggleAlternative,
  onApplyProposal,
  onTogglePlay,
  onSceneChanged,
  onRecordAction,
  reviewTick,
  safetyStop = false,
}) => {
  const lastSourceRef = useRef<string | null>(null);
  const project = useProjectStore((s) => s.project);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const panel = useProjectStore((s) => s.panel);
  const phase = useProjectStore((s) => s.phase);
  const tool = useProjectStore((s) => s.tool);
  const grid = useProjectStore((s) => s.grid);
  const lens = useProjectStore((s) => s.lens);
  const daylight = useProjectStore((s) => s.daylight);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const revision = useProjectStore((s) => s.revision);

  const setTool = useProjectStore((s) => s.setTool);
  const setSelectedId = useProjectStore((s) => s.setSelectedId);
  const [catalogFilter, setCatalogFilter] = useState<
    'all' | 'event' | 'services' | 'logistics'
  >('all');
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setLens = useProjectStore((s) => s.setLens);
  const setDaylight = useProjectStore((s) => s.setDaylight);
  const setPanel = useProjectStore((s) => s.setPanel);
  const updateScene = useProjectStore((s) => s.updateScene);
  const replaceScene = useProjectStore((s) => s.replaceScene);
  const showToast = useProjectStore((s) => s.showToast);

  void revision;
  void reviewTick;

  const s = currentScene();
  const m = currentMap();
  const allObjects = [
    ...s.base.booths,
    ...s.infrastructure,
    ...s.entrances,
  ];
  const stock = s.pendingStock || [];

  const [onlyMove, setOnlyMove] = useState(s.base.booths.length > 0);
  const [layoutIntent, setLayoutIntent] = useState('auto');
  const [replanDemo, setReplanDemo] = useState(true);

  const logDirector = (text: string) => {
    updateScene((sc) => {
      sc.directorLog ??= [];
      sc.directorLog.push({time: engine?.time || 0, text});
      sc.directorLog = sc.directorLog.slice(-40);
    });
  };

  const handleGenerateLayout = () => {
    onSetProposal(null);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    try {
      const current = phaseScene(
        s,
        phase === 'all' ? 'event' : (phase as PhaseKey)
      );
      const opts = {...layoutOptions, seed, onlyMove};
      const historyKey =
        activeVenue +
        ':' +
        phase +
        ':' +
        JSON.stringify([
          s.boundary,
          s.base.booths,
          s.infrastructure,
          s.flows,
          s.fences,
        ]);
      const hist = designHistory.get(historyKey) || [];
      const strategy =
        layoutIntent === 'auto' ? hist.length % 3 : Number(layoutIntent);
      const res = redesign(
        current,
        m,
        {...opts, strategy, allowReplan: replanDemo},
        hist.slice(-3)
      );
      if (res.zones) {
        hist.push(res.zones);
        designHistory.set(historyKey, hist);
      }
      onSetProposal(res);
    } catch (err) {
      onSetProposal(null);
      showToast(
        'No se pudo generar la propuesta: ' + (err as Error).message
      );
    }
  };

  const handleIncidentClick = (incType: string) => {
    if (safetyStop) return;
    if (!engine) {
      onTogglePlay();
    }
    const activeEngine = engine;
    if (!activeEngine) return;
    if (
      ['fall', 'conflict'].includes(incType) &&
      !activeEngine.agents.length
    ) {
      showToast(
        'Deja entrar a las primeras personas antes de provocar este incidente.'
      );
      return;
    }
    const eligible = activeEngine.stations.filter(
      (o) =>
        o.type === (incType === 'fire' ? 'food' : 'commerce') &&
        !activeEngine.emergency.isClosed(o.id || '')
    );
    const choices =
      eligible.length > 1
        ? eligible.filter((o) => o.id !== lastSourceRef.current)
        : eligible;
    const sourceId = choices.length
      ? choices[
          crypto.getRandomValues(new Uint32Array(1))[0] % choices.length
        ].id || null
      : null;
    const ev = activeEngine.emergency.inject(incType, sourceId);
    if (ev?.stationId) lastSourceRef.current = ev.stationId;
    if (!ev) {
      showToast(
        'El incidente necesita un puesto compatible o una persona disponible.'
      );
      return;
    }
    onRecordAction('inject', {type: incType, sourceId: ev.stationId});
    logDirector('Incidente: ' + (INCIDENTS[incType]?.name || incType));
    showToast('Incidencia ficticia añadida. Observa su evolución en el plano.');
  };

  const snap = engine?.snapshot();
  const diningSum = engine?.dining.summary();
  const simMetricsRows: Array<[string, string | number]> = [
    ['Comidas entregadas', diningSum?.meals ?? '-'],
    ['Comiendo sentados', diningSum?.occupied ?? '-'],
    ['Comidas consumidas de pie', diningSum?.standing ?? '-'],
    ['Plazas secas', diningSum?.seats ?? '-'],
    ['Mesas mojadas', diningSum?.wet ?? '-'],
    [
      'Capacidad de comida (servicios/h)',
      diningSum ? num(diningSum.foodHourly) : '-',
    ],
    [
      'Rotación de asientos secos (comidas/h)',
      diningSum ? num(diningSum.seatHourly) : '-',
    ],
    ['Secados completados', diningSum?.dried ?? '-'],
    ['Llegadas', snap ? num(snap.arrivals) : '—'],
    ['Atenciones', snap ? num(snap.served) : '—'],
    ['Abandonos de cola', snap ? num(snap.abandoned) : '—'],
    ['Espera media atendida', snap ? num(snap.averageWait) + ' min' : '—'],
    ['Superficie transitable', snap ? num(snap.area) + ' m²' : '—'],
  ];

  const activeWeather = engine?.s.base.weather || s.base.weather;
  const emergencyEvents = engine?.emergency.events || [];
  const openEmergencyEvents = emergencyEvents
    .filter((r) => r.status !== 'resolved' && r.status !== 'unreported')
    .slice()
    .reverse();
  const closedEmergencyEvents = emergencyEvents.filter(
    (r) => r.status === 'resolved'
  );
  const recentLogs = (s.directorLog || [])
    .filter((r) => !r.text.startsWith('Incidente:'))
    .slice(-3)
    .reverse();

  const experienceRows = engine?.experience?.list() || [];
  const activeExp = experienceRows.filter((r) => r.status === 'active');
  const prevExp = experienceRows.filter((r) => r.status !== 'active');
  const expActions = engine ? analyze(engine) : [];
  const complaintsList = engine ? engine.complaints() : [];

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-heading">
        <span className="eyebrow" id="panel-kicker">
          {panelTexts[panel][0]}
        </span>
        <h1 id="panel-title">
          {panelTexts[panel][1].split('\n').map((line, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <br />}
              {line}
            </React.Fragment>
          ))}
        </h1>
        <p id="panel-desc">{panelTexts[panel][2]}</p>
      </div>

      <div id="panel-content">
        {panel === 'design' && (
          <>
            <section className="panel-section">
              <div className="section-label">
                1. INVENTARIO{' '}
                <small>{allObjects.length + stock.length} piezas</small>
              </div>
              <button
                type="button"
                id="edit-stock"
                className="dark wide"
                onClick={() => setActiveModal('inventory')}
              >
                Modificar inventario
              </button>
              {stock.length > 0 && (
                <div className="stock-pending">
                  <p className="small-note">
                    {stock.length} por ubicar. Elige una y pulsa sobre el plano.
                  </p>
                  <div className="stock-pending-list">
                    {stock.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="quiet wide"
                        data-stock={o.id}
                        onClick={() => setTool('stock:' + o.id)}
                      >
                        {o.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="panel-section">
              <div className="section-label">
                2. DISTRIBUCIÓN <small>Manual o automática</small>
              </div>
              <div className="sub-section">
                <div className="sub-label">
                  ESCENARIO <small>PROPUESTA</small>
                </div>
                <input
                  id="scenario-name"
                  className="name-input"
                  aria-label="Nombre del escenario"
                  maxLength={100}
                  key={`title-${activeVenue}-${s.title}`}
                  defaultValue={s.title}
                  onBlur={(e) => {
                    const nextTitle = e.target.value.trim() || 'Mi evento';
                    if (nextTitle !== s.title) {
                      updateScene((sc) => {
                        sc.title = nextTitle;
                      }, true);
                    }
                  }}
                />
              </div>
              <details className="accordion-card">
                <summary>Autoconfigurar espacio</summary>
                <div className="accordion-body">
                  <p className="small-note">
                    Ajusta la mezcla de piezas y compara la vista previa sobre el
                    plano.
                  </p>
                <label className="form-label">
                  Organización del espacio
                  <select
                    id="layout-intent"
                    value={layoutIntent}
                    onChange={(e) => {
                      setLayoutIntent(e.target.value);
                      onSetProposal(null);
                    }}
                  >
                    <option value="auto">Comparar conceptos sucesivos</option>
                    <option value="0">Patio central</option>
                    <option value="1">Paseo longitudinal</option>
                    <option value="2">Islas de actividad</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    id="replan-demo"
                    checked={replanDemo}
                    onChange={(e) => {
                      setReplanDemo(e.target.checked);
                      onSetProposal(null);
                    }}
                  />{' '}
                  Replantear ramales y vallas del ejemplo
                </label>
                <p className="small-note">
                  La propuesta retira las guías de colas, vallas de escenario y
                  ramales secundarios predefinidos para revisar su trazado.
                  Conserva el eje principal y las salidas.
                </p>
                <details>
                  <summary>Parámetros de diseño</summary>
                  <div id="layout-controls">
                    {(
                      [
                        ['count', 'Elementos a añadir', 1, 36, 1, ''],
                        ['space', 'Separación de diseño', 0.5, 8, 0.5, ' m'],
                        ['scale', 'Tamaño de las piezas', 0.5, 2, 0.1, '×'],
                        ['commerce', 'Prioridad de comercio', 0, 100, 5, ''],
                        ['rest', 'Prioridad de descanso', 0, 100, 5, ''],
                        ['cover', 'Prioridad de refugio', 0, 100, 5, ''],
                      ] as const
                    ).map(([id, name, min, max, step, unit]) => (
                      <label key={id} className="form-label">
                        {name}{' '}
                        <output id={`value-${id}`}>
                          {layoutOptions[id]}
                          {unit}
                        </output>
                        <input
                          data-layout={id}
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          disabled={
                            onlyMove &&
                            ['count', 'scale', 'commerce', 'rest', 'cover'].includes(
                              id
                            )
                          }
                          value={layoutOptions[id]}
                          onChange={(e) => {
                            onLayoutOptionsChange({
                              ...layoutOptions,
                              [id]: Number(e.target.value),
                            });
                            onSetProposal(null);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </details>
                <label>
                  <input
                    type="checkbox"
                    id="only-move"
                    checked={onlyMove}
                    onChange={(e) => {
                      setOnlyMove(e.target.checked);
                      onSetProposal(null);
                    }}
                  />{' '}
                  Solo reorganizar el montaje existente
                </label>
                <button
                  type="button"
                  id="generate-layout"
                  className="dark wide"
                  onClick={handleGenerateLayout}
                >
                  Generar alternativa
                </button>
                <p id="layout-result" role="status">
                  {proposal
                    ? `${proposal.moves.length} piezas reubicadas · ${proposal.objects.length} nuevas. ${proposal.reason}`
                    : ''}
                </p>
                <button
                  type="button"
                  id="compare-layout"
                  className="quiet wide"
                  hidden={!proposal}
                  onClick={onToggleAlternative}
                >
                  {showAlternative ? 'Ver original' : 'Ver alternativa'}
                </button>
                <button
                  type="button"
                  id="apply-layout"
                  className="quiet wide"
                  disabled={
                    !proposal ||
                    !(proposal.moves.length + proposal.objects.length)
                  }
                  onClick={onApplyProposal}
                >
                  Aplicar propuesta
                </button>
                  <button
                    type="button"
                    id="discard-layout"
                    className="quiet wide"
                    onClick={() => onSetProposal(null)}
                  >
                    Descartar
                  </button>
                </div>
              </details>
            </section>

            <section className="panel-section">
              <div className="section-label">
                AÑADIR AL PLANO <small>En metros</small>
              </div>
              <p className="small-note" style={{marginBottom: '8px'}}>
                El personal de montaje y desmontaje se configura en Empresas y
                recursos. Las zonas de carga y maniobra son reservas de
                superficie.
              </p>
              <div className="filter-pills" role="group" aria-label="Categoría de piezas">
                {(
                  [
                    ['all', 'Todos'],
                    ['event', 'Evento'],
                    ['services', 'Servicios'],
                    ['logistics', 'Logística'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={catalogFilter === key ? 'active' : ''}
                    onClick={() => setCatalogFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="catalog">
                {Object.entries(CATALOG)
                  .filter(([, c]) => {
                    if (catalogFilter === 'all') return true;
                    if (catalogFilter === 'services') {
                      return c.role === 'emergency' || c.role === 'facility';
                    }
                    if (catalogFilter === 'logistics') {
                      return c.role === 'logistics';
                    }
                    return (
                      c.role !== 'emergency' &&
                      c.role !== 'facility' &&
                      c.role !== 'logistics'
                    );
                  })
                  .map(([k, c]) => (
                    <button
                      key={k}
                      type="button"
                      data-place={k}
                      className={
                        tool === (k === 'gate' ? 'gateLine' : 'place:' + k)
                          ? 'active'
                          : ''
                      }
                      onClick={() =>
                        setTool(k === 'gate' ? 'gateLine' : 'place:' + k)
                      }
                    >
                      <span className="symbol">{ICONS[k] || '▣'}</span>
                      <span className="catalog-meta">
                        <b>{c.name}</b>
                        <small>
                          {c.w} × {c.h} m
                        </small>
                      </span>
                    </button>
                  ))}
              </div>
              <p className="small-note">
                Elige una pieza y pulsa en el plano. Puedes moverla, girarla y
                cambiar sus medidas.
              </p>
            </section>

            <section className="panel-section">
              <div className="section-label">ESPACIO Y RECORRIDOS</div>
              <div className="tool-row">
                <button
                  type="button"
                  data-action="boundary"
                  className={tool === 'boundary' ? 'active' : ''}
                  onClick={() => setTool('boundary')}
                >
                  ▱ Perímetro
                </button>
                <button
                  type="button"
                  data-action="reserve"
                  className={tool === 'reserve' ? 'active' : ''}
                  onClick={() => setTool('reserve')}
                >
                  ▨ Zona excluida
                </button>
                <button
                  type="button"
                  data-action="flow"
                  className={tool === 'flow' ? 'active' : ''}
                  onClick={() => setTool('flow')}
                >
                  ⌁ Paso peatonal
                </button>
                <button
                  type="button"
                  data-action="road"
                  className={tool === 'road' ? 'active' : ''}
                  onClick={() => setTool('road')}
                >
                  ⇢ Propuesta vial
                </button>
              </div>
              <p className="small-note">
                Trazados libres. Los viales son anotaciones de planificación; no
                se simulan vehículos.
              </p>

              <div className="section-label" style={{marginTop: '18px'}}>
                SUBSUELO · RAYOS X{' '}
                <small>
                  {(s.subsoil?.columns.length || 0) +
                    (s.subsoil?.walls.length || 0)}{' '}
                  elem.
                </small>
              </div>
              <div className="tool-row">
                <button
                  type="button"
                  data-action="xray:boundary"
                  className={tool === 'xray:boundary' ? 'active' : ''}
                  onClick={() => setTool('xray:boundary')}
                >
                  ▱ Perímetro subsuelo
                </button>
                <button
                  type="button"
                  data-action="xray:column"
                  className={tool === 'xray:column' ? 'active' : ''}
                  onClick={() => setTool('xray:column')}
                >
                  ● Columna
                </button>
                <button
                  type="button"
                  data-action="xray:wall"
                  className={tool === 'xray:wall' ? 'active' : ''}
                  onClick={() => setTool('xray:wall')}
                >
                  ━ Muro de carga
                </button>
                <button
                  type="button"
                  data-action="xray:select"
                  className={tool === 'xray:select' ? 'active' : ''}
                  onClick={() => setTool('xray:select')}
                >
                  ↖ Editar subsuelo
                </button>
              </div>
              <p className="small-note">
                Estructura del subsuelo y mapa de calor. En perímetro: Mayús
                añade (+), Ctrl resta (−) en el primer clic.
              </p>

              <div className="section-label" style={{marginTop: '18px'}}>
                ELEMENTOS <small>{allObjects.length}</small>
              </div>
              <div className="object-list">
                {allObjects.filter(
                  (o) =>
                    phase === 'all' ||
                    membership(o).includes(phase as PhaseKey)
                ).length ? (
                  allObjects
                    .filter(
                      (o) =>
                        phase === 'all' ||
                        membership(o).includes(phase as PhaseKey)
                    )
                    .map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        data-select={o.id}
                        onClick={() => setSelectedId(o.id)}
                      >
                        <i style={{background: itemColor(o)}} />
                        <span>{o.name}</span>
                        <small>{cellAt(world([o.x, o.y], m), grid)}</small>
                      </button>
                    ))
                ) : (
                  <p>Aún no hay elementos.</p>
                )}
              </div>
            </section>

            <section className="panel-section">
              <div className="section-label">PERSONAL Y EMPRESAS</div>
              <p className="small-note" style={{marginBottom: '8px'}}>
                Personas, camiones y carretillas se indican por empresa y turno.
                La limpieza recorre los residuos hasta los contenedores.
              </p>
              <button
                type="button"
                id="stock-workforce"
                className="quiet wide"
                onClick={() => setActiveModal('org')}
              >
                Configurar responsables y recursos
              </button>
            </section>
          </>
        )}

        {panel === 'simulate' && (phase === 'pre' || phase === 'post') && (
          <section className="panel-section">
            <div className="section-label">
              JORNADA LOGÍSTICA <small>{phase === 'pre' ? 'MONTAJE' : 'DESMONTAJE'}</small>
            </div>
            {phase === 'post' && (
              <label className="form-label">
                Jornada
                <select
                  id="night-select"
                  value={
                    (s.cleanDay || 0) < (s.eventDays || 1)
                      ? s.cleanDay || 0
                      : 0
                  }
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateScene((sc) => {
                      sc.cleanDay = val;
                    });
                    onSceneChanged();
                  }}
                >
                  <option value="0">Último día · desmontaje</option>
                  {Array.from(
                    {length: Math.max(0, Math.min(30, s.eventDays || 1) - 1)},
                    (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        Limpieza tras día {i + 1}
                      </option>
                    )
                  )}
                </select>
              </label>
            )}
            <label className="form-label">
              Personal del turno{' '}
              <input
                type="number"
                min="2"
                max="6"
                id="team"
                value={Number(s.teamSize || 3)}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val >= 2 && val <= 6) {
                    updateScene((sc) => {
                      sc.teamSize = val;
                    });
                    onSceneChanged();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="dark wide"
              id="shift-play"
              onClick={onTogglePlay}
            >
              Iniciar / pausar jornada
            </button>
            <p className="small-note">
              Coloca acceso, zona de carga y reserva de maniobra. Añade
              contenedores para calcular los viajes con bolsa. El escenario se
              considera instalado previamente. Trayectos directos y tiempos de
              ensayo.
            </p>
          </section>
        )}

        {panel === 'simulate' && phase !== 'pre' && phase !== 'post' && (
          <>
            <section className="panel-section director-controls">
              <div className="section-label">
                CONTROL EN DIRECTO <small>TIEMPO REAL</small>
              </div>
              <div className="weather-pads">
                {(
                  [
                    ['sun', '☀', 'Sol'],
                    ['cloud', '☁', 'Nubes'],
                    ['rain', '☂', 'Lluvia'],
                    ['wind', '≋', 'Viento'],
                  ] as const
                ).map(([k, icon, label]) => (
                  <button
                    key={k}
                    type="button"
                    data-live-weather={k}
                    className={activeWeather === k ? 'active' : ''}
                    onClick={() => {
                      onRecordAction('weather', k);
                      updateScene((sc) => {
                        sc.base.weather = k;
                      });
                      if (engine) applyLiveWeather(engine, k);
                      logDirector('Clima → ' + icon + label);
                    }}
                  >
                    <span>{icon}</span>
                    {label}
                  </button>
                ))}
              </div>
              <div className="daylight-card">
                <div className="daylight-header">
                  <label className="form-label" htmlFor="daylight">
                    Luz de escena
                  </label>
                  <b id="light-value">{daylight}:00</b>
                </div>
                <input
                  id="daylight"
                  type="range"
                  min="6"
                  max="23"
                  step="1"
                  value={daylight}
                  style={
                    {
                      '--progress': `${((daylight - 6) / 17) * 100}%`,
                    } as React.CSSProperties
                  }
                  onChange={(e) => setDaylight(Number(e.target.value))}
                />
              </div>
              <p className="small-note">
                La luz es visual. El clima sí cambia las hipótesis de llegada y
                refugio del modelo.
              </p>

              <div className="section-label" style={{marginTop: '20px'}}>
                LEER LA MULTITUD
              </div>
              <div className="lens-pads">
                {(
                  [
                    ['people', 'Personas'],
                    ['trails', 'Flujos'],
                    ['stalls', 'Esperas'],
                  ] as Array<[LensMode, string]>
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    data-lens={k}
                    className={lens === k ? 'active' : ''}
                    onClick={() => setLens(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <details className="accordion-card" style={{marginTop: '16px'}}>
                <summary>
                  Incidencias y diario
                  {openEmergencyEvents.length > 0 && (
                    <small style={{marginLeft: 'auto', fontWeight: 700}}>
                      {openEmergencyEvents.length} activas
                    </small>
                  )}
                </summary>
                <div className="accordion-body">
                  <label className="form-label">
                    Respuesta sanitaria de ensayo
                    <select
                      id="response-mode"
                      value={s.responseMode || 'firstaid'}
                      onChange={(e) => {
                        const val = e.target.value as
                          | 'firstaid'
                          | 'stretcher'
                          | 'ambulance';
                        onRecordAction('responseMode', val);
                        updateScene((sc) => {
                          sc.responseMode = val;
                        });
                        if (engine) engine.s.responseMode = val;
                        logDirector(
                          'Respuesta seleccionada: ' +
                            e.target.selectedOptions[0].textContent
                        );
                      }}
                    >
                      <option value="firstaid">
                        Atención en el lugar · equipo a pie
                      </option>
                      <option value="stretcher">
                        Camilla hasta una ambulancia
                      </option>
                      <option value="ambulance">
                        Ambulancia hasta la incidencia
                      </option>
                    </select>
                  </label>
                  <label className="form-label">
                    Policía en el ensayo
                    <select
                      id="police-mode"
                      value={s.policeMode || 'security'}
                      onChange={(e) => {
                        const val = e.target.value as 'security' | 'patrol';
                        onRecordAction('policeMode', val);
                        updateScene((sc) => {
                          sc.policeMode = val;
                        });
                        if (engine) engine.s.policeMode = val;
                      }}
                    >
                      <option value="security">Equipo a pie</option>
                      <option value="patrol">Coche policial</option>
                    </select>
                  </label>
                  <label className="form-label">
                    Éxito del extintor en el ensayo (%)
                    <input
                      id="fire-success"
                      type="number"
                      min="0"
                      max="100"
                      value={Number(s.fireSuccess ?? 85)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val < 0 || val > 100) return;
                        onRecordAction('fireSuccess', val);
                        updateScene((sc) => {
                          sc.fireSuccess = val;
                        });
                        if (engine) engine.s.fireSuccess = val;
                      }}
                    />
                  </label>
                  <label>
                    <input
                      id="auto-incidents"
                      type="checkbox"
                      checked={!!s.autoIncidents}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        onRecordAction('autoIncidents', checked);
                        updateScene((sc) => {
                          sc.autoIncidents = checked;
                        });
                        if (engine) engine.s.autoIncidents = checked;
                      }}
                    />{' '}
                    Activar incidencias automáticas
                  </label>
                  <label hidden>
                    Minutos entre incidencias de ensayo
                    <input
                      id="auto-interval"
                      type="number"
                      min="1"
                      max="120"
                      value={Number(s.incidentEvery ?? 10)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val < 1 || val > 120) return;
                        onRecordAction('incidentEvery', val);
                        updateScene((sc) => {
                          sc.incidentEvery = val;
                        });
                        if (engine) engine.s.incidentEvery = val;
                      }}
                    />
                  </label>
                  <label>
                    <input
                      id="fire-foot"
                      type="checkbox"
                      checked={!!s.fireFootAccess}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        onRecordAction('fireFootAccess', checked);
                        updateScene((sc) => {
                          sc.fireFootAccess = checked;
                        });
                        if (engine) engine.s.fireFootAccess = checked;
                      }}
                    />{' '}
                    Permitir la aproximación de bomberos a pie cuando el camión
                    no cabe
                  </label>
                  <p className="small-note">
                    La generación automática usa intensidad por personas·hora y
                    mezcla 93 % de avisos leves con 7 % de casos moderados o
                    graves. Ajusta la intensidad en Revisar riesgos. Son
                    supuestos de demostración.
                  </p>
                  <div id="service-load" role="status">
                    {engine &&
                      serviceLoad(engine.emergency)
                        .filter((r) => r.capacity || r.waiting)
                        .map((r) => (
                          <p
                            key={r.kind}
                            className={`service-load ${r.overloaded ? 'busy' : ''}`}
                          >
                            {(
                              {
                                medical: 'Sanitarios',
                                security: 'Seguridad',
                                fire: 'Bomberos',
                                ambulance: 'Ambulancias',
                                patrol: 'Policía',
                              } as Record<string, string>
                            )[r.kind] || r.kind}
                            : {r.busy}/{r.capacity} equipos ocupados ·{' '}
                            {r.waiting} avisos pendientes
                            {r.overloaded ? ' · SIN RESERVA DISPONIBLE' : ''}
                          </p>
                        ))}
                  </div>
                  <div className="incident-pads">
                    <button
                      type="button"
                      data-incident="minor"
                      disabled={safetyStop}
                      onClick={() => handleIncidentClick('minor')}
                    >
                      Malestar leve
                    </button>
                    <button
                      type="button"
                      data-incident="orientation"
                      disabled={safetyStop}
                      onClick={() => handleIncidentClick('orientation')}
                    >
                      Orientación
                    </button>
                    <button
                      type="button"
                      data-incident="obstacle"
                      disabled={safetyStop}
                      onClick={() => handleIncidentClick('obstacle')}
                    >
                      Obstáculo en paso
                    </button>
                    <button
                      type="button"
                      data-incident="fall"
                      disabled={safetyStop}
                      onClick={() => handleIncidentClick('fall')}
                    >
                      ⊕ Caída
                    </button>
                    <button
                      type="button"
                      data-incident="fire"
                      disabled={safetyStop}
                      onClick={() => handleIncidentClick('fire')}
                    >
                      ♨ Cocina
                    </button>
                    <button
                      type="button"
                      data-incident="cut"
                      disabled={safetyStop}
                      onClick={() => handleIncidentClick('cut')}
                    >
                      ✚ Corte
                    </button>
                    <button
                      type="button"
                      data-incident="conflict"
                      disabled={safetyStop}
                      onClick={() => handleIncidentClick('conflict')}
                    >
                      ! Conflicto
                    </button>
                  </div>
                  <p className="small-note" style={{marginTop: '2px'}}>
                    Sucesos ficticios. La respuesta depende de los recursos
                    colocados y sus accesos.
                  </p>

                  <div className="sub-label" style={{marginTop: '6px'}}>
                    DIARIO DEL ENSAYO
                  </div>
                  <div id="director-log" aria-live="polite">
                    {openEmergencyEvents.map((row) => (
                      <article key={row.id} className="director-log-row">
                        <b>{row.name}</b>
                        <span>{statuses[row.status] || row.status}</span>
                        <small>
                          {(row.reporters
                            ?.map((p) => `${p.label} (${p.role})`)
                            .join(', ') || '') +
                            ` · Demora de aviso ${Math.round(row.reportDelay || 0)} s · ` +
                            (row.phase === 'transfer' ? 'Traslado · ' : '') +
                            (row.note || '') +
                            (row.reinforcements
                              ? ' · ' + row.reinforcements.status
                              : '') +
                            ` · ${row.yieldedIds?.length || 0} requeridos a ceder / ${
                              row.yieldBlockedIds?.length || 0
                            } sin espacio encontrado / ${Math.round(
                              row.peopleDelay || 0
                            )} s retenido`}
                        </small>
                      </article>
                    ))}
                    {recentLogs.map((row, idx) => (
                      <article key={`log-${idx}`} className="director-log-row">
                        {String(Math.floor(row.time / 60)).padStart(2, '0')} min
                        · {row.text}
                      </article>
                    ))}
                    {closedEmergencyEvents.length > 0 && (
                      <small>
                        {closedEmergencyEvents.length} incidencias resueltas ·{' '}
                        {closedEmergencyEvents[closedEmergencyEvents.length - 1]
                          .fireOutcome ||
                          closedEmergencyEvents[
                            closedEmergencyEvents.length - 1
                          ].name}
                      </small>
                    )}
                    {!openEmergencyEvents.length &&
                      !recentLogs.length &&
                      !closedEmergencyEvents.length && (
                        <p className="small-note">
                          Pon en marcha el ensayo y cambia lo que ocurre.
                        </p>
                      )}
                  </div>

                  <section style={{marginTop: '10px'}}>
                    <p className="small-note">
                      El ensayo exige recursos colocados para cada intervención.
                      Si no salen, el diario indica si faltan equipos, acceso o
                      recorrido.
                    </p>
                    <button
                      type="button"
                      id="response-review"
                      className="quiet wide"
                      onClick={() => {
                        setPanel('design');
                        setActiveModal('inventory');
                      }}
                    >
                      Revisar equipos de emergencia
                    </button>
                    <button
                      type="button"
                      id="prepare-response"
                      className="quiet wide"
                      style={{marginTop: '5px'}}
                      onClick={() => {
                        try {
                          const next = addResponseExample(s);
                          replaceScene(next, true);
                          onSceneChanged();
                          showToast(
                            'Dotación de ejemplo preparada. Se ha reiniciado el ensayo. Las ubicaciones requieren revisión.'
                          );
                        } catch (err) {
                          showToast((err as Error).message);
                        }
                      }}
                    >
                      Preparar dotación de ejemplo y reiniciar
                    </button>
                    <button
                      type="button"
                      id="evacuate-all"
                      className="quiet wide"
                      style={{marginTop: '5px'}}
                      disabled={safetyStop}
                      onClick={() => {
                        if (safetyStop) return;
                        if (!engine) onTogglePlay();
                        if (engine) {
                          onRecordAction('evacuate', true);
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          (engine.emergency as any).evacuation?.order(
                            null,
                            true
                          );
                          showToast(
                            'Orden de desalojo simulada. Comprueba salidas y visitantes pendientes.'
                          );
                        }
                      }}
                    >
                      Ensayar desalojo del recinto
                    </button>
                    <p id="response-summary" className="small-note">
                      {engine &&
                        (() => {
                          const resources = engine.emergency.resources();
                          const missing = ['medical', 'fire', 'security'].filter(
                            (k) =>
                              !resources.some(
                                (r) => r.kind === k && (r.staff || 0) > 0
                              )
                          );
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const em = engine.emergency as any;
                          const ev = em.evacuation?.stats || {
                            warned: 0,
                            departed: 0,
                            blocked: 0,
                          };
                          const stats = em.social?.stats || {
                            curious: 0,
                            avoid: 0,
                            dispersed: 0,
                          };
                          const reinfCount = engine.emergency.events.filter(
                            (r) => r.reinforcements
                          ).length;
                          return (
                            `${stats.curious} visitantes curiosos · ${stats.avoid} se alejan · ${stats.dispersed} avisos de dispersión · ${ev.warned} avisados de desalojo · ${ev.departed} han salido · ${ev.blocked} sin ruta. ${reinfCount} solicitudes de refuerzo simuladas.` +
                            (missing.length
                              ? ' Faltan equipos previstos: ' +
                                missing
                                  .map(
                                    (k) =>
                                      (
                                        {
                                          medical: 'equipo sanitario',
                                          fire: 'bomberos',
                                          security: 'seguridad a pie',
                                        } as Record<string, string>
                                      )[k]
                                  )
                                  .join(', ') +
                                '.'
                              : '')
                          );
                        })()}
                    </p>
                  </section>
                </div>
              </details>
            </section>

            <section className="panel-section">
              <span className="status-chip">ENSAYO · NO ES UN AFORO</span>
              <label className="form-label">
                Llegadas por hora
                <input
                  id="arrivals"
                  type="number"
                  min="0"
                  max="3000"
                  step="10"
                  value={s.base.arrivals}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v < 0 || v > 3000) {
                      showToast('Introduce un valor válido');
                      return;
                    }
                    updateScene((sc) => {
                      sc.base.arrivals = v;
                    }, true);
                    if (engine) {
                      onRecordAction('arrivals', v);
                      applyLiveArrivals(engine, v);
                    } else {
                      onSceneChanged();
                    }
                  }}
                />
              </label>
              <label className="form-label">
                Duración de la jornada
                <select
                  id="hours"
                  value={s.base.hours}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    updateScene((sc) => {
                      sc.base.hours = v;
                    }, true);
                    onSceneChanged();
                  }}
                >
                  {[1, 2, 4, 6, 8, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} horas
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Condición climática
                <select
                  id="weather"
                  value={s.base.weather}
                  onChange={(e) => {
                    const v = e.target.value as
                      | 'cloud'
                      | 'sun'
                      | 'rain'
                      | 'wind';
                    updateScene((sc) => {
                      sc.base.weather = v;
                    }, true);
                    if (engine) {
                      onRecordAction('weather', v);
                      applyLiveWeather(engine, v);
                    } else {
                      onSceneChanged();
                    }
                  }}
                >
                  <option value="cloud">Sin lluvia</option>
                  <option value="sun">Sol</option>
                  <option value="rain">Lluvia</option>
                  <option value="wind">Viento</option>
                </select>
              </label>
              <button
                type="button"
                id="panel-play"
                className="dark wide"
                onClick={onTogglePlay}
              >
                {running ? (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <rect x="6" y="4" width="4.5" height="16" rx="2" />
                      <rect x="13.5" y="4" width="4.5" height="16" rx="2" />
                    </svg>
                    <span>Pausar ensayo</span>
                  </>
                ) : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polygon points="7 4 19 12 7 20 7 4" />
                    </svg>
                    <span>{engine ? 'Continuar ensayo' : 'Iniciar ensayo'}</span>
                  </>
                )}
              </button>
              <p className="small-note">
                Modificar el plano o estos parámetros reinicia los resultados.
                Cada punto representa una persona.
              </p>
            </section>

            <section className="panel-section">
              <div className="section-label">LECTURA DEL ENSAYO</div>
              <div id="sim-metrics">
                {simMetricsRows.map(([label, val]) => (
                  <div key={label} className="metric">
                    <span>{label}</span>
                    <b>{val}</b>
                  </div>
                ))}
              </div>
              <p className="small-note">
                Los valores son salidas del modelo heredado, no conteos reales.
                No predicen evacuación, presión de multitudes ni tráfico.
              </p>
            </section>
          </>
        )}

        {panel === 'review' && (
          <>
            <section className="panel-section">
              <button
                type="button"
                className="dark wide"
                onClick={() => setActiveModal('comparison')}
              >
                Evaluar y comparar mapas
              </button>
            </section>
            <section className="panel-section">
              <div className="section-label">
                OBSERVACIONES DE VISITANTES
              </div>
              <div id="auto-review">
                {!engine ? (
                  <p className="empty">
                    Inicia un ensayo. Las observaciones aparecerán aquí
                    automáticamente.
                  </p>
                ) : (
                  <>
                    <PostSimDiagnosticsView
                      engine={engine}
                      compact
                      onSceneChanged={onSceneChanged}
                    />
                    <div className="review-accordions">
                    <details className="accordion-card" open>
                      <summary>
                        Prioridades del ensayo
                        <small style={{marginLeft: 'auto', fontWeight: 700}}>
                          {expActions.length}
                        </small>
                      </summary>
                      <div className="accordion-body review-list">
                        {expActions.map((a, idx) => (
                          <article key={idx} className="note-card">
                            <b>
                              {TOPICS[a.type]} · {a.people} visitantes
                            </b>
                            <p>{a.action}</p>
                            <small>{a.limitation}</small>
                            <button
                              type="button"
                              className="quiet"
                              data-defer={idx}
                              style={{marginTop: '6px'}}
                              onClick={() => {
                                updateScene((sc) => {
                                  deferIssue(sc, a);
                                  if (engine) {
                                    engine.s.reviewMemory = structuredClone(
                                      sc.reviewMemory
                                    );
                                  }
                                });
                              }}
                            >
                              Dejar pendiente y recordar
                            </button>
                          </article>
                        ))}
                      </div>
                    </details>
                    <details className="accordion-card">
                      <summary>
                        Activas
                        <small style={{marginLeft: 'auto', fontWeight: 700}}>
                          {activeExp.length}
                        </small>
                      </summary>
                      <div className="accordion-body review-list">
                        {activeExp.length ? (
                          activeExp.slice(0, 25).map((r) => (
                            <article key={r.id} className="note-card">
                              <b>
                                {r.visitId} · {TOPICS[r.type]}
                              </b>
                              <p>{r.detail}</p>
                              <small>
                                {cellAt(r.point, grid)} ·{' '}
                                {Math.floor(r.first / 60)} min ·{' '}
                                {r.closeReason || 'Activa'}
                              </small>
                            </article>
                          ))
                        ) : (
                          <p className="small-note">
                            Todavía no se detectan condiciones activas.
                          </p>
                        )}
                      </div>
                    </details>
                    <details className="accordion-card">
                      <summary>Historial de observaciones</summary>
                      <div className="accordion-body review-list">
                        {prevExp.slice(0, 25).map((r) => (
                          <article key={r.id} className="note-card">
                            <b>
                              {r.visitId} · {TOPICS[r.type]}
                            </b>
                            <p>{r.detail}</p>
                            <small>
                              {cellAt(r.point, grid)} ·{' '}
                              {Math.floor(r.first / 60)} min ·{' '}
                              {r.closeReason || 'Activa'}
                            </small>
                          </article>
                        ))}
                        {complaintsList.slice(0, 15).map((r) => (
                          <article key={r.id} className="note-card">
                            <b>
                              {r.visitId} · {r.title}
                            </b>
                            <p>{r.reason}</p>
                          </article>
                        ))}
                      </div>
                    </details>
                    <p className="small-note" style={{marginTop: '2px'}}>
                      Últimas 25 por estado. Descarga el informe completo antes
                      de reiniciar.
                    </p>
                    {Object.values(s.reviewMemory || {}).map((item) => (
                      <p key={item.key} className="small-note">
                        Pendiente · {item.count || 0} aplazamientos /{' '}
                        {item.observedRuns || 0} ensayos: {item.description}
                      </p>
                    ))}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                className="quiet wide"
                id="save-feedback"
                style={{marginTop: '10px'}}
                onClick={() => {
                  if (!engine) {
                    showToast('Inicia un ensayo primero');
                    return;
                  }
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const em = engine.emergency as any;
                  downloadFile(
                    'Informe_de_visitantes.json',
                    JSON.stringify(
                      {
                        escenario: s.title,
                        segundos: engine.time,
                        observaciones: engine.experience.list(),
                        episodios: engine.complaints(),
                        propuestas: analyze(engine),
                        evacuacion: em.evacuation?.stats,
                        reaccionPublico: em.social?.stats,
                        emergencias: engine.emergency.events.map(
                          ({
                            id,
                            name,
                            status,
                            created,
                            closed,
                            fireOutcome,
                            note,
                            reinforcements,
                            reporters,
                          }) => ({
                            id,
                            name,
                            status,
                            created,
                            closed,
                            fireOutcome,
                            note,
                            reinforcements,
                            reporters,
                          })
                        ),
                      },
                      null,
                      2
                    )
                  );
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Descargar informe del ensayo</span>
              </button>
            </section>

            <section className="panel-section">
              <div className="section-label">
                NOTAS DEL EQUIPO <small>{s.annotations.length}</small>
              </div>
              <button
                type="button"
                id="add-note"
                className="dark wide"
                onClick={() => setTool('note')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span>Añadir observación</span>
              </button>
              <p className="small-note">
                Pulsa sobre el plano. La nota conserva su posición y la celda de
                referencia utilizada.
              </p>
              <div id="notes-list">
                {s.annotations.length ? (
                  s.annotations.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="note-card"
                      data-note={o.id}
                      onClick={() => setSelectedId(o.id)}
                    >
                      <b>
                        {o.cell} · CUADRÍCULA {o.grid} m
                      </b>
                      <p>{o.text || 'Observación sin texto'}</p>
                    </button>
                  ))
                ) : (
                  <p className="empty" style={{marginTop: '12px'}}>
                    «En la celda R14 el paso debería quedar libre». Guarda aquí
                    cada revisión del equipo.
                  </p>
                )}
              </div>
            </section>

            <section className="panel-section">
              <div className="section-label">
                MEDICIONES <small>{s.measurements.length}</small>
              </div>
              <button
                type="button"
                id="add-measure"
                className="quiet wide"
                onClick={() => setTool('measure')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 8l4 4-4 4" />
                  <path d="M6 8l-4 4 4 4" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                </svg>
                <span>Medir sobre el plano</span>
              </button>
              {s.measurements.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="note-card"
                  data-measure={o.id}
                  onClick={() => setSelectedId(o.id)}
                >
                  <b>
                    {num(polylineLength(o.points.map((p) => world(p, m))))} m
                  </b>
                  <p>{o.name}</p>
                </button>
              ))}
              <p className="small-note">
                Distancias planimétricas, sin pendiente. Precisión limitada por
                la cartografía de origen.
              </p>
            </section>

            <section className="panel-section">
              <button
                type="button"
                id="export-notes"
                className="quiet wide"
                onClick={() => exportNotesCSV(project, MAPS_DATA)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Exportar observaciones CSV</span>
              </button>
              <p className="small-note">
                Compartición por archivo. Las notas no se sincronizan con otros
                usuarios.
              </p>
            </section>
          </>
        )}
      </div>

      <div className="sidebar-foot">
        <i />
        Proyecto de estudio independiente.
        <br />
        Sin conexión con servicios municipales.
      </div>
    </aside>
  );
};
