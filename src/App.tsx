import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {cellAt, world} from './engine/cartography/geometry';
import {PlainLanguageEnhancer} from './components/common/PlainLanguageEnhancer';
import {Toast} from './components/common/Toast';
import {TutorialOverlay} from './components/common/TutorialOverlay';
import {Header} from './components/header/Header';
import {NavigationRail} from './components/layout/NavigationRail';
import {PhaseStrip} from './components/layout/PhaseStrip';
import {type ProposalState, Sidebar} from './components/layout/Sidebar';
import {SourceBar} from './components/layout/SourceBar';
import {WorkspaceBar} from './components/layout/WorkspaceBar';
import {MapShell, type MapShellHandle} from './components/map/MapShell';
import {GameMenu} from './components/menu/GameMenu';
import {
  ClosingDialog,
  type ClosingDialogData,
} from './components/modals/ClosingDialog';
import {ComparisonDialog} from './components/modals/ComparisonDialog';
import {ContactsDialog} from './components/modals/ContactsDialog';
import {DemandDialog} from './components/modals/DemandDialog';
import {DeveloperReferenceDialog} from './components/modals/DeveloperReferenceDialog';
import {InfoDialog} from './components/modals/InfoDialog';
import {InventoryDialog} from './components/modals/InventoryDialog';
import {LaboratoryDialog} from './components/modals/LaboratoryDialog';
import {OrganizationsDialog} from './components/modals/OrganizationsDialog';
import {ParametersDialog} from './components/modals/ParametersDialog';
import {ProgrammeDialog} from './components/modals/ProgrammeDialog';
import {RiskDialog} from './components/modals/RiskDialog';
import {SmallExampleDialog} from './components/modals/SmallExampleDialog';
import {SimulationStrip} from './components/simulation/SimulationStrip';
import {applyPalette, normalizePaletteId} from './data/palettes';
import {EventEngine} from './engine/crowd/event-engine';
import {
  applyLiveArrivals,
  applyLiveWeather,
} from './engine/director/director-logic';
import {incidentDashboard} from './engine/emergency/incident-dashboard';
import {
  ResponseSimulation,
  responseSVG,
} from './engine/emergency/response-model';
import {
  assessRisk,
  liveFailures,
  type RiskAssessmentReport,
  type RiskIssue,
  safetyFingerprint,
} from './engine/emergency/risk';
import {
  analyze,
  ExperienceMonitor,
  satisfaction,
} from './engine/experience/experience-monitor';
import {observeIssues} from './engine/experience/review-memory';
import {phaseScene} from './engine/logistics/phases';
import {shift, shiftAt, shiftSVG} from './engine/logistics/shift';
import type {LayoutOptions} from './engine/planning/layout';
import {useProjectStore} from './store/useProjectStore';
import type {PhaseKey, Scene} from './types';

const timeLabel = (t: number): string =>
  [Math.floor(t / 3600), Math.floor(t / 60) % 60, Math.floor(t) % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');

function createEngine(base: Scene): EventEngine {
  const e = new EventEngine(base);
  e.reviewRunId = crypto.randomUUID();
  e.emergency = new ResponseSimulation(e);
  e.experience = new ExperienceMonitor(e);
  return e;
}

/**
 * Root application component for Ojo de Buey (OxEye).
 */
export const App: React.FC = () => {
  const mapRef = useRef<MapShellHandle | null>(null);
  const engineRef = useRef<EventEngine | null>(null);
  const replayBaseRef = useRef<Scene | null>(null);
  const replayLogRef = useRef<
    Array<{time: number; kind: string; value: unknown}>
  >([]);
  const replayCursorRef = useRef(0);
  const seekIdRef = useRef(0);
  const draggingTimeRef = useRef(false);
  const simTargetRef = useRef(0);
  const shiftPlanRef = useRef<ReturnType<typeof shift> | null>(null);
  const shiftTimeRef = useRef(0);
  const lastHeatRef = useRef(-1);
  const lastReviewRef = useRef(-1);

  const runningRef = useRef(false);
  const shiftRunRef = useRef(false);
  const speedRef = useRef(60);
  const safetyStopRef = useRef(false);
  const preflightStampRef = useRef('');

  const [running, setRunning] = useState(false);
  const [shiftRun, setShiftRun] = useState(false);
  const [safetyStop, setSafetyStop] = useState(false);
  const [customRiskReport, setCustomRiskReport] =
    useState<RiskAssessmentReport | null>(null);
  const [engineInstance, setEngineInstance] = useState<EventEngine | null>(
    null
  );
  const [reviewTick, setReviewTick] = useState(0);
  const [closingData, setClosingData] = useState<ClosingDialogData | null>(
    null
  );

  const preferences = useProjectStore((s) => s.preferences);
  const [speed, setSpeed] = useState(preferences.speed || 60);

  const [layoutOptions, setLayoutOptions] = useState<LayoutOptions>({
    count: 8,
    scale: 1,
    space: 2,
    commerce: 60,
    rest: 25,
    cover: 15,
    seed: 2026,
  });
  const [proposal, setProposal] = useState<ProposalState | null>(null);
  const [showAlternative, setShowAlternative] = useState(true);

  const phase = useProjectStore((s) => s.phase);
  const lens = useProjectStore((s) => s.lens);
  const diagnosticSimMode = useProjectStore((s) => s.diagnosticSimMode);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setPanel = useProjectStore((s) => s.setPanel);
  const setTool = useProjectStore((s) => s.setTool);
  const setPhase = useProjectStore((s) => s.setPhase);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setDiagnosticSimMode = useProjectStore((s) => s.setDiagnosticSimMode);
  const updateScene = useProjectStore((s) => s.updateScene);
  const undo = useProjectStore((s) => s.undo);
  const showToast = useProjectStore((s) => s.showToast);

  useEffect(() => {
    setSpeed(preferences.speed || 60);
    speedRef.current = preferences.speed || 60;
    document.body.classList.toggle('reduce-motion', !!preferences.reduceMotion);
    applyPalette(normalizePaletteId(preferences.palette));
  }, [preferences.speed, preferences.reduceMotion, preferences.palette]);

  const dismissedIncidentsRef = useRef<Set<string>>(new Set());

  const syncDirectorOverlays = useCallback(() => {
    const engine = engineRef.current;
    const responseEl = document.getElementById('response-layer');
    const heatEl = document.getElementById('heat-layer');
    const cornerEl = document.getElementById('incident-corner');
    if (responseEl) {
      responseEl.innerHTML = engine
        ? responseSVG(engine) + (engine.stewards?.svg() || '')
        : '';
    }
    if (cornerEl) {
      const html = engine
        ? incidentDashboard(engine, dismissedIncidentsRef.current)
        : '';
      cornerEl.innerHTML = html;
      cornerEl.hidden = !html;
    }
    const currentLens = useProjectStore.getState().lens;
    if (!heatEl) return;
    if (!engine || currentLens === 'people') {
      heatEl.innerHTML = '';
      lastHeatRef.current = -1;
      return;
    }
    const tick = Math.floor(engine.time / 10);
    if (tick === lastHeatRef.current) return;
    lastHeatRef.current = tick;
    const values = currentLens === 'trails' ? engine.trails : engine.stalls;
    const bins = new Map<string, number>();
    for (let i = 0; i < values.length; i++) {
      if (values[i] <= 0) continue;
      const [x, y] = engine.g.point(i);
      const k = Math.floor(x / 3) + ',' + Math.floor(y / 3);
      bins.set(k, (bins.get(k) || 0) + values[i]);
    }
      const rows = [...bins].sort((a, b) => b[1] - a[1]).slice(0, 3500);
      const max = Math.max(1, ...rows.map((r) => r[1]));
      // Criterio semáforo para análisis de congestión de flujos: verde (fluido) → ámbar (medio) → rojo (congestión)
      heatEl.innerHTML = rows
        .map(([k, v]) => {
          const [x, y] = k.split(',').map(Number);
          const t = Math.min(1, Math.log1p(v) / Math.log1p(max));
          const color =
            t > 0.72 ? '#dc2626' : t > 0.42 ? '#eab308' : '#16a34a';
          return `<rect x="${x * 3}" y="${y * 3}" width="3" height="3" rx=".7" fill="${color}" opacity="${0.22 + t * 0.52}"/>`;
        })
        .join('');
  }, []);

  useEffect(() => {
    lastHeatRef.current = -1;
    syncDirectorOverlays();
  }, [lens, syncDirectorOverlays]);

  const paintPeople = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const diningEl = document.getElementById('dining-layer');
    if (diningEl) diningEl.innerHTML = engine.dining.svg();

    const peopleEl = document.getElementById('people-layer');
    if (peopleEl) {
      const peopleSvg = engine.agents
        .map(
          (a) =>
            `<circle cx="${a.x}" cy="${a.y}" r="${Math.max(
              a.r,
              0.45
            )}" fill="${satisfaction(a).color}" stroke="#fff" stroke-width=".1"/>`
        )
        .join('');
      const vehSvg = (engine.vehicleManager?.vehicles || [])
        .filter((v) => v.state !== 'departed')
        .map((v) => {
          const fill =
            v.kind === 'emergency'
              ? '#dc2626'
              : v.kind === 'logistics'
                ? '#d97706'
                : '#3b82f6';
          const stroke = v.state === 'blocked' ? '#ef4444' : '#ffffff';
          const deg = (v.angle * 180) / Math.PI;
          return `<g transform="translate(${v.x} ${v.y}) rotate(${deg})"><title>${v.name} · ${v.state}${v.diagnostic?.reason ? ' · ' + v.diagnostic.reason : ''}</title><rect x="${-v.length / 2}" y="${-v.width / 2}" width="${v.length}" height="${v.width}" rx=".45" fill="${fill}" stroke="${stroke}" stroke-width="${v.state === 'blocked' ? '.35' : '.18'}"/><rect x="${v.length / 2 - 1.1}" y="${-v.width / 2 + 0.25}" width=".8" height="${v.width - 0.5}" rx=".2" fill="#ffffff" fill-opacity=".65"/></g>`;
        })
        .join('');
      peopleEl.innerHTML = peopleSvg + vehSvg;
    }
    const min = Math.floor(engine.time / 60);
    const clockEl = document.getElementById('clock');
    if (clockEl) {
      clockEl.textContent =
        String(Math.floor(min / 60)).padStart(2, '0') +
        ':' +
        String(min % 60).padStart(2, '0');
    }
    const presentEl = document.getElementById('present');
    if (presentEl) presentEl.textContent = String(engine.agents.length);
    const waitingEl = document.getElementById('waiting');
    if (waitingEl) {
      waitingEl.textContent = String(
        engine.agents.filter((a) => a.state === 'queue').length
      );
    }

    syncDirectorOverlays();

    const step5 = Math.floor(engine.time / 5);
    if (lastReviewRef.current !== step5) {
      lastReviewRef.current = step5;
      setReviewTick((t) => t + 1);
    }
  }, [syncDirectorOverlays]);

  const resetSim = useCallback(() => {
    safetyStopRef.current = false;
    setSafetyStop(false);
    setDiagnosticSimMode(false);
    preflightStampRef.current = '';
    setCustomRiskReport(null);
    if (useProjectStore.getState().currentScene().safetyLock) {
      updateScene((sc) => {
        delete sc.safetyLock;
      });
    }
    seekIdRef.current++;
    replayLogRef.current = [];
    replayCursorRef.current = 0;
    replayBaseRef.current = null;
    shiftRunRef.current = false;
    setShiftRun(false);
    shiftPlanRef.current = null;
    shiftTimeRef.current = 0;
    runningRef.current = false;
    setRunning(false);
    simTargetRef.current = 0;
    engineRef.current = null;
    setEngineInstance(null);
    lastReviewRef.current = -1;
    lastHeatRef.current = -1;
    dismissedIncidentsRef.current.clear();

    for (const id of [
      'shift-layer',
      'people-layer',
      'dining-layer',
      'heat-layer',
      'response-layer',
      'incident-corner',
    ]) {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '';
        if (id === 'incident-corner') el.hidden = true;
      }
    }
    const clockEl = document.getElementById('clock');
    if (clockEl) clockEl.textContent = '00:00';
    const presentEl = document.getElementById('present');
    if (presentEl) presentEl.textContent = '—';
    const waitingEl = document.getElementById('waiting');
    if (waitingEl) waitingEl.textContent = '—';
    const bar = document.getElementById('timeline') as HTMLInputElement | null;
    if (bar) {
      bar.value = '0';
      bar.style.setProperty('--progress', '0%');
    }
    const seekEl = document.getElementById('seek-time');
    if (seekEl) seekEl.textContent = '00:00:00';
    setReviewTick((t) => t + 1);
  }, [updateScene, setDiagnosticSimMode]);

  const triggerDayClose = useCallback(() => {
    const currentPhase = useProjectStore.getState().phase;
    const plan = shiftPlanRef.current;
    const eng = engineRef.current;
    const isLog = currentPhase === 'pre' || currentPhase === 'post';
    const t =
      isLog && plan
        ? Math.min(shiftTimeRef.current, plan.total, plan.limit)
        : eng?.time || 0;
    const finished = plan?.installed.filter((j) => j.at <= t) || [];
    const pending = plan ? plan.required - finished.length : 0;
    const done =
      plan && pending === 0 && plan.total <= plan.limit && !plan.alerts.length;

    const emergencyReport =
      eng?.emergency?.events.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        reason: r.note,
        reinforcements: r.reinforcements,
        reporters: r.reporters?.length || 0,
      })) || [];

    if (!plan && eng) {
      const recommendations = analyze(eng);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const em = eng.emergency as any;
      const runSeed =
        eng?.s.seed ??
        useProjectStore.getState().activeRunSeed ??
        useProjectStore.getState().currentScene().seed;
      updateScene((sc) => {
        observeIssues(sc, recommendations, eng.reviewRunId || 'run');
        sc.lastSessionReview = {
          date: new Date().toISOString(),
          seed: runSeed,
          seconds: t,
          emergencies: emergencyReport,
          evacuation: em.evacuation?.stats,
          crowd: em.social?.stats,
          recommendations,
        };
      });
    }

    setClosingData({
      closedPhase: currentPhase,
      shiftPlan: plan,
      shiftTime: shiftTimeRef.current,
      engineTime: eng?.time || 0,
      arrivals: eng?.stats.arrivals || 0,
      served: eng?.stats.served || 0,
      abandoned: eng?.stats.abandoned || 0,
      seed: eng?.s.seed ?? useProjectStore.getState().activeRunSeed ?? undefined,
      diagnosticMode: useProjectStore.getState().diagnosticSimMode,
      engine: eng,
      emergencyReport,
    });
    setActiveModal('closing');

    if (done && currentPhase === 'pre') {
      setPhase('event');
      resetSim();
    }
  }, [setActiveModal, setPhase, resetSim, updateScene]);

  const cancelUnsafe = useCallback(
    (issues: RiskIssue[]) => {
      if (safetyStopRef.current) return;
      safetyStopRef.current = true;
      setSafetyStop(true);
      runningRef.current = false;
      setRunning(false);
      shiftRunRef.current = false;
      setShiftRun(false);
      simTargetRef.current = engineRef.current?.time || 0;

      const s = useProjectStore.getState().currentScene();
      const failureSeed =
        engineRef.current?.s.seed ??
        useProjectStore.getState().activeRunSeed ??
        s.seed;
      const record = {
        at: new Date().toISOString(),
        seed: failureSeed,
        time: engineRef.current?.time || 0,
        issues,
        status: 'cancelled',
      };
      updateScene((sc) => {
        sc.safetyHistory = [...(sc.safetyHistory || []), record].slice(-20);
        sc.safetyLock = {fingerprint: safetyFingerprint(sc), at: record.at};
      });
      const report = assessRisk(s);
      report.issues = [...issues, ...report.issues];
      report.critical = [...issues, ...report.critical];
      setCustomRiskReport(report);
      setActiveModal('risk');
    },
    [updateScene, setActiveModal]
  );

  const checkLiveSafety = useCallback((): boolean => {
    const eng = engineRef.current;
    if (!eng) return true;
    // En modo diagnóstico (escenario no validado — uso exclusivamente analítico) no interrumpimos la ejecución
    if (useProjectStore.getState().diagnosticSimMode) return true;
    const issues: RiskIssue[] = [
      ...assessRisk(eng.s).critical,
      ...liveFailures(eng),
    ];
    if (issues.length) {
      cancelUnsafe(issues);
      return false;
    }
    return true;
  }, [cancelUnsafe]);

  const recordAction = useCallback((kind: string, value: unknown) => {
    const eng = engineRef.current;
    if (!eng) return;
    replayLogRef.current.splice(replayCursorRef.current);
    replayLogRef.current.push({time: eng.time, kind, value});
    replayCursorRef.current = replayLogRef.current.length;
  }, []);

  const replayActions = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    while (
      replayCursorRef.current < replayLogRef.current.length &&
      replayLogRef.current[replayCursorRef.current].time <= eng.time
    ) {
      const {kind, value} = replayLogRef.current[replayCursorRef.current++];
      if (kind === 'evacuate') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (eng.emergency as any).evacuation?.order(null, true);
      } else if (kind === 'inject') {
        const injVal = value as string | {type: string; sourceId?: string | null};
        eng.emergency.inject(
          typeof injVal === 'string' ? injVal : injVal.type,
          typeof injVal === 'string' ? null : injVal.sourceId || null
        );
      } else if (kind === 'weather') {
        applyLiveWeather(eng, value as 'sun' | 'cloud' | 'rain' | 'wind');
      } else if (kind === 'arrivals') {
        applyLiveArrivals(eng, Number(value));
      } else {
        (eng.s as unknown as Record<string, unknown>)[kind] = value;
      }
    }
  }, []);

  const togglePlay = useCallback(
    (forceDiagnostic = false) => {
    const currentPhase = useProjectStore.getState().phase;
    const s = useProjectStore.getState().currentScene();
    const m = useProjectStore.getState().currentMap();
    const isDiagnostic =
      forceDiagnostic || useProjectStore.getState().diagnosticSimMode;

    if (!isDiagnostic) {
      if (s.safetyLock?.fingerprint === safetyFingerprint(s)) {
        setActiveModal('risk');
        return;
      }
      if (safetyStopRef.current) {
        setActiveModal('risk');
        return;
      }
      if (!runningRef.current && currentPhase !== 'pre' && currentPhase !== 'post') {
        const stamp = JSON.stringify(s);
        if (stamp !== preflightStampRef.current) {
          try {
            const trial = createEngine(phaseScene(s, 'event'));
            const r = assessRisk(s, trial, {routes: true});
            if (r.critical.length) {
              setCustomRiskReport(r);
              setActiveModal('risk');
              return;
            }
            if (s.safetyLock) {
              updateScene((sc) => {
                delete sc.safetyLock;
              });
            }
            preflightStampRef.current = JSON.stringify(
              useProjectStore.getState().currentScene()
            );
          } catch (err) {
            showToast('Revisión no completada: ' + (err as Error).message);
            return;
          }
        }
      }
    }

    seekIdRef.current++;

    if (!runningRef.current && (currentPhase === 'pre' || currentPhase === 'post')) {
      if (!shiftPlanRef.current) {
        let effectiveScene = s;
        let plan = shift(effectiveScene, m, currentPhase);
        if (
          !plan.error &&
          plan.required === 0 &&
          (s.progressByPhase?.[currentPhase]?.length || 0) > 0
        ) {
          // Todas las tareas figuraban ya como completadas de una jornada previa: reiniciar progreso para poder ensayar el turno completo
          updateScene((sc) => {
            if (sc.progressByPhase) delete sc.progressByPhase[currentPhase];
            if (sc.shiftDays) delete sc.shiftDays[currentPhase];
          });
          effectiveScene = useProjectStore.getState().currentScene();
          plan = shift(effectiveScene, m, currentPhase);
          showToast(
            'Progreso de montaje previo reiniciado para simular el turno completo.'
          );
        }
        if (plan.error) {
          showToast(
            plan.error,
            'error',
            plan.diagnostic?.targetId || plan.diagnostic?.targetPoint
              ? {
                  label: 'Localizar en el mapa',
                  targetId: plan.diagnostic.targetId,
                  targetPoint: plan.diagnostic.targetPoint,
                  panel: 'design',
                }
              : null
          );
          shiftPlanRef.current = null;
          return;
        }
        shiftPlanRef.current = plan;
      }
      const plan = shiftPlanRef.current;
      if (shiftTimeRef.current >= Math.min(plan.total, plan.limit)) {
        shiftTimeRef.current = 0;
      }
      const nextRun = !shiftRunRef.current;
      shiftRunRef.current = nextRun;
      setShiftRun(nextRun);
      return;
    }

    if (!engineRef.current) {
      if (
        !s.entrances.some((g) =>
          ['both', 'in', 'free'].includes(g.phases?.event || g.role || 'both')
        )
      ) {
        const closedOrOutGate = s.entrances[0];
        if (closedOrOutGate) {
          const gp = world([closedOrOutGate.x, closedOrOutGate.y], m);
          showToast(
            `Sin acceso de entrada habilitado: «${closedOrOutGate.name}» (CELDA ${cellAt(gp, 10)}) está configurado como «Solo salida» o cerrado. Cambia su Uso del acceso a «Entrada y salida» o dibuja otro acceso.`,
            'error',
            {
              label: 'Localizar en el mapa',
              targetId: closedOrOutGate.id,
              targetPoint: gp,
              panel: 'design',
            }
          );
        } else {
          showToast(
            'Falta acceso de entrada en el perímetro del recinto. Usa «⇄ Acceso» sobre el borde del perímetro antes de simular.',
            'error'
          );
          setPanel('design');
          setTool('gateLine');
        }
        return;
      }
      try {
        const st = useProjectStore.getState();
        const runSeed =
          st.simSeedMode === 'fixed'
            ? st.simSeedValue || s.seed || 2026
            : st.randomizeSimSeed();
        st.setActiveRunSeed(runSeed);
        updateScene((sc) => {
          sc.seed = runSeed;
          sc.seedMode = st.simSeedMode;
        });
        const base = structuredClone(phaseScene(s, 'event'));
        base.seed = runSeed;
        const eng = createEngine(base);
        if (!eng.entries.length || eng.g.area < 1) {
          const firstGate = s.entrances.find((g) =>
            ['both', 'in', 'free'].includes(g.phases?.event || g.role || 'both')
          ) || s.entrances[0];
          const gp = firstGate ? world([firstGate.x, firstGate.y], m) : undefined;
          showToast(
            firstGate && gp
              ? `El acceso «${firstGate.name}» (CELDA ${cellAt(gp, 10)}) está desconectado de la zona transitable por vallas, reservas o perímetro cerrado. Despeja el paso junto al acceso.`
              : 'Ningún acceso conecta con una superficie transitable (≥ 1 m²). Revisa el perímetro y las zonas excluidas.',
            'error',
            firstGate
              ? {
                  label: 'Localizar en el mapa',
                  targetId: firstGate.id,
                  targetPoint: gp,
                  panel: 'design',
                }
              : null
          );
          return;
        }
        replayBaseRef.current = base;
        engineRef.current = eng;
        setEngineInstance(eng);
      } catch (err) {
        showToast('No se pudo iniciar el ensayo: ' + (err as Error).message);
        return;
      }
    }

    const nextRunning = !runningRef.current;
    runningRef.current = nextRunning;
    setRunning(nextRunning);
  }, [showToast, setPanel, setTool, setActiveModal, updateScene]);

  const handleTimelineInput = useCallback((seconds: number) => {
    draggingTimeRef.current = true;
    const bar = document.getElementById('timeline') as HTMLInputElement | null;
    if (bar) {
      const maxVal = Number(bar.max) || 28800;
      const pct = Math.max(0, Math.min(100, (seconds / maxVal) * 100));
      bar.style.setProperty('--progress', `${pct}%`);
    }
    const seekEl = document.getElementById('seek-time');
    if (seekEl) seekEl.textContent = timeLabel(seconds);
  }, []);

  const handleTimelineChange = useCallback(
    async (target: number) => {
      const isRewind =
        engineRef.current !== null && target < engineRef.current.time;
      if (safetyStopRef.current) {
        if (isRewind) {
          safetyStopRef.current = false;
          setSafetyStop(false);
          setCustomRiskReport(null);
          if (useProjectStore.getState().currentScene().safetyLock) {
            updateScene((sc) => {
              delete sc.safetyLock;
            });
          }
        } else {
          setActiveModal('risk');
          return;
        }
      }
      const version = ++seekIdRef.current;
      runningRef.current = false;
      setRunning(false);
      shiftRunRef.current = false;
      setShiftRun(false);
      draggingTimeRef.current = true;

      const currentPhase = useProjectStore.getState().phase;
      const s = useProjectStore.getState().currentScene();
      const m = useProjectStore.getState().currentMap();

      if (currentPhase === 'pre' || currentPhase === 'post') {
        if (!shiftPlanRef.current) {
          const plan = shift(s, m, currentPhase);
          if (plan.error) {
            showToast(
              plan.error,
              'error',
              plan.diagnostic?.targetId || plan.diagnostic?.targetPoint
                ? {
                    label: 'Localizar en el mapa',
                    targetId: plan.diagnostic.targetId,
                    targetPoint: plan.diagnostic.targetPoint,
                    panel: 'design',
                  }
                : null
            );
            shiftPlanRef.current = null;
            draggingTimeRef.current = false;
            return;
          }
          shiftPlanRef.current = plan;
        }
        const plan = shiftPlanRef.current;
        const maxVal = Math.min(plan.limit, plan.total);
        shiftTimeRef.current = Math.min(target, maxVal);
        const a = shiftAt(plan, shiftTimeRef.current);
        const clockEl = document.getElementById('clock');
        if (clockEl) clockEl.textContent = timeLabel(a.time);
        const infoEl = document.getElementById('shift-info');
        if (infoEl) infoEl.textContent = a.label;
        const shiftEl = document.getElementById('shift-layer');
        if (shiftEl) shiftEl.innerHTML = shiftSVG(plan, a);
        const bar = document.getElementById('timeline') as HTMLInputElement | null;
        if (bar) {
          bar.max = String(maxVal);
          bar.value = String(shiftTimeRef.current);
          const pct = maxVal > 0 ? (shiftTimeRef.current / maxVal) * 100 : 0;
          bar.style.setProperty('--progress', `${pct}%`);
        }
        const seekEl = document.getElementById('seek-time');
        if (seekEl) seekEl.textContent = timeLabel(shiftTimeRef.current);
        draggingTimeRef.current = false;
        return;
      }

      if (!engineRef.current) {
        togglePlay();
        runningRef.current = false;
        setRunning(false);
        if (!engineRef.current) {
          draggingTimeRef.current = false;
          return;
        }
        seekIdRef.current = version;
      }

      if (target < engineRef.current.time && replayBaseRef.current) {
        engineRef.current = createEngine(replayBaseRef.current);
        setEngineInstance(engineRef.current);
        replayCursorRef.current = 0;
      }

      const eng = engineRef.current!;
      const goal = Math.min(target, eng.duration);
      const bar = document.getElementById('timeline') as HTMLInputElement | null;
      if (bar) {
        bar.max = String(eng.duration);
        bar.value = String(goal);
        const pct = eng.duration > 0 ? (goal / eng.duration) * 100 : 0;
        bar.style.setProperty('--progress', `${pct}%`);
      }
      const seekEl = document.getElementById('seek-time');
      if (seekEl) seekEl.textContent = 'Calculando…';

      while (
        eng.time + 0.49 <= goal &&
        !eng.finished &&
        !safetyStopRef.current
      ) {
        if (version !== seekIdRef.current) {
          draggingTimeRef.current = false;
          return;
        }
        const end = performance.now() + 22;
        while (
          performance.now() < end &&
          eng.time + 0.49 <= goal &&
          !eng.finished
        ) {
          replayActions();
          eng.tick(0.5);
          eng.experience.update();
          if (!checkLiveSafety()) break;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      if (version !== seekIdRef.current) {
        draggingTimeRef.current = false;
        return;
      }
      replayActions();
      simTargetRef.current = eng.time;
      paintPeople();
      if (bar) {
        bar.value = String(eng.time);
        const pct = eng.duration > 0 ? (eng.time / eng.duration) * 100 : 0;
        bar.style.setProperty('--progress', `${pct}%`);
      }
      if (seekEl) seekEl.textContent = timeLabel(eng.time);
      draggingTimeRef.current = false;
      if (eng.finished && !safetyStopRef.current) triggerDayClose();
    },
    [
      showToast,
      togglePlay,
      replayActions,
      paintPeople,
      triggerDayClose,
      setActiveModal,
      checkLiveSafety,
      updateScene,
    ]
  );

  useEffect(() => {
    const onCornerClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLElement>('[data-dismiss-incident]');
      if (!btn) return;
      const id = btn.dataset.dismissIncident;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      dismissedIncidentsRef.current.add(id);
      syncDirectorOverlays();
    };
    const cornerEl = document.getElementById('incident-corner');
    cornerEl?.addEventListener('click', onCornerClick);
    return () => cornerEl?.removeEventListener('click', onCornerClick);
  }, [syncDirectorOverlays]);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let lastPaint = 0;

    function frame(now: number) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (shiftRunRef.current && shiftPlanRef.current) {
        const plan = shiftPlanRef.current;
        shiftTimeRef.current += dt * speedRef.current;
        const a = shiftAt(plan, shiftTimeRef.current);
        const clockEl = document.getElementById('clock');
        if (clockEl) {
          clockEl.textContent = new Date(a.time * 1000)
            .toISOString()
            .slice(11, 19);
        }
        const infoEl = document.getElementById('shift-info');
        if (infoEl) {
          infoEl.textContent = `${a.label} · ${plan.team} trabajadores · límite ${
            plan.limit / 3600
          } h`;
        }
        const shiftEl = document.getElementById('shift-layer');
        if (shiftEl) shiftEl.innerHTML = shiftSVG(plan, a);
        if (a.done) {
          shiftRunRef.current = false;
          setShiftRun(false);
          triggerDayClose();
          if (infoEl && shiftPlanRef.current) {
            infoEl.textContent += ` · Plan completo: ${
              plan.trips
            } viajes al contenedor · ${Math.round(
              plan.binWalk
            )} m de ida con bolsa. ${plan.alerts.join(' ')}`;
          }
        }
      }

      if (runningRef.current && engineRef.current) {
        const eng = engineRef.current;
        simTargetRef.current = Math.min(
          simTargetRef.current + dt * speedRef.current,
          eng.time + 120
        );
        const end = performance.now() + 10;
        while (
          eng.time + 0.49 <= simTargetRef.current &&
          !eng.finished &&
          performance.now() < end
        ) {
          replayActions();
          eng.tick(0.5);
          eng.experience.update();
          if (!checkLiveSafety()) break;
        }
        if (eng.finished && !safetyStopRef.current) {
          runningRef.current = false;
          setRunning(false);
          triggerDayClose();
          showToast('Ensayo finalizado. Puedes revisar los resultados.');
        }
        if (now - lastPaint > 100) {
          paintPeople();
          lastPaint = now;
        }
      }

      if (!draggingTimeRef.current) {
        const currentPhase = useProjectStore.getState().phase;
        const sc = useProjectStore.getState().currentScene();
        const isLog = currentPhase === 'pre' || currentPhase === 'post';
        const bar = document.getElementById(
          'timeline'
        ) as HTMLInputElement | null;
        if (bar) {
          const maxVal = isLog
            ? shiftPlanRef.current
              ? Math.min(
                  shiftPlanRef.current.limit,
                  shiftPlanRef.current.total
                )
              : 3600 * (sc.hoursLimit || 8)
            : engineRef.current?.duration || sc.base.hours * 3600;
          const curVal = isLog
            ? shiftTimeRef.current
            : engineRef.current?.time || 0;
          bar.max = String(maxVal);
          bar.value = String(curVal);
          const pct =
            maxVal > 0
              ? Math.max(0, Math.min(100, (Number(curVal) / maxVal) * 100))
              : 0;
          bar.style.setProperty('--progress', `${pct}%`);
          const seekEl = document.getElementById('seek-time');
          if (seekEl) seekEl.textContent = timeLabel(Number(curVal));
        }
      }

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [paintPeople, replayActions, showToast, triggerDayClose, checkLiveSafety]);

  const handleApplyProposal = useCallback(() => {
    if (!proposal || !(proposal.objects.length + proposal.moves.length)) return;
    const tagsForNew: PhaseKey[] =
      phase === 'all' ? ['event'] : [phase as PhaseKey];
    updateScene((s) => {
      if (proposal.routing) {
        for (const k of ['flows', 'corridors', 'fences'] as const) {
          const retained = new Set(proposal.routing[k].map((o) => o.id));
          const shown =
            phaseScene(s, phase === 'all' ? 'event' : phase)[k] || [];
          const removed = new Set(
            shown.filter((o) => !retained.has(o.id)).map((o) => o.id)
          );
          s[k] = (s[k] || []).filter((o) => !removed.has(o.id));
        }
      }
      const allObjs = [...s.base.booths, ...s.infrastructure, ...s.entrances];
      for (const move of proposal.moves) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = allObjs.find((o) => o.id === move.id) as any;
        if (obj) {
          obj.x = move.x;
          obj.y = move.y;
          obj.rotation = move.rotation;
          if (move.facing !== undefined && move.facing !== null) {
            obj.facing = move.facing;
          }
        }
      }
      for (const o of proposal.objects) {
        const clone = structuredClone(o);
        clone.phaseTags = tagsForNew;
        clone.id = crypto.randomUUID();
        if (clone.role === 'cover') {
          s.infrastructure.push(clone);
        } else {
          s.base.booths.push(clone);
        }
      }
    }, true);
    setProposal(null);
    resetSim();
    showToast('Propuesta aplicada. Puedes deshacerla en un paso.');
  }, [proposal, phase, updateScene, resetSim, showToast]);

  const handleSceneChanged = useCallback(() => {
    setProposal(null);
    resetSim();
  }, [resetSim]);

  const activeVenue = useProjectStore((s) => s.activeVenue);
  const revision = useProjectStore((s) => s.revision);
  const currentSceneObj = currentScene();
  const activeWeather =
    engineInstance?.s.base.weather || currentSceneObj.base.weather;

  const {riskSummary, isSafetyLocked} = useMemo(() => {
    void revision;
    void activeVenue;
    const sc = currentScene();
    return {
      riskSummary: assessRisk(sc),
      isSafetyLocked:
        sc.safetyLock?.fingerprint === safetyFingerprint(sc),
    };
  }, [currentScene, revision, activeVenue]);
  const hasSafetyBlocks =
    safetyStop || isSafetyLocked || riskSummary.critical.length > 0;
  const handleStartDiagnosticSim = useCallback(() => {
    safetyStopRef.current = false;
    setSafetyStop(false);
    setDiagnosticSimMode(true);
    setCustomRiskReport(null);
    setActiveModal(null);
    setPanel('simulate');
    showToast(
      'Simulación diagnóstica activa · Escenario no validado — uso exclusivamente analítico',
      'error'
    );
    setTimeout(() => togglePlay(true), 20);
  }, [setDiagnosticSimMode, setActiveModal, setPanel, showToast, togglePlay]);

  const safetyBannerText = diagnosticSimMode
    ? 'MODO DIAGNÓSTICO · Escenario no validado — uso exclusivamente analítico (no certifica seguridad)'
    : safetyStop || isSafetyLocked
      ? 'ENSAYO CANCELADO · corrige el fallo o ejecuta en modo diagnóstico'
      : riskSummary.critical.length
        ? `${riskSummary.critical.length} críticos · ${riskSummary.warnings.length} advertencias · Revisar riesgos`
        : `Revisión de riesgos · ${riskSummary.warnings.length} advertencias`;

  return (
    <>
      <Header
        onProjectImported={() => {
          setProposal(null);
          resetSim();
          setTimeout(() => mapRef.current?.fit(), 20);
        }}
        onPauseSimulation={() => {
          runningRef.current = false;
          setRunning(false);
          shiftRunRef.current = false;
          setShiftRun(false);
        }}
        onSceneChanged={handleSceneChanged}
      />

      <div className="app">
        <NavigationRail />

      <Sidebar
        engine={engineInstance}
        running={running}
        layoutOptions={layoutOptions}
        onLayoutOptionsChange={setLayoutOptions}
        proposal={proposal}
        showAlternative={showAlternative}
        onSetProposal={(p) => {
          setProposal(p);
          if (p) setShowAlternative(true);
        }}
        onToggleAlternative={() => setShowAlternative((a) => !a)}
        onApplyProposal={handleApplyProposal}
        onTogglePlay={togglePlay}
        onSceneChanged={handleSceneChanged}
        onRecordAction={recordAction}
        reviewTick={reviewTick}
        safetyStop={safetyStop}
      />

      <main className="workspace">
        <button
          type="button"
          id="safety-banner"
          className={`safety-banner ${hasSafetyBlocks ? 'has-blocks' : ''}`}
          onClick={() => {
            runningRef.current = false;
            setRunning(false);
            shiftRunRef.current = false;
            setShiftRun(false);
            setActiveModal('risk');
          }}
        >
          {safetyBannerText}
        </button>
        <PhaseStrip
          onPhaseChanged={() => {
            setProposal(null);
            resetSim();
          }}
          onVenueChanged={() => {
            setProposal(null);
            resetSim();
            setTimeout(() => mapRef.current?.fit(), 20);
          }}
        />
        <WorkspaceBar />
        <MapShell
          ref={mapRef}
          proposal={proposal}
          showAlternative={showAlternative}
          onClearProposal={() => setProposal(null)}
          onSceneChanged={handleSceneChanged}
          onUndoRedo={(isRedo) => {
            undo(isRedo);
            setProposal(null);
            resetSim();
            setTimeout(() => mapRef.current?.fit(), 20);
          }}
          activeWeather={activeWeather}
        />
        <SimulationStrip
          running={running}
          shiftRun={shiftRun}
          speed={speed}
          onSpeedChange={(s) => {
            setSpeed(s);
            speedRef.current = s;
          }}
          onTogglePlay={togglePlay}
          onResetSim={resetSim}
          onTimelineInput={handleTimelineInput}
          onTimelineChange={handleTimelineChange}
        />
        <SourceBar />
      </main>

      <DemandDialog />
      <ProgrammeDialog />
      <InventoryDialog onSceneCommitted={handleSceneChanged} />
      <LaboratoryDialog
        layoutSpace={layoutOptions.space}
        onAdoptScene={handleSceneChanged}
      />
      <ContactsDialog />
      <OrganizationsDialog onSceneChanged={handleSceneChanged} />
      <ParametersDialog onSceneChanged={handleSceneChanged} />
      <ClosingDialog
        data={closingData}
        onPhaseChanged={() => {
          setProposal(null);
          resetSim();
        }}
        onSceneChanged={handleSceneChanged}
        onReproduceSeed={(seed) => {
          const st = useProjectStore.getState();
          st.setSimSeedMode('fixed');
          st.setSimSeedValue(seed);
          updateScene((sc) => {
            sc.seed = seed;
            sc.seedMode = 'fixed';
          });
          setActiveModal(null);
          setPanel('simulate');
          resetSim();
          showToast(
            `Semilla #${seed} fijada · pulsa Iniciar para reproducir exactamente este ensayo`
          );
        }}
      />
      <ComparisonDialog onSceneChanged={handleSceneChanged} />
      <InfoDialog />
      <RiskDialog
        engine={engineInstance}
        safetyStop={safetyStop}
        customReport={customRiskReport}
        onClearCustomReport={() => setCustomRiskReport(null)}
        onSceneChanged={handleSceneChanged}
        onStartDiagnosticSim={handleStartDiagnosticSim}
        onReproduceSeed={(seed) => {
          const st = useProjectStore.getState();
          st.setSimSeedMode('fixed');
          st.setSimSeedValue(seed);
          updateScene((sc) => {
            sc.seed = seed;
            sc.seedMode = 'fixed';
          });
          setCustomRiskReport(null);
          setActiveModal(null);
          setPanel('simulate');
          resetSim();
          showToast(
            `Semilla #${seed} fijada · pulsa Iniciar para reproducir exactamente este fallo`
          );
        }}
      />
      <SmallExampleDialog
        onApplied={() => {
          setProposal(null);
          resetSim();
          setTimeout(() => mapRef.current?.fit(), 20);
        }}
      />
      <DeveloperReferenceDialog />

      <GameMenu
        onResume={() => {
          setTimeout(() => mapRef.current?.fit(), 20);
        }}
      />

      <PlainLanguageEnhancer />
      <TutorialOverlay />
      <Toast />
      </div>
    </>
  );
};
