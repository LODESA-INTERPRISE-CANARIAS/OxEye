# 04 · Estado Actual del Proyecto — Ojo de Buey (OxEye)

> **Archivo vivo:** Este es el único documento que necesitas actualizar y re-subir a Claude.ai cuando el proyecto avance.  
> **Última actualización:** `25/11/2026`

---

## 1. Fotografía del repositorio

| Campo | Valor actual |
| :--- | :--- |
| **Repositorio** | `https://github.com/LODESA-INTERPRISE-CANARIAS/OxEye.git` |
| **Versión en `package.json`** | `0.16.0` *(base nominal; iteraciones funcionales hasta `23/11/2026`)* |
| **Rama activa** | `main` (sincronizada con `origin/main`, working tree limpio) |
| **Otras ramas locales/remotas** | `mapa-y-perimetros` (local), `mod-panel-objeto` (local y remota) |
| **Último commit en `main`** | `6fd5f76` — `DOC: Reportes en PDF` |
| **Despliegue** | GitHub Pages automático en push a `main` (`lint` + `test` + `build`) |

### Métricas del código base

- **Módulos de motor (`src/engine/`)**: `63` archivos TypeScript puros.
- **Componentes UI (`src/components/`)**: `42` archivos TSX.
- **Tests unitarios (`tests/unit/`)**: `23` suites Vitest.
- **Tests E2E (`tests/e2e/`)**: `10` suites Playwright.
- **Memorias técnicas archivadas**: `doc/changes/FEATURES_2026-11-21.md`, `doc/changes/FEATURES_2026-11-22_23.md` y sus reportes PDF en `doc/changes/report/`.

---

## 2. Últimos hitos cerrados (21–23/11/2026)

Resumen de los cambios más recientes ya integrados en `main`:

1. **`6fd5f76` / `74bd0f2` (DOC)**: Memoria técnica completa de las entregas del `22–23/11/2026` y reportes PDF.
2. **`541ad39` (FIX)**: Eliminación de la «Guía para programadores» de la cabecera principal.
3. **`48c1801` (FIX)**: Fuente única de demanda (`EventDemandConfig`), sincronización bidireccional Calculadora ↔ Simulador, diálogo seguro de cambios en caliente y rediseño de la Calculadora en 4 pestañas.
4. **`b3ed3c0` (FEAT)**: Motor de comportamiento humano (13 rasgos, necesidades dinámicas, grupos sociales), afluencia por asistentes únicos con conservación estricta, 12 consultas cotidianas, 5 falsas alarmas verificables y orientación colectiva de `1–10` personas.
5. **`da013c3` (FEAT)**: Generador contextual de incidencias por instalación (`SimulationInspector`), propagación física multifoco de incendios en 3 anillos y amenazas a servicios sensibles.
6. **`bab4719` (FEAT)**: `Carpa Amarilla`, `Punto Violeta` (con protocolo de privacidad), taxonomía de 8 categorías e `IncidentAnalysisPanel` con reproductor `T+00:00`.
7. **`cb4c43e` (FIX)**: Líneas de selección más finas, reloj digital `HH:MM:SS`, vallado post-incendio por equipo de montaje y logo/favicon reactivos a la paleta.
8. **`77a2a04` (FEAT)**: Catálogo de 40 Objetivos SMART calculables en 10 categorías con configurador visual, jerarquía y detección de compromisos.
9. **`7139569` / `f450cc4` / `4f4e4f0` (FEAT/FIX)**: Flota de vehículos de emergencia estacionados, furgón policial (`police_van`), navegación sanitaria en 3 rutas (A vehicular, B a pie, C camilla desplegada), clasificación de accesos y exclusión temporal de vallas de `event` en `pre`.
10. **`ee9052a` / `115ffd6` / `725b6d9` / `a0008c7` (FEAT)**: Paneles redimensionables, policía en puesto fijo, subperímetros (`staffFree`), secuenciación logística progresiva, elementos `permanent`, selección cíclica + caja `Shift` + alineación/distribución y movilidad vehicular unificada con bases exteriores.
11. **Bloque del `21/11/2026` (`66cc4a1` y anteriores)**: Semillas híbridas, menú de inventario en 3 columnas (límite `500` piezas) + tiempos de respuesta en Tenerife, asistente de corrección espacial, `StewardSystem`, red de ramales en rutas, lastres/contrapesos (`500 kg/m²`), agrupación jerárquica `Ctrl+G`, capa Rayos X con muros perimetrales y modo «Solo subsuelo», vallas encadenadas/sueltas + rebeldes, 6 paletas, tutorial obligatorio y selector de ubicación personalizada OSM/PNOA.

---

## 3. Deuda documental / detalles técnicos detectados

- **`README.md` desactualizado respecto a `main`**: Todavía menciona el límite antiguo de `150` piezas (actualmente es `500`), el catálogo de `27` piezas (ya incorpora lastres, furgón policial, steward, Carpa Amarilla y Punto Violeta) y no refleja aún varias features de los días 21–23/11/2026.
- **Versión en `package.json`**: Sigue en `0.16.0` pese al gran salto funcional reciente; pendiente decidir esquema de versionado si se va a etiquetar release.
- **Ramas secundarias abiertas**: Existen `mapa-y-perimetros` (local) y `mod-panel-objeto` (local/remota); conviene confirmar si están obsoletas o en curso.

---

## 4. Tablero vivo de gestión *(rellenar y mantener desde Claude)*

### En curso actualmente
- *(Añadir aquí las tareas activas de esta semana)*

### Próximas prioridades (Backlog)
- [ ] *(Ej.: Actualizar `README.md` y versionado de `package.json`)*
- [ ] *(Ej.: Próxima feature o ajuste de UX/simulación)*

### Riesgos / Bloqueos abiertos
- *(Ninguno registrado aún)*

### Decisiones recientes del equipo
- `25/11/2026`: Creación del Proyecto en Claude.ai con base de conocimiento modular (`doc/claude/`) para gestión continua del proyecto.
