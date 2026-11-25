# 02 · Arquitectura Técnica y Stack — Ojo de Buey (OxEye)

## 1. Stack tecnológico

| Capa | Tecnología | Versión / Notas |
| :--- | :--- | :--- |
| **UI y Tipado** | React + TypeScript estricto | React `19.0`, TypeScript `~5.7.2` |
| **Bundler / Dev** | Vite | Vite `6.0.5` |
| **Estado global** | Zustand | Zustand `5.0.2` (`useProjectStore.ts`) |
| **Persistencia** | Drizzle ORM + Dexie (IndexedDB) + `localStorage` + JSON/CSV | `drizzle-orm ^0.38`, `dexie ^4.0.10` |
| **Estilos** | CSS modular con variables por paleta (`data-palette`) | Sin frameworks CSS externos |
| **Calidad** | ESLint (`gts` / Google TypeScript Style) + Prettier + TypeDoc | `eslint ^9.17`, `prettier ^3.4`, `typedoc ^0.27` |
| **Testing** | Vitest (unitarios) + Playwright (E2E) | `vitest ^2.1.8`, `@playwright/test ^1.49.1` |
| **Despliegue** | GitHub Actions → GitHub Pages | Workflow `.github/workflows/deploy-pages.yml` en push a `main` (Node 22) |

## 2. Principios arquitectónicos clave

1. **Motor puro en TypeScript desacoplado de React**: Toda la lógica matemática, geométrica, logística, de multitudes y emergencias vive en `src/engine/` (63 módulos) sin dependencias de React ni del DOM. Esto permite testearla rápido con Vitest y ejecutar ensayos en segundo plano (Laboratorio, Autoinforme, Comparador de incidencias).
2. **Rendimiento a 60 FPS en SVG**: El estado del proyecto, herramientas y UI se gestiona en Zustand (`src/store/useProjectStore.ts`), pero el estado mutable de alta frecuencia de la simulación (`EventEngine`, agentes, partículas, vehículos) se mantiene desacoplado de renders completos de React para mantener fluidez sobre el lienzo SVG (`MapShell.tsx`).
3. **Sistema de coordenadas triple**:
   - **Escena (`percent`)**: `[0..100, 0..100]` relativo al mapa (permite remapeos).
   - **Local (`world`, metros)**: `localX = (x/100) * widthMeters`, `localY = (y/100) * heightMeters`.
   - **Absoluto UTM (`EPSG:32628`)**: `UTM_E = bbox[0] + localX`, `UTM_N = bbox[3] - localY`, más rejilla alfanumérica (`CELDA R14`).
4. **Reproducibilidad determinista**: Sistema híbrido de semillas (`random` / `fixed`) propagado a motores de multitudes, llegadas, logística e incidencias para poder reproducir y comparar exactamente cualquier simulación.
5. **Fuente única de verdad para la demanda (`EventDemandConfig`)**: `src/engine/planning/event-demand.ts` sincroniza bidireccionalmente la Calculadora de servicios (`DemandDialog.tsx`) y el panel lateral de simulación (`Sidebar.tsx`), con protección ante cambios en caliente (`DemandChangeDialog.tsx`).

## 3. Estructura real del repositorio

```text
OxEye/
├── .agents/agents/             # Definición de agentes locales: prompt-engineer.md y oxeye-developer.md
├── .github/workflows/          # deploy-pages.yml (lint -> unit tests -> build -> GitHub Pages)
├── doc/
│   ├── SPECIFICATIONS.md       # Especificación fundacional v1.0
│   ├── changes/                # Memorias técnicas (FEATURES_2026-11-21.md, FEATURES_2026-11-22_23.md y PDFs)
│   ├── claude/                 # Base de conocimiento para Claude Projects
│   └── references/             # Prototipo HTML original y prompt inicial
├── public/                     # favicon.svg y ortofotos PNOA (cristo.jpg, constitucion.jpg, vega.jpg)
├── src/
│   ├── App.tsx                 # Orquestador principal de la aplicación
│   ├── components/             # 42 componentes React:
│   │   ├── common/             # CustomizableSelect, PlainLanguageEnhancer, Toast, TutorialOverlay
│   │   ├── demand/             # DemandControls (controles compartidos de demanda)
│   │   ├── header/             # Header
│   │   ├── icons/              # InventoryIcons
│   │   ├── layout/             # NavigationRail, PhaseStrip, Sidebar, SourceBar, VenueTabs, WorkspaceBar
│   │   ├── map/                # MapShell, Inspector, SimulationInspector, SubsoilInspector,
│   │   │                       # IncidentQuickInspector, LayerPanel, XRayLayer, selectionActions, useMapShortcuts, xrayTools
│   │   ├── menu/               # GameMenu (portada + Wizard 4 pasos), LocationPicker
│   │   ├── modals/             # ClosingDialog, ComparisonDialog, ContactsDialog, DemandChangeDialog,
│   │   │                       # DemandDialog, InfoDialog, InventoryDialog, LaboratoryDialog, ObjectivesDialog,
│   │   │                       # OrganizationsDialog, ParametersDialog, PostSimDiagnosticsView,
│   │   │                       # ProgrammeDialog, RiskDialog, SmallExampleDialog
│   │   ├── planning/           # ObjectivesConfigurator, ObjectiveCategoryIcon
│   │   ├── review/             # SpatialAssistantPanel
│   │   └── simulation/         # SimulationStrip, IncidentAnalysisPanel
│   ├── data/                   # catalog.ts, geodata.ts, inventory-meta.ts, palettes.ts,
│   │                           # plain-language-fields.ts, site-reference.ts, venue-maps.ts, json/{carto,maps}.json
│   ├── db/                     # schema.ts (Drizzle) y repository.ts (persistencia local + JSON)
│   ├── engine/                 # 63 módulos puros TS organizados en 9 dominios:
│   │   ├── cartography/        # custom-map, fences, geometry, groups, minimap, object-skin, route-network, selection-tools, spawns, transform
│   │   ├── crowd/              # attendance-model, crowd-guidance, demography, event-engine, event-model,
│   │   │                       # everyday-interactions, feedback, grid-flow, human-behavior, personas,
│   │   │                       # presets, route-traces, shelter, small-example, steward-system
│   │   ├── dining/             # dining, furniture
│   │   ├── director/           # director-logic
│   │   ├── emergency/          # contextual-incidents, emergency-lab, evacuation, fire-model, incident-center,
│   │   │                       # incident-crowd, incident-dashboard, motion, priority, response-example,
│   │   │                       # response-model, risk-guidance, risk, stretcher-nav, vehicle-dispatch, watch
│   │   ├── experience/         # experience-monitor, post-sim-diagnostics, review-memory
│   │   ├── logistics/          # companies, phases, shift
│   │   ├── mobility/           # vehicle-system
│   │   ├── planning/           # ballast, batch, contacts, demand, evaluator, event-demand, inventory,
│   │   │                       # layout, objectives, programme, spatial-assistant
│   │   └── subsoil/            # heat
│   ├── store/                  # useProjectStore.ts (Zustand)
│   ├── styles/                 # variables.css, index.css, layout.css, map.css, dialogs.css, game-menu.css
│   └── types/                  # index.ts (~1.660 líneas con todo el modelo de datos tipado)
└── tests/
    ├── unit/                   # 23 suites Vitest cubriendo cada subsistema del motor
    └── e2e/                    # 10 suites Playwright cubriendo flujos completos de UI
```

## 4. Capas del lienzo SVG (`MapShell.tsx`)

Ordenadas de fondo a frente:
1. `#base-layer` (Plano vectorial OSM o Ortofoto PNOA/Esri)
2. `#grid-layer` (Cuadrícula `5 / 10 / 20 / 50 m` alfanumérica)
3. `#heat-layer` (Mapas de calor logarítmicos de Flujos y Esperas)
4. `#xray-layer` (Subsuelo: máscara booleana, pilares, muros de carga, muros perimetrales y calor estructural)
5. `#scenario-layer` (Perímetro, reservas, zonas libres/interés, subperímetros, recorridos, vallas, puestos, infraestructura, accesos, viales)
6. `#layout-preview` (Previsualizaciones del autoconfigurador y asistente espacial)
7. `#annotation-layer` (Observaciones numeradas y mediciones planimétricas)
8. `#draft-layer` (Geometrías en dibujo con vértices de tamaño constante en pantalla)
9. `#shift-layer` (Animación logística de camiones, carretillas, bultos y cuadrillas)
10. `#dining-layer` (Mesas picnic, estado mojado/seco y operarios de secado)
11. `#people-layer` (Visitantes a escala física `0,5 m`, stewards y estados)
12. `#response-layer` (Patrullas Watch, vehículos de emergencia, focos de incendio, cordones post-incendio y rutas A/B/C)

## 5. Comandos de desarrollo y pipeline CI/CD

```bash
npm run dev          # Servidor local Vite
npm run lint         # ESLint (Google TS Style) sobre src/ y tests/
npm run test         # 23 suites unitarias con Vitest
npm run build        # tsc -b && vite build
npm run test:e2e     # 10 suites E2E con Playwright
npm run format       # Prettier
npm run docs         # TypeDoc
```

**CI/CD (`.github/workflows/deploy-pages.yml`)**: Cada `push` a `main` ejecuta `npm ci` → `npm run lint` → `npm run test` → `GITHUB_PAGES=true npm run build` y publica `./dist` en GitHub Pages.

## 6. Flujo de trabajo con agentes locales

El repositorio define dos roles especializados en `.agents/agents/`:
- **`prompt-engineer`**: Convierte peticiones en lenguaje natural en especificaciones técnicas estructuradas (solo lectura, sin editar código).
- **`oxeye-developer`**: Recibe la especificación técnica, la implementa respetando convenciones, verifica con build/lint/tests y reporta resultados (sin commits ni acciones destructivas sin confirmación).

Desde Claude.ai puedes actuar como capa estratégica y documental que alimenta directamente este flujo.
