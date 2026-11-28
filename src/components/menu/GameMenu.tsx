import React, {Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {useProjectStore} from '../../store/useProjectStore';
import {inGestor} from '../../logistics/shell/address';
import {
  LogisticsBoundary,
  LogisticsLoading,
} from '../../logistics/LogisticsLoading';
import {AboutScreen} from './AboutScreen';
import {HubHome} from './HubHome';
import type {HubRoute} from './hubRoute';
import {NewModelWizard} from './NewModelWizard';
import {SettingsScreen} from './SettingsScreen';
import {SimulatorSection} from './SimulatorSection';
import {useHubRoute} from './useHubRoute';

// Logistics Manager: separate chunk, loaded only when opened.
const LogisticsApp = React.lazy(() => import('../../logistics/LogisticsApp'));

const LOGISTICS_TITLE = 'Gestor logístico · OxEye';

const TITLE_OF: Record<HubRoute, string> = {
  home: 'OxEye',
  simulator: 'Simulador · OxEye',
  'new-model': 'Nuevo modelo · OxEye',
  workspace: 'Simulador · OxEye',
  settings: 'Ajustes · OxEye',
  about: 'Acerca de OxEye',
  // Only while the Gestor opens or closes over the portada (the title is
  // the Gestor's whenever it is open).
  logistics: 'OxEye',
};

export interface GameMenuProps {
  onResume: () => void;
}

/**
 * The OxEye hub (`#game-menu`): Portada, Simulador, Ajustes and Acerca de,
 * each at its own clean address (`hubRoute.ts`), plus the Gestor logístico
 * at `/gestor-logistico/**` over it.
 *
 * `/simulador/modelo` mirrors the simulation workspace (`menuOpen === false`):
 * closing the menu writes it, Back from it reopens the menu, and loading it
 * directly resumes the saved model.
 */
export const GameMenu: React.FC<GameMenuProps> = ({onResume}) => {
  const menuOpen = useProjectStore(s => s.menuOpen);
  const project = useProjectStore(s => s.project);
  const hasSavedProject = useProjectStore(s => s.hasSavedProject);
  const preferences = useProjectStore(s => s.preferences);
  const currentScene = useProjectStore(s => s.currentScene);
  const setMenuOpen = useProjectStore(s => s.setMenuOpen);
  const setTutorialActive = useProjectStore(s => s.setTutorialActive);
  const showToast = useProjectStore(s => s.showToast);

  const {route, navigate} = useHubRoute();
  const [logisticsOpen, setLogisticsOpen] = useState(inGestor);

  // `/gestor-logistico/**` opens the Logistics Manager directly (also on
  // Back/Forward), but only from the hub: never on top of a running
  // simulation. Path changes fire only `popstate` (it also comes with a
  // pasted fragment, rewritten to its clean address by `useHubRoute` first).
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  useEffect(() => {
    const onPop = () => {
      const wanted = inGestor();
      if (wanted && !menuOpenRef.current) {
        // The simulation is in use: the Gestor stays closed and the address
        // goes back to the workspace, so address and screen agree. Same
        // event as `useHubRoute`'s own update, so the hub never sees the
        // `logistics` route (which would pause the simulation).
        navigate('workspace', {replace: true});
        return;
      }
      setLogisticsOpen(wanted);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [navigate]);

  // True when opening from the hub added a history entry, so closing can pop
  // it instead of leaving a duplicate hub entry behind.
  const pushedLogisticsEntry = useRef(false);

  const openLogistics = () => {
    setLogisticsOpen(true);
    if (!inGestor()) {
      pushedLogisticsEntry.current = true;
      navigate('logistics');
    }
  };

  const closeLogistics = useCallback(() => {
    setLogisticsOpen(false);
    if (pushedLogisticsEntry.current && inGestor()) {
      pushedLogisticsEntry.current = false;
      window.history.back();
    } else if (inGestor()) {
      // Opened from a link: its entry becomes the portada.
      pushedLogisticsEntry.current = false;
      navigate('home', {replace: true});
    }
    requestAnimationFrame(() =>
      document.getElementById('game-logistics')?.focus(),
    );
  }, [navigate]);

  const canContinue = hasSavedProject && !!project.scenes.cristo;
  const activeTitle = currentScene().title;

  const resumeWorkspace = useCallback(
    (withGuide: boolean) => {
      setMenuOpen(false);
      onResume();
      if (withGuide && preferences.help !== false) {
        showToast(
          'Inventario → Diseñar → Simular → Revisar. Guarda una copia con Exportar proyecto.',
        );
      }
    },
    [onResume, preferences.help, setMenuOpen, showToast],
  );

  const handleContinue = () => {
    if (!canContinue) return;
    resumeWorkspace(true);
  };

  // --- Address ↔ workspace -------------------------------------------------
  // Latest values for the two effects below, which each react to one side.
  const routeRef = useRef(route);
  routeRef.current = route;
  const canContinueRef = useRef(canContinue);
  canContinueRef.current = canContinue;
  const resumeRef = useRef(resumeWorkspace);
  resumeRef.current = resumeWorkspace;

  // The menu closed (Continuar, a loaded file, a new model, the tutorial) or
  // reopened (the workspace's «Menú»): follow it in the address.
  // The `first…Run` guards assume effects run once on mount (no StrictMode
  // in `main.tsx`); under StrictMode they would need a different guard.
  const firstMenuRun = useRef(true);
  useEffect(() => {
    if (firstMenuRun.current) {
      firstMenuRun.current = false;
      return;
    }
    const at = routeRef.current;
    if (!menuOpen && at !== 'workspace') {
      // A new model replaces the wizard's entry: Back goes to «Simulador».
      navigate('workspace', {replace: at === 'new-model'});
    } else if (menuOpen && at === 'workspace') {
      navigate('simulator');
    }
  }, [menuOpen, navigate]);

  // The address changed (Back / Forward, a link, a reload): follow it.
  useEffect(() => {
    const open = menuOpenRef.current;
    if (route === 'workspace' && open) {
      if (canContinueRef.current) resumeRef.current(false);
      else navigate('simulator', {replace: true});
    } else if (route !== 'workspace' && !open) {
      // The workspace's own «Menú» button pauses the simulation and opens
      // the menu; Back must do exactly the same.
      const menuButton = document.getElementById('main-menu');
      if (menuButton) menuButton.click();
      else setMenuOpen(true);
    }
  }, [route, navigate, setMenuOpen]);

  // Tab title and focus follow the screen.
  const firstRouteRun = useRef(true);
  const previousRoute = useRef(route);
  useEffect(() => {
    if (!logisticsOpen) document.title = TITLE_OF[route];
    else document.title = LOGISTICS_TITLE;
  }, [route, logisticsOpen]);
  useEffect(() => {
    const from = previousRoute.current;
    previousRoute.current = route;
    if (firstRouteRun.current) {
      firstRouteRun.current = false;
      return;
    }
    if (route === 'workspace') return;
    // Opening or leaving the Gestor: the portada stays where it was, and
    // closing puts the focus back on «Gestor logístico» (closeLogistics).
    if (route === 'logistics' || from === 'logistics') return;
    // The hub is one scroll container: each screen starts at its top.
    const hub = document.getElementById('game-menu');
    if (hub) hub.scrollTop = 0;
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('#game-menu h1')
        ?.focus({preventScroll: true}),
    );
  }, [route]);

  // «Volver al simulador»: when the wizard was opened from the Simulador in
  // this page, step back in the history (as Back would) instead of pushing a
  // second `/simulador` that would make Back reopen the wizard.
  const wizardOverSimulator = useRef(false);
  useEffect(() => {
    if (route !== 'new-model') wizardOverSimulator.current = false;
  }, [route]);
  const leaveWizard = () => {
    if (wizardOverSimulator.current) {
      wizardOverSimulator.current = false;
      window.history.back();
    } else {
      navigate('simulator', {replace: true});
    }
  };

  const openTutorial = () => {
    if (!canContinue) return;
    setTutorialActive(true);
    resumeWorkspace(false);
  };

  return (
    <>
      {logisticsOpen && (
        <LogisticsBoundary onClose={closeLogistics}>
          <Suspense fallback={<LogisticsLoading />}>
            <LogisticsApp onClose={closeLogistics} />
          </Suspense>
        </LogisticsBoundary>
      )}
      <div
        id="game-menu"
        className="game-menu lx hub"
        data-hub-route={route}
        hidden={!menuOpen}
        inert={logisticsOpen || undefined}
      >
        {(route === 'home' ||
          route === 'workspace' ||
          route === 'logistics') && (
          <HubHome
            canContinue={canContinue}
            modelTitle={activeTitle}
            onOpenLogistics={openLogistics}
            onNavigate={navigate}
          />
        )}
        {route === 'simulator' && (
          <SimulatorSection
            canContinue={canContinue}
            modelTitle={activeTitle}
            onContinue={handleContinue}
            onNewModel={() => {
              wizardOverSimulator.current = true;
              navigate('new-model');
            }}
            onNavigate={navigate}
          />
        )}
        {route === 'new-model' && (
          <NewModelWizard onCancel={leaveWizard} onCreated={onResume} />
        )}
        {route === 'settings' && (
          <SettingsScreen
            canContinue={canContinue}
            onOpenTutorial={openTutorial}
            onNavigate={navigate}
          />
        )}
        {route === 'about' && <AboutScreen onNavigate={navigate} />}
      </div>
    </>
  );
};
