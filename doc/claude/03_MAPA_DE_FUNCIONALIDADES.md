# 03 · Mapa Consolidado de Funcionalidades — Ojo de Buey (OxEye)

> **Propósito:** Consolidar en una única fuente de verdad todas las capacidades implementadas actualmente en OxEye (integrando `SPECIFICATIONS.md` + entregas del `21/11/2026` + entregas del `22–23/11/2026`). En caso de discrepancia con documentos antiguos (como el límite anterior de 150 piezas), **prevalece este documento**.

---

## 1. Inicio, Onboarding y Configuración del Proyecto

- **Menú Principal (`GameMenu.tsx`)**: Continuar (bloqueado si no existe sesión guardada válida), Cargar modelo `.json`, Crear nuevo modelo (Wizard en 4 pasos), Ajustes (velocidad inicial `1×–1200×`, `reduce-motion`, **6 paletas de color** con emblema/favicon reactivos, relanzar tutorial), Créditos y Salir (*«Sesión guardada»*).
- **Ubicación personalizada (`LocationPicker.tsx`, `custom-map.ts`)**: Permite elegir Plaza del Cristo o cualquier punto real del mundo con buscador Nominatim, mapa interactivo con pin central, área cuadrada ajustable (`200×200 m` a `600×600 m`), extracción vectorial automática vía Overpass (OSM) y ortofoto de alta resolución (`PNOA–IGN z19–z20` en España/Canarias, `Esri World Imagery` fuera).
- **Calendario y jornadas operativas**: Días del evento (`1–30` días) + jornadas configurables de Montaje previo (`pre`) y Recogida/Limpieza (`post`) con nombre, fecha y horario (`0,5–12 h`).
- **Objetivos SMART (`ObjectivesConfigurator.tsx`, `objectives.ts`)**: Catálogo extensible de **40 objetivos calculables en 10 categorías** (Familias, Comercio local, Gastronomía, Cultura, Música, Accesibilidad, Seguridad, Logística, Economía, Sostenibilidad), con metas numéricas, jerarquía (*Esencial / Importante / Deseable*), detección automática de compromisos (*tradeoffs*), confirmación explícita de hipótesis y restricciones no negociables.
- **Onboarding guiado en 2 pasos + Tutorial interactivo**: Paso 1 delimitar perímetro → detección automática de spawns en cruces con calles → Paso 2 definir inventario. Tutorial *spotlight* de 9 pasos activado por defecto en el primer proyecto.

---

## 2. Espacio `01 · Diseñar` (Edición CAD/GIS, Subsuelo y Catálogo)

- **Límite del recinto**: Hasta **500 elementos** por recinto (ampliado desde 150).
- **Menú de Inventario en 3 columnas (`InventoryDialog.tsx`)**: Pestañas por categoría, buscador instantáneo, tarjetas con iconos, desglose dinámico `0 / 1 / 2+` unidades y pestaña de **Tiempos de respuesta externos en Tenerife**. Modos de inserción manual (`pendingStock`) o propuesta automática en minimapa.
- **Catálogo completo**:
  - *Oferta y mobiliario*: artesanía, libros, producto local, puesto general, ventorrillo, foodtruck, taller, escenario, descanso, mesa picnic, carpa, aseos, contenedores, **lastre/contrapeso (`ballast`)**.
  - *Emergencias, seguridad y servicios protegidos*: equipo sanitario, ambulancia, bomberos, coche policial, **furgón policial (`police_van`, hasta 8 agentes)**, policía a pie (`security`, escala `0,5 m`, patrulla móvil o **puesto fijo `fixedPost`**), **personal de asistencia (`steward`)**, **Carpa Amarilla (`yellow_tent`)** y **Punto Violeta (`violet_point`)**.
  - *Infraestructura del espacio*: accesos acoplados al perímetro (`gateLine`), punto eléctrico (`power`), **maniobra poligonal (`turning`)**, **carga/descarga poligonal (`loadingZone`)**, limpieza, acondicionamiento, montaje, desmontaje y acopio.
- **Perímetros, accesos y zonas especiales**:
  - Perímetro booleano (`add`/`subtract`), reservas excluidas, **zonas libres transitables / de interés (`interestZone`)**, **subperímetros técnicos restringidos** (malla dual `free` para público vs. `staffFree` para personal y emergencias), recorridos peatonales en **red de ramales** (con opción de curvas Bézier) y propuestas viales.
  - **Accesos con clipping obligatorio al perímetro**: orientación automática de flechas interior/exterior, 5 categorías operativas (`pedestrian_only`, `emergency_vehicle`, `mixed`, `conditional` con demora `15 s`, `physically_blocked`), menú desplegable de autoridades permitidas, sliders de flujo/capacidad y opción de **Base Vehicular Exterior (`externalBase`)**.
- **Sistema de Vallas (`fences.ts`)**: Vallas encadenadas (`fence:chain`) y sueltas (`fence:loose`) de largo fijo configurable (`0,5–10 m`, defecto `3,5 m`), vista fantasma, ajuste angular a `15°` con `Mayús`, imán automático (`0,5 m`) y rotación rígida de ramas.
- **Capa «Rayos X» (Subsuelo)**: Perímetro booleano seleccionable/eliminable cuyos bordes actúan automáticamente como **muros perimetrales de carga**, pilares circulares, muros interiores arrastrables, modo vista **«Solo subsuelo»** y mapa de calor estructural en vivo que alerta en Inspector y Riesgos si una carga pesada cae sobre forjado hueco.
- **Lastres y carpas (`ballast.ts`)**: Cálculo automático de `kg/m²` (activa `heavyLoad` a partir de `500 kg/m²`) y configuración por fabricante en carpas (tramos, lastres/tramo, masa mínima, generación rápida de faltantes y separación de peso propio vs. lastres).
- **Productividad CAD y paneles**:
  - **Agrupación jerárquica multinivel (`Ctrl+G` / `Mayús+G`)**, selección cíclica de elementos superpuestos (p. ej. mesa bajo carpa), selección por caja (`Shift + arrastrar`), movimiento/rotación rígida, **alineación en 6 modos y distribución equidistante anti-solape** (`minGap = 0,5 m`), bloqueo individual (`locked`), propiedad **Elemento permanente (`permanent`)**, `Ctrl+C`/`Ctrl+V`, `Supr`, `Ctrl+Z`/`Ctrl+Y` y **paneles laterales redimensionables**.
- **Autoconfigurador espacial (`layout.ts`)**: 3 estrategias (*Patio central*, *Paseo longitudinal*, *Islas de actividad*) con vista previa no destructiva.

---

## 3. Espacio `02 · Simular` (Multitudes, Comportamiento Humano, Emergencias y Logística)

- **Barra de simulación y Modo Director**: Reloj digital `HH:MM:SS` sincronizado con el horario real, clima en vivo (*Sol*, *Nubes*, *Lluvia*, *Viento*), luz solar (`6:00–23:00`), vista inmersiva, lentes (*Personas*, *Flujos*, *Esperas*), sistema híbrido de semillas (`Aleatoria` / `Fija`) y modo diagnóstico.
- **Motor de multitudes y comportamiento humano (`event-engine.ts`, `human-behavior.ts`, `attendance-model.ts`)**:
  - Malla de navegación `0,75 × 0,75 m` con doble máscara (`free` / `staffFree`), campos BFS con caché LRU y evasión local.
  - **Modelo de afluencia por asistentes únicos** con 9 curvas horarias y **conservación estricta de población** ($\text{Ocup}(t+1) = \text{Ocup}(t) + \text{Entradas} - \text{Salidas}$).
  - **Cerebro sintético**: 1.000 personas calibradas a La Laguna, rutinas diarias, **13 rasgos de personalidad**, **motor de necesidades fisiológicas** (hambre, sed, fatiga, aseo, sombra, refugio), conocimiento parcial del recinto, elección multicriterio por utilidad y **grupos sociales** con separación temporal y punto de reencuentro.
  - **Asistentes rebeldes (`rebelShare`, 1 %)**: intentan saltar vallas generando incidencias `fence_breach`.
  - **Comedor y clima (`dining.ts`)**: mesas picnic que se mojan bajo lluvia (y lluvia horizontal), secado por operarios (`dryStaff`) y comidas de pie.
- **Personal de asistencia, consultas cotidianas y orientación colectiva (`steward-system.ts`, `everyday-interactions.ts`, `crowd-guidance.ts`)**:
  - **12 consultas cotidianas sin emergencia** (aseos, horarios, guagua, objetos perdidos, Carpa Amarilla, reentrada) que ocupan tiempo real del auxiliar sin disparar alertas.
  - **5 falsas alarmas** que exigen desplazamiento y verificación física (`16–25 s`) antes de descartarse.
  - **Detección objetiva de congestiones** y **orientación colectiva de `1–10` personas** con respuesta humana variable (aceptar, seguir al grupo, dudar, pedir apoyo o rechazar) e **Inspector Rápido (`IncidentQuickInspector.tsx`)**.
- **Emergencias, Incendios, Vehículos y Análisis Histórico**:
  - **Flota de vehículos de emergencia estacionados (`vehicle-dispatch.ts`)** con 3 modos (`reserve`, `exterior_patrol`, `fixed_service`): solo arrancan cuando se despachan.
  - **Navegación sanitaria en 3 rutas (`stretcher-nav.ts`)**: Ruta A (vehículo a `stagingPoint`), Ruta B (sanitario a pie) y Ruta C (evacuación con camilla desplegada `2,00 × 0,65 m`), diagnosticando qué fase u obstáculo bloquea.
  - **Movilidad vehicular unificada (`vehicle-system.ts`)**: perfiles `ordinary`, `logistics`, `emergency`, red viaria exterior OSM + interior, bases exteriores y diagnóstico de obstáculos con alternativas.
  - **Generador contextual de incidencias (`contextual-incidents.ts` + `SimulationInspector.tsx`)**: al clicar cualquier pieza durante la simulación, ofrece solo incidentes físicamente coherentes (p. ej. fuga de gas solo si `hasGas`), inmediatos o programados, separando estadísticas `auto`, `manual` y `spread`.
  - **Propagación física multifoco de incendios y vallado post-incendio (`fire-model.ts`)**: 3 zonas geométricas (huella bloqueada, radio de combustión térmica y perímetro de seguridad), materiales no combustibles que nunca arden, cadenas causales de propagación, alertas de amenaza a Carpa Amarilla / Punto Violeta y ciclo post-incendio de 7 estados con operarios instalando vallado de cenizas.
  - **Centro de Análisis de Incidencias (`incident-center.ts`, `IncidentAnalysisPanel.tsx`)**: 8 categorías codificadas (`FUE`, `SAN`, `ACC`, `VIO`, `SEG`, `LOG`, `CON`, `INF`), 5 gravedades, reproductor histórico `T+00:00`, modo Foco/Contexto, comparador de respuesta alternativa y exportación JSON / CSV / PDF imprimible.
- **Simulación de jornada logística (`Pre` y `Post` — `shift.ts`)**:
  - Secuenciación progresiva anti-encierro (*far-to-near* en montaje, *near-to-far* en desmontaje), subtareas por tipología, escalonamiento determinista de camiones, exclusión de elementos `permanent` y vallas de fase `event` durante `pre`, tolerancia multi-muelle y balance de jornada (`ClosingDialog.tsx`).

---

## 4. Espacio `03 · Revisar` y Módulos de Gestión en Cabecera

- **Calculadora de servicios rediseñada en 4 pestañas (`DemandDialog.tsx`, `event-demand.ts`)**:
  - Tira fija de KPIs, modo Básico/Avanzado, sincronización bidireccional en vivo con el panel lateral, editor gráfico de barras horarias (`keep_total` / `update_total`), gestión segura con simulación en curso (`DemandChangeDialog.tsx`), balance Medio vs. Hora Punta contra lo instalado, propuestas accionables y gestión de variantes.
- **Monitor de experiencia y Diagnóstico post-simulación (`experience-monitor.ts`, `PostSimDiagnosticsView.tsx`)**: 7 categorías de fricción (`price`, `queue`, `blocked`, `exit`, `shelter`, `sound` en dB, `offer`), donut SVG de satisfacción, barras de causas y botón **«Última evaluación»**.
- **Asistente de corrección espacial inteligente (`SpatialAssistantPanel.tsx`, `spatial-assistant.ts`)**: Diagnóstico, propuesta geométrica en metros/grados, vista previa sobre plano y aplicación con `Ctrl+Z`.
- **Autoinforme del motor y Evaluación automática (`evaluator.ts`, `ComparisonDialog.tsx`)**: Ensayos comparativos de `15 min` con mutaciones candidatas, métricas de distanciamiento y minimapas SVG.
- **Laboratorio comparativo (`LaboratoryDialog.tsx`, `batch.ts`)**: Baterías de `3`, `6` o `10` diseños (`15/30/60 min`), lluvia opcional, inyección automática de emergencias y ranking exportable.
- **Programa por días (`ProgrammeDialog.tsx`) y Contactos (`ContactsDialog.tsx`)**: Actividades propias editables, asociación opcional de empresa/contacto (nunca forzada), prioridad a empresas guardadas, tipos personalizables («Otra…»), enlaces `mailto:` / WhatsApp y exportación CSV.
- **Empresas y recursos (`OrganizationsDialog.tsx`)** y **Ficha de producción (`ParametersDialog.tsx`)**: Gestión de adjudicatarias, cuadrillas, camiones, carretillas, 17+ parámetros operativos y cálculo de coste salarial de turnos.
- **Notas georreferenciadas, mediciones y exportación**: Exportación completa del proyecto (`Ojo_de_Buey_Proyecto.json`) y observaciones en CSV compatible con Excel (UTF-8 BOM, `;`, UTM).
