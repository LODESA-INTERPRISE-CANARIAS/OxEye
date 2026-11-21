# Especificaciones Técnicas y Funcionales — Ojo de Buey (OxEye)

> **Documento de Especificación v1.0**  
> **Propósito**: Definir con precisión todas las funcionalidades, modelos de datos, algoritmos de simulación, interfaces de usuario, diseño visual y arquitectura objetivo extraídos del prototipo monolítico `Ojo_de_Buey.html` (v0.16) para su transformación en una aplicación modular moderna.

---

## 1. Visión General y Contexto del Proyecto

**Ojo de Buey (OxEye)** —subtitulado *«Espacio para anticiparse · Laboratorio de eventos»*— es un entorno interactivo de planificación espacial, gestión logística por fases y simulación multi-agente en vivo para eventos públicos sobre cartografía georreferenciada.

### 1.1 Ámbito Geográfico Inicial
El proyecto está contextualizado en **San Cristóbal de La Laguna (Santa Cruz de Tenerife)** y opera sobre el sistema de referencia **UTM Zona 28N (`EPSG:32628`)**:
1. **Plaza del Cristo (`cristo`)** — *01 · PLAZA · CASCO HISTÓRICO*: Recinto principal activo del prototipo, preconfigurado con el escenario de estudio **«Navidad en el Cristo · mercado abierto»** (y variante base *«Noche abierta · Plaza del Cristo»*).
2. **Parque de la Constitución (`constitucion`)** — *02 · PARQUE · CAMINO LARGO*: Recinto secundario incluido en los datos cartográficos y de ortofoto (oculto inicialmente en la barra de pestañas mediante CSS hasta su activación).
3. **Parque de La Vega (`vega`)** — *03 · PARQUE · PEDRO GONZÁLEZ*: Tercer recinto incluido en el modelo de datos y ortofotos (también oculto inicialmente en la barra de pestañas mediante CSS).
4. **Soporte de compatibilidad (*Legacy*)**: Capacidad de importar y remapear escenarios antiguos de `cristo`, `vega` y `adelantado` (*Plaza del Adelantado*).

### 1.2 Principios Rectores del Producto
- **Un plano para conversar, un modelo para ensayar**: Combina la edición CAD/GIS ligera sobre plano con un motor de simulación peatonal, gastronómica, logística y de emergencias en tiempo real.
- **Transparencia metodológica**: Todos los cálculos advierten explícitamente qué datos son mediciones geométricas y cuáles son hipótesis editables pendientes de validación técnica municipal o de proveedores (referenciando el *PEMU de La Laguna 2011*, el *Plan de Autoprotección del Cristo 2021*, la *Directiva Europea 89/391/CEE art. 8* y el *Manual de buenas prácticas de montaje y desmontaje del INSST 2020*).
- **Accesibilidad y Lenguaje Claro (`plain-language`)**: Cada parámetro técnico cuenta con una traducción a preguntas comprensibles y un botón de ayuda contextual (`?`) con explicaciones y ejemplos prácticos.

---

## 2. Arquitectura Cartográfica y Sistema de Coordenadas

### 2.1 Extensión Cartográfica (`__OJO_DATA.maps`)
Cada recinto define su caja delimitadora (`bbox`: `[minE, minN, maxE, maxN]`) en metros UTM (`EPSG:32628`):

| Clave | Recinto | `bbox` (`EPSG:32628`) | Dimensiones | Resolución PNOA |
| :--- | :--- | :--- | :--- | :--- |
| `cristo` | Plaza del Cristo | `[371250, 3152300, 371750, 3152700]` | `500 × 400 m` | `0,20 m/px` (`2500 × 2000 px`) |
| `constitucion` | Parque de la Constitución | `[370990, 3152350, 371400, 3152760]` | `410 × 410 m` | `0,25 m/px` (`1640 × 1640 px`) |
| `vega` | Parque de La Vega | `[371260, 3152710, 371700, 3153080]` | `440 × 370 m` | `0,25 m/px` (`1760 × 1480 px`) |

### 2.2 Transformaciones Espaciales
- **Coordenadas de Escena (`percent`)**: Los elementos guardan su posición relativa `[x, y]` en porcentaje (`0` a `100`) respecto al ancho y alto del mapa del recinto para permitir remapeos (`remapPoint` / `remapScene`).
- **Coordenadas Locales en Metros (`world`)**:
  - `localX = (x / 100) * widthMeters` (metros hacia el Este desde `bbox[0]`).
  - `localY = (y / 100) * heightMeters` (metros hacia el Sur desde `bbox[3]`).
- **Coordenadas Absolutas UTM**:
  - `UTM_Este = bbox[0] + localX`
  - `UTM_Norte = bbox[3] - localY`
- **Sistema de Celdas Alfanuméricas (`cellAt`)**:
  - Columnas nombradas en base 26 (`A..Z`, `AA..ZZ`) según `Math.floor(localX / grid)` y filas `1..N` según `Math.floor(localY / grid) + 1` (ej. `CELDA R14`).

### 2.3 Capas del Lienzo SVG (`#drawing`)
El visor interactivo (`#map`) soporta desplazamiento (*pan* con puntero y flechas de teclado), zoom centrado en el cursor (`view.w` entre `35 m` y `900 m`), encuadre automático al perímetro (`fit`) y escala gráfica dinámica (`10 m`, `20 m` o `50 m`). Sus capas SVG ordenadas de fondo a frente son:
1. `#base-layer`:
   - **Modo Plano (`plan`)**: Renderizado vectorial de geometrías OpenStreetMap (`__OJO_DATA.carto.features`) filtradas al entorno del recinto: parques y zonas verdes (`#dbe4c9` / `#d2dfbe`), agua (`#b8d4d1`), canchas/pistas (`#d4dcc4`), viales según jerarquía (`highway`: peatonales, servicio, residenciales/secundarios con doble trazo de borde y relleno) y edificios (`#d7dccf`), más etiquetas de calles rotadas según el segmento más largo (para vías > 25 m).
   - **Modo Ortofoto (`ortho`)**: Imagen aérea PNOA-IGN georreferenciada (`__OJO_IMAGES[key]`) con inversión cromática de etiquetas (texto blanco con borde verde oscuro).
2. `#grid-layer`: Cuadrícula visual conmutable (`5 m`, `10 m`, `20 m`, `50 m`) con cabeceras de fila y columna dinámicas.
3. `#heat-layer`: Mapa de calor logarítmico en celdas de `3 × 3 m` para las lentes de *Flujos* y *Esperas* del Modo Director.
4. `#xray-layer`: Capa conmutable **«Rayos X»** (`xrayVisible`, controlada desde el panel Capas) para la estructura única de subsuelo por recinto (aparcamiento, sótano, etc.). Renderiza el perímetro booleano del subsuelo (máscara SVG secuencial `add`/`subtract`), columnas estructurales, muros de carga y un mapa de calor estructural semitransparente derivado en vivo (independiente de `#heat-layer`). Solo captura eventos de puntero cuando una herramienta de Rayos X está activa en el espacio *Diseñar*; en *Simular* puede visualizarse en modo solo lectura.
5. `#scenario-layer`: Perímetro discontinuo del ámbito de ensayo (`boundary`), zonas excluidas (`reserves`), recorridos peatonales propuestos (`flows`), vallas (`fences`), estructuras/puestos (`booths` e `infrastructure` con rotación, dimensiones reales, cruces de carpa y anillo de selección), accesos (`entrances`) y propuestas viales (`roadPlans`).
6. `#layout-preview`: Capa para previsualizaciones del autoconfigurador.
7. `#annotation-layer`: Marcadores numerados de observaciones del equipo (`annotations`) y polilíneas de medición con etiqueta de distancia planimétrica en metros (`measurements`).
8. `#draft-layer`: Polilínea interactiva en construcción al dibujar perímetros, zonas excluidas, recorridos, viales, mediciones o geometrías de subsuelo (con indicador visual de modo `+` / `−`).
9. `#shift-layer`: Animación esquemática de camiones, carretillas, bultos, reservas traseras de foodtrucks y cuadrillas durante los ensayos de montaje (`pre`) y desmontaje/limpieza (`post`).
10. `#dining-layer`: Indicadores sobre mesas picnic (ocupación `X/6` o estado `Mojada`) y agentes del personal de secado.
11. `#people-layer`: Agentes visitantes en tiempo real representados a escala física (radio `>= 0,45 m`), coloreados según su nivel de satisfacción actual.
12. `#response-layer`: Patrullas a pie (`Watch`), marcadores de incidentes activos/resueltos, conatos de incendio y animación de recursos de emergencia (equipos a pie, camillas, ambulancias, bomberos, coches policiales con luces estroboscópicas y trayectorias).

---

## 3. Flujo de Inicio: Menú Principal y Wizard (`game-menu.mjs`)

Al iniciar la aplicación (o pulsar **Menú** en la cabecera), se presenta una pantalla de portada a pantalla completa (`#game-menu`):
- **Acciones principales**:
  - **Continuar**: Retoma el proyecto activo guardado localmente.
  - **Cargar modelo**: Abre el selector de archivos `.json`.
  - **Crear nuevo modelo**: Lanza el asistente (*Wizard*) de 4 pasos.
  - **Ajustes**: Configura velocidad inicial de simulación (`1×` a `1200×`), reducción de efectos visuales (`reduce-motion`, que desactiva animaciones de lluvia y transiciones de luz) y aviso de guía inicial. Se persiste en `localStorage` bajo `ojo-prefs`.
  - **Créditos**: Autoría del prototipo (*Yeray López de Saja*), fuentes cartográficas (OSM ODbL y PNOA-IGN CC BY 4.0) y notas de alcance.
  - **Salir**: Pausa la simulación y ofrece exportar el proyecto `.json` antes de cerrar.
- **Asistente de Nuevo Modelo (*Wizard* en 4 pasos)**:
  1. **Ubicación y base**: Selección de *Plaza del Cristo*, nombre del modelo y opción *«Usar el ejemplo de Navidad como base»* (si se desmarca, crea el recinto limpio sin puestos ni vallas, manteniendo el perímetro y las reservas de edificios OSM).
  2. **Fechas y horario**: Fecha de inicio y fin (`1` a `30` días consecutivos) y hora de apertura y cierre diario (`1` a `12` horas enteras, admitiendo cierre tras la medianoche).
  3. **Carácter del evento**: Selección múltiple entre 6 objetivos (`Familias`, `Comercio local`, `Gastronomía`, `Cultura y talleres`, `Música`, `Descanso y accesibilidad`) acompañada de un **gráfico radar SVG** en vivo. Estos objetivos determinan la mezcla porcentual de arquetipos de visitantes (`mix`) y los pesos por defecto del Laboratorio comparativo.
  4. **Revisión y creación**: Resumen de la ficha, inicialización del escenario y apertura automática del diálogo **1. Inventario**.

---

## 4. Gestión por Fases Operativas (`phases.mjs`)

La barra de fases permite alternar la vista y el comportamiento del plano entre 4 estados:
1. **Pre-evento (`pre` · borde `#89561d`)**: Limpieza previa, acondicionamiento, logística de entrada de camiones, descarga con carretillas y montaje de estructuras. Oculta las capas de público y atmósfera.
2. **Evento (`event` · borde `#175e58`)**: Apertura al público, funcionamiento de la oferta comercial/gastronómica/escenarios, simulación de multitudes y emergencias.
3. **Postevento (`post` · borde `#77548d`)**: Limpieza entre jornadas (si el evento dura varios días) o desmontaje por lotes, carga en camiones y limpieza final.
4. **Compuesta (`all`)**: Muestra todos los elementos de todas las fases simultáneamente, coloreando el contorno de cada pieza según su fase principal y con trazo discontinuo si pertenece a múltiples fases. Incluye un **analizador geométrico de solapamientos (`comparePhases`)** que detecta intersecciones entre reservas logísticas y estructuras, distinguiendo cuántas coinciden en la misma fase (conflicto real) y cuántas son usos sucesivos en el tiempo (compatibles).

Cada elemento del plano posee la propiedad `phaseTags: Array<'pre' | 'event' | 'post'>`, editable desde el Inspector.

---

## 5. Los 3 Espacios de Trabajo (Barra Lateral y Herramientas)

### 5.1 Espacio 01: Diseñar (`design`)
- **Gestión de Escenario**: Edición del nombre de la propuesta y botón directo a **1. Inventario** con listado de piezas pendientes de ubicar (`pendingStock`) para colocarlas con un clic sobre el plano.
- **Autoconfigurador Espacial (`layout.mjs`)**:
  - Permite **reorganizar el montaje existente (`onlyMove`)** o **generar nuevas piezas** según 3 estrategias espaciales (o rotación automática entre ellas):
    - `0 · Patio central`: Agrupa o puntúa según distancia radial al centro.
    - `1 · Paseo longitudinal`: Organiza por franjas longitudinales según tipo de actividad (`food`, `rest`, `commerce`, `stage`).
    - `2 · Islas de actividad`: Agrupa por núcleos funcionales manteniendo siempre cada carpa (`cover`) unida a las mesas y puestos que cobija (`coverGroup`).
  - Opción *«Replantear ramales y vallas del ejemplo»*: Retira guías de cola y ramales secundarios predefinidos conservando el eje central y las salidas.
  - Parámetros ajustables: Elementos a añadir (`1–36`), Separación de diseño (`0,5–8 m`), Tamaño/escala (`0,5×–2×`), y prioridades de Comercio, Descanso y Refugio (`0–100`).
  - Flujo no destructivo: Genera una vista previa resaltando en verde (`#167869`) las piezas reubicadas, permite conmutar **Ver original / Ver alternativa**, **Aplicar propuesta** (con registro en historial Deshacer) o **Descartar**.
- **Catálogo de Piezas (`catalog`)**:
  - Límite de **150 elementos** por recinto.
  - **Oferta y mobiliario**:
    - `craft`: Comercio · artesanía (`4 × 3 m`, `#ddbd7d`)
    - `books`: Comercio · libros (`4 × 3 m`, `#ddbd7d`)
    - `local`: Comercio · producto local (`4 × 3 m`, `#ddbd7d`)
    - `commerce`: Puesto general (`4 × 3 m`, `#e8bc6d`)
    - `ventorrillo`: Ventorrillo (`4 × 3 m`, `#d4a56e`)
    - `food`: Foodtruck (`5 × 2,5 m`, `#df9a72`)
    - `workshop`: Taller (`6 × 4 m`, `#a1b7ac`)
    - `stage`: Escenario (`12 × 8 m`, `#9dabc4`)
    - `rest`: Descanso (`6 × 4 m`, `#b3c78f`)
    - `picnic`: Mesa picnic (`3 × 1,8 m`, `#bb9667`, 6 plazas por defecto)
    - `cover`: Carpa (`10 × 10 m`, `#bdd4c0`)
    - `toilet`: Aseos (`3 × 2 m`, `#aaaac0`)
    - `bin`: Contenedor (`1,5 × 1,2 m`, `#73916c`, visible en `pre`, `event`, `post`)
  - **Emergencias y seguridad (`role: 'emergency'`)**:
    - `medical`: Equipo sanitario (`6 × 4 m`, `#dd9c8b`)
    - `ambulance`: Ambulancia (`2,5 × 6 m`, `#cadde1`)
    - `fire`: Bomberos (`3 × 8 m`, `#cc8b75`)
    - `patrol`: Coche policial (`1,9 × 4,6 m`, `#6888b5`)
    - `security`: Policía a pie (`2 × 2 m`, `#a5b8ca`)
  - **Accesos**:
    - `gate`: Acceso (`4 × 1 m`, `#86ae88`, configurable como Entrada y salida, Solo entrada, Solo salida o Solo emergencias).
  - **Reservas logísticas (`role: 'logistics'`)**:
    - `cleaning`: Limpieza (`4 × 3 m`)
    - `prep`: Acondicionamiento (`5 × 4 m`)
    - `assembly`: Montaje (`6 × 4 m`)
    - `dismantle`: Desmontaje (`6 × 4 m`)
    - `turning`: Maniobra de vehículos (`10 × 8 m`)
    - `loading`: Carga y descarga (`8 × 4 m`)
    - `power`: Punto eléctrico (`1 × 1 m`, `#ebc44d`)
    - `storage`: Acopio temporal (`4 × 4 m`)
- **Trazados de Espacio y Recorridos**:
  - `boundary`: Redibujar el polígono del perímetro del evento (mínimo 3 puntos; `Mayús` en el primer clic añade área, `Ctrl` resta área, con indicador visual `+` / `−`).
  - `reserve`: Dibujar polígono de zona excluida al tránsito peatonal (mínimo 3 puntos).
  - `flow`: Trazar polilínea de paso peatonal propuesto (mínimo 2 puntos).
  - `road`: Trazar polilínea de propuesta vial de planificación (mínimo 2 puntos).
- **Subsuelo y Capa «Rayos X» (`Scene.subsoil` y `src/engine/subsoil/heat.ts`)**:
  - Estructura única opcional por recinto (posiciones en porcentaje `0–100`, dimensiones en metros), validada por `validateScene`, persistida en JSON/almacenamiento local y compatible hacia atrás con proyectos antiguos sin el campo.
  - **Perímetro del subsuelo (`xray:boundary`)**: Independiente del perímetro del evento. Se representa como una lista ordenada de polígonos `{id, op: 'add' | 'subtract', points}` evaluada secuencialmente (`pointInSubsoil` y `<mask>` SVG): clic normal sustituye, `Mayús` en el primer clic añade (`+`) y `Ctrl` resta (`−`), mostrando indicador visual del modo activo.
  - **Columnas (`xray:column`)**: Círculos sin rotación con `diameter` (m) y `influenceRadius` (m) editables en el Inspector y degradado radial de calor.
  - **Muros de carga (`xray:wall`)**: Segmentos `a → b` con grosor estructural visible (`thickness`, m), profundidad de influencia (`influenceDepth`, m), extremos arrastrables y rotación editable en el Inspector; su banda simétrica de calor sigue la orientación en vivo.
  - **Cálculo puro del calor (`structuralHeat` / `calor`) y control de riesgos de carga pesada**: Función pura en `src/engine/subsoil/heat.ts` que devuelve un valor normalizado en `[0, 1]` para cualquier punto en metros locales (no se persiste en JSON). Las piezas marcadas como carga pesada (`heavyLoad`, por defecto escenarios, foodtrucks, carpas, bomberos, ambulancias y zonas de carga/maniobra/acopio, con conmutador editable en el Inspector) se evalúan en su huella rotada mediante `evaluateHeavyLoadConflicts` dentro de `assessRisk`: al solapar una zona de calor de columna o muro de carga, generan un aviso en el Inspector y un riesgo (`critical` con intensidad `>= 25 %`, `warning` en el borde `> 0 %`) en el diálogo de Revisión de riesgos al pulsar *Play*.
- **Selección Múltiple, Portapapeles y Atajos de Teclado**:
  - Selección múltiple (`selectedIds`) mediante `Shift + clic` sobre cualquier elemento colocable del mapa (puestos, infraestructura, accesos, trazados, notas y elementos de subsuelo). Con varios elementos seleccionados, el Inspector muestra un resumen por tipo y acciones comunes.
  - Atajos globales (inactivos al escribir en inputs/textareas o en el espacio *Simular*): `Ctrl+C` / `Ctrl+V` (copia y pega con desplazamiento e IDs nuevos respetando el límite de 150 piezas del catálogo), `Supr` (elimina respetando `locked`) y `Ctrl+Z` / `Ctrl+Y` (deshacer / rehacer).
- **Inspector de Elementos (`#inspector`)**:
  - Permite editar nombre, posición exacta (`Este local`, `Sur local`) con visualización de celda y coordenadas UTM, anchura (`0,5–100 m`), fondo (`0,5–100 m`), rotación (`-360° a 360°`), precio (`€`), plazas simultáneas (`labCapacity`), tiempo de servicio (`labTime`), plazas de mesa picnic (`0–6`), nivel sonoro de escenario (`0–130 dB` a 5 m), dotación de emergencia (`staff`, `capacity`, `delay`, `handling`), dirección de acceso (`gate`), casilla de bloqueo para el autoconfigurador (`locked`) y fases de visibilidad (`phaseTags`).
  - Avisa mediante alerta visual si una pieza queda situada fuera del polígono del ámbito de ensayo (`!inside`).

### 5.2 Espacio 02: Simular (`simulate`)

#### A) Simulación de Evento Público (Fase `event`)
- **Motor Basado en Agentes (`EventEngine` en `event-lab-model.mjs`)**:
  - **Malla de Navegación**: Celdas de `0,75 × 0,75 m` (`buildGrid`). Descarta automáticamente zonas fuera del perímetro (salvo pasillos habilitados como el pasillo trasero del mercado), reservas/edificios OSM, huellas de puestos/mobiliario y vallas (con margen de seguridad según el diámetro peatonal de `0,6 m`).
  - **Campos de Flujo (`flow`)**: Búsqueda en anchura (BFS) sobre la malla para cada acceso, puesto, cola y punto de paso (`waypoints`), con caché LRU de hasta 96 campos.
  - **Población Sintética (`PERSONAS` en `crowd-personas.mjs` y `persona-demography.mjs`)**:
    - Catálogo determinista de **1.000 perfiles ficticios** cuyas cuotas marginales de edad y sexo siguen el padrón administrativo de San Cristóbal de La Laguna (`167.176` habitantes: `86.902` mujeres y `80.274` hombres en 11 tramos de edad), asignando nombre, apellidos canarios/españoles, barrio de residencia en La Laguna (Casco, San Benito, La Cuesta, Taco, Tejina, etc.), nivel de estudios, modo de transporte, presupuesto (`12, 24, 45, 80 €`), ritmo de marcha (`pace`), paciencia (`patience`), duración de estancia (`stayFactor`), espontaneidad y preferencia de refugio climático.
  - **Perfil Horario de Llegadas (`arrivalProfile`)**: Curva gaussiana asimétrica con pico al 65 % de la jornada, modulada por la exposición climática (`lluvia` reduce un 40 % la llegada expuesta; `viento` un 25 %).
  - **Ciclo de Vida del Agente**: Entrada por un acceso público (`spawn`) → asignación de objetivos según arquetipo (`buyer`, `foodie`, `culture`, `music`, `walker`) → desplazamiento con evasión local de colisiones (`clearAt` con hash espacial) → espera en cola (`queue`) → atención en ranuras del puesto (`serviceWalk` / `service`) → si compra comida, pasa al subsistema de comedor (`Dining`) → paseo (`roam`) o salida (`exit` / `depart`).
- **Subsistema de Comedor y Clima (`Dining` en `event-dining.mjs`)**:
  - Gestiona las mesas de picnic y sus asientos libres.
  - Si llueve (`weather === 'rain'`), las mesas descubiertas se mojan en `45 s` (y las cubiertas en `240 s` si está activa la opción de *lluvia horizontal*). Cuando `wet >= 0.25`, la mesa queda inutilizable hasta que un operario del **personal de secado (`dryStaff`)** camina hasta ella y trabaja durante `drySeconds` (`45 s` por defecto).
  - Si un visitante con comida busca asiento durante más de `seatWaitMin` (`3 min` por defecto) sin encontrar plaza seca, consume su comida de pie (`mealStanding`) y registra una incidencia de confort.
- **Modo Director en Vivo (`director.mjs`)**:
  - **Controles en tiempo real** (se registran en `replayLog` para reproducibilidad al mover la línea temporal):
    - **Clima en vivo**: *Sol* (`☀`), *Nubes* (`☁`), *Lluvia* (`☂`), *Viento* (`≋`) con superposición visual animada (`#atmosphere`).
    - **Luz de escena**: Control deslizante de `6:00` a `23:00` que ajusta la opacidad nocturna y solar con modos de fusión CSS.
    - **Vista Inmersiva (`⛶`)**: Oculta cabecera, barra lateral y pie de página para maximizar el mapa a pantalla completa.
    - **Lentes de lectura de multitud**:
      1. *Personas*: Muestra cada asistente coloreado por satisfacción (`#b5e48c` Satisfecho `>=70`, `#eed777` Neutral `40–69`, `#e56b64` Descontento `<40`).
      2. *Flujos*: Mapa de calor de tránsito acumulado (`engine.trails`).
      3. *Esperas*: Mapa de calor de retenciones y colas (`engine.stalls`).
    - **Provocación y Simulación de Incidencias (`ResponseSimulation` + `Watch`)**:
      - Modos configurables: Respuesta sanitaria (*Atención en el lugar · equipo a pie*, *Camilla hasta una ambulancia*, *Ambulancia hasta la incidencia*), Policía (*Equipo a pie* o *Coche policial*) y probabilidad de éxito del extintor (`fireSuccess %`, por defecto `85 %`).
      - 4 botones de disparo en vivo: **⊕ Caída** (`fall`), **♨ Cocina / Incendio** (`fire`), **✚ Corte** (`cut`), **! Conflicto** (`conflict`).
      - **Detección y aviso (`Watch`)**: Un incidente nace como `unreported` hasta que visitantes cercanos (`<= 12 m`), patrullas a pie (`<= 16 m`) o el responsable del puesto dan la voz de alarma, calculando la demora de aviso (`reportDelay`).
      - **Primera intervención en incendio**: Si el puesto cuenta con personal formado (`trained === true`), el responsable sale del puesto e intenta extinguir el conato durante `12 s` antes de escalar a bomberos.
      - **Rutas y cinemática de emergencia (`responseRoute` + `vehiclePath`)**: Comprueba si existe un acceso de emergencia con anchura suficiente (`width + 0,3 m`), calcula un corredor libre para la huella del recurso, suaviza los giros según el radio de curvatura vehicular (`Math.max(3, length * 0.8)`), solicita a los peatones que cedan el paso lateralmente (`yieldForPriority`) y ejecuta la fase de traslado (`transfer`) en camilla o ambulancia hasta la entrega (`handover`).

#### B) Simulación de Jornada Logística (Fases `pre` y `post` — `shift.mjs`)
- En las fases `Pre-evento` y `Postevento`, el simulador modela el turno de trabajo (hasta `8 h` configurables):
  - En `Postevento` de eventos de varios días, permite elegir entre **Limpieza entre jornadas** (tras el día $1 \dots N-1$) o **Último día · desmontaje**.
  - Simula paso a paso:
    1. Recorridos del personal de limpieza recogiendo residuos generados por cada estructura (`wasteLitres`), llenando bolsas hasta `bagLitres` (`60 L`) y caminando al contenedor (`bin`) más cercano para vaciarlas (`15 s`).
    2. Entrada de camiones por el acceso hacia la reserva de maniobra (`turning`), aparcamiento (`parkMin`) en la zona de carga (`loading`), descarga/carga de lotes (`truckBatch`) con carretillas elevadoras (`forks`) y montaje/desmontaje por cuadrillas (`Montadores`) según la empresa adjudicataria de cada lote (`allocate`).
  - Al terminar el turno (o pulsar cierre), muestra el diálogo **Balance de jornada (`#closing`)** con tareas completadas vs. pendientes y permite añadir otra jornada conservando el avance (`progressByPhase`).

### 5.3 Espacio 03: Revisar (`review`)
- **Monitor Automático de Experiencia (`ExperienceMonitor` + `analyze` en `experience.mjs`)**:
  - Evalúa cada `5 s` simulados a todos los asistentes activos para detectar 7 categorías de fricción (`TOPICS`):
    - `price`: El precio del puesto supera el presupuesto restante del visitante.
    - `queue`: La espera en cola supera el 50 % de su tolerancia (o `120 s`).
    - `blocked`: El visitante lleva más de `15 s` retenido sin poder avanzar.
    - `exit`: El visitante quiere salir pero no encuentra una salida pública conectada (`trapped`).
    - `shelter`: Llueve y el visitante lleva `>= 30 s` expuesto sin plaza bajo cubierta.
    - `sound`: Nivel de presión sonora estimado en campo libre ($L = \text{SPL}_{5\text{m}} - 20 \log_{10}(d / 5)$) supera el umbral de confort (`78 dB` general, `88 dB` para perfil música) durante `>= 30 s`.
    - `offer`: El visitante no encuentra ningún puesto abierto de la categoría que busca.
  - Agrupa los problemas por prioridad y propone **acciones correctivas**, incluyendo candidatos geométricos automáticos (`moveCandidate`) que buscan desplazar un puesto conflictivo `2, 4 o 6 m` en 8 rumbos cardinales sin colisionar con el perímetro, reservas, vallas ni accesos.
  - Permite descargar el informe completo en JSON (`Informe_de_visitantes.json`).
- **Autoinforme del Motor (`compareMaps` en `evaluator.mjs`)**:
  - Ejecuta en segundo plano un ensayo de `15 min` del mapa actual (`before`) y calcula una puntuación de fallos:
    $$\text{Puntuación} = \text{Episodios} + 2 \times \text{Abandonos} + 3 \times \text{Entradas Bloqueadas}$$
  - Genera mutaciones candidatas (reducir precio un 15 %, añadir 1 plaza de atención simultánea, reubicar pieza bloqueante o bajar 3 dB el escenario), las ordena según el aprendizaje histórico del recinto (`s.learning`), simula las 2 mejores alternativas durante `15 min` con la misma semilla y presenta una comparativa lado a lado con minimapas SVG para conservar el original o adoptar la mejora con un clic.
- **Notas del Equipo y Mediciones**:
  - Creación y edición de observaciones georreferenciadas (`⊕ Añadir observación`) vinculadas a la celda y tamaño de malla activos.
  - Herramienta de polilínea para medir distancias planimétricas (`↔ Medir sobre el plano`).
  - Exportación de todas las observaciones de los 3 espacios a un archivo **CSV compatible con Excel (`Ojo_de_Buey_Observaciones.csv`)** con codificación UTF-8 BOM, separador `;`, protección contra inyección de fórmulas CSV y coordenadas UTM Este/Norte exactas.

---

## 6. Módulos de Gestión en Cabecera (Diálogos Modales)

1. **Calcular servicios (`demand.ts` — `#demand-dialog`) y Programa por días (`programme.ts` — `#programme-dialog`)**:
   - *Calcular servicios*: Calcula una primera dotación recomendada a partir de 17 variables de entrada (llegadas/h, superficie disponible, estancia media, % compra comida, servicios/h por puesto, % utilización objetivo, % comidas sentadas, duración mínima y máxima de comida, mesas por carpa, % visita comercios, minutos por compra, clientes simultáneos por comercio, % uso de baños, minutos por uso de baño, % menores y % mayores). Devuelve puestos de comida, mesas de 6 plazas, carpas necesarias, comercios, cabinas de baño, plazas para menores/mayores, ocupación simultánea media, huella estimada de módulos ($\text{comida}\times 20 + \text{mesas}\times 5.4 + \text{comercios}\times 12 + \text{baños}\times 2.5\text{ m}^2$) y superficie restante, junto con referencias de colaboradores locales (*Lífer*, *Palmelita*, *Mercado de La Laguna*).
   - *Programa por días*: Permite planificar sesiones multi-día ajustadas a presupuesto, reserva, horario y recursos disponibles (`roof`, `stage`, `tables`, `power`, `open`). Además del catálogo base, el usuario puede **crear, editar y eliminar actividades propias** (`scene.customActivities`, mostradas primero con marca visual `Propia`, con categoría personalizable mediante «Otra…», reutilizando `activityPrices` y `programmeOptions.selected`). Cada actividad puede asociarse opcionalmente a una **Empresa / contacto** (`scene.activityContacts` y `ScheduledSession.contactId`, nunca asignada automáticamente por el motor), incluyendo creación rápida de contactos en línea sin perder cambios sin guardar. La empresa asociada se refleja en la propuesta, en el programa guardado (`scene.programme`) y en la exportación CSV (columna `Empresa`). En **Proveedores para consultar**, aparecen primero **Tus contactos guardados** (con sus actividades asociadas y acciones compartidas de correo/WhatsApp) y después los **Sugeridos** con botón **Guardar como contacto**.
2. **1. Inventario (`inventory.mjs` — `#inventory-dialog`)**:
   - Permite definir las cantidades totales (`0–150`) de las 27 categorías del catálogo mediante botones `−` / `+` o entrada numérica.
   - Protege las piezas que tengan activada la casilla *«Fijar posición» (`locked`)* impidiendo bajar la cantidad por debajo de las piezas fijadas.
   - Ofrece dos modos de inserción para las piezas añadidas: **Colocar yo las piezas** (pasan a `pendingStock` en la barra lateral) o **Proponer distribución** (ejecuta `arrangeStock` colocando mesas bajo carpas libres y respetando corredores, seguido de `redesign`, mostrando una vista previa en minimapa antes de confirmar).
3. **Comparar diseños / Laboratorio (`batch.mjs` — `#laboratory-dialog`)**:
   - Permite ponderar con controles deslizantes (`0–100`) 4 metas de evaluación:
     - `comfort`: Comer sentado y con refugio
     - `queues`: Esperas y accesos fluidos
     - `emergency`: Atender incidencias
     - `experience`: Variedad y satisfacción
   - Incluye un campo de texto libre para registrar los **Deseos de la ciudadanía (`citizenWishes`)**.
   - Permite lanzar una batería asíncrona de **3, 6 o 10 configuraciones** durante **15, 30 o 60 minutos simulados**, con opción de repetir cada diseño bajo lluvia e inyectando automáticamente los 4 tipos de emergencia (`fall`, `cut`, `fire`, `conflict`) a los `120, 210, 300 y 390 s`.
   - Muestra el avance en vivo en un minimapa SVG, genera un ranking ordenado por puntuación global (`0–100`), destaca el punto fuerte y el margen de mejora de cada alternativa, permite **Exportar ranking (`Ranking_Ojo_de_Buey.json`)** o **Usar esta configuración** directamente en el proyecto.
4. **Contactos (`#contacts-dialog` y `src/engine/planning/contacts.ts`)**:
   - Gestión de directorio de proveedores con `id` estable (`crypto.randomUUID()`, con migración automática al abrir proyectos antiguos sin `id`) y campos *Nombre o empresa*, *Actividad*, *Email* y *WhatsApp con prefijo internacional*.
   - El selector *Actividad* conserva las 5 opciones base (*Foodtruck*, *Ventorrillo*, *Taller*, *Comercio*, *Montaje*) y añade **Otra…** para crear tipos personalizados persistidos en `scene.contactKinds` (validando no vacíos ni duplicados sin distinguir mayúsculas).
   - Comparte con *Programa por días* la generación de enlaces **Preparar correo (`mailto:`)** y **Preparar WhatsApp (`https://wa.me/...`)** con mensaje contextualizado. Al eliminar un contacto por `id`, las actividades y sesiones asociadas quedan limpiamente «sin empresa» sin romper el programa guardado.
5. **Empresas y recursos (`companies.mjs` — `#org`)**:
   - Permite gestionar las empresas adjudicatarias (por defecto *Equipo municipal* para carpas y *Empresa de producción* para el resto), su persona responsable, el alcance de su lote (`Carpas`, `Puestos y actividades`, `Cualquier lote`) y sus recursos tanto en **Pre-evento** como en **Postevento** (*Montadores*, *Camiones*, *Carretillas*), además de las dotaciones de **Control de aforo** y **Seguridad privada**.
6. **Ficha de producción (`#parameters`)**:
   - Configura los 17 parámetros operativos y presupuestarios del evento: tiempos de comida (`mealMin`, `mealMax`, `seatWaitMin`), personal y tiempo de secado de mesas (`dryStaff`, `drySeconds`), días de evento (`eventDays`), tiempos de camión y tamaño de lote (`parkMin`, `truckBatch`), gestión de residuos (`bagLitres`, `wasteLitres`, `cleanMin`), costes y turnos de personal (`teamSize`, `rate` €/h, `burden` %, `hoursLimit` h, `setupMin`, `strikeMin`), fuente documental de las tarifas (`estimateSource`), casilla de **Lluvia horizontal** (`horizontalRain`) y casilla de **Personal formado para primera intervención** (`trained`).
   - Calcula y muestra en tiempo real la duración estimada en horas y el coste salarial de los turnos de Pre-evento y Postevento.
7. **Abrir / Exportar Proyecto y Ayuda (`#import`, `#export`, `#info`)**:
   - Exporta e importa el proyecto completo (`Ojo_de_Buey_Proyecto.json`, hasta 5 MB) validando integridad geométrica y de rangos (`validateScene`), con soporte de migración automática para escenarios heredados.
   - Modal informativo (`?` / `Fuentes y precisión ↗`) con notas metodológicas, enlaces a PEMU y SUC Canarias, y descarga directa de `Ojo_de_Buey_Fuentes.json`.

---

## 7. Identidad Visual y Especificaciones de Estilo

El diseño visual tiene una personalidad editorial y cartográfica muy marcada que debe conservarse íntegramente:

### 7.1 Paleta de Colores Principal
- **Cabecera, Rail y Menú Principal**: Verde petróleo profundo `#162829` (y `#153e38`), texto crema `#f4eddb` / `#f2e8d6`, borde dorado envejecido `#ae8d55`, botones de acción principales en dorado arena `#e0c99c` / `#cfb57d` con texto oscuro `#172a2b`.
- **Superficies de Trabajo (Sidebar, Barras, Diálogos)**: Papel cálido `#faf7ee` / `#fffcf4`, fondo general `#f4f0e7`, líneas divisorias `#dfe3d8` / `#d4cbb8`, acento lima `#e1ed9f`.
- ** Fases Operativas**: Pre-evento `#89561d` (ocre), Evento `#175e58` (verde azulado), Postevento `#77548d` (púrpura).
- **Semáforo de Satisfacción Peatonal**: Satisfecho `#b5e48c` (leyenda `#31572c`), Neutral `#eed777` (leyenda `#836718`), Descontento `#e56b64` (leyenda `#aa3734`).

### 7.2 Tipografía
- **Títulos editoriales (`h1` de barra lateral, `h2` de diálogos, marca y menú principal)**: `Georgia, 'Times New Roman', serif`, peso normal, `letter-spacing: -0.035em`.
- **Interfaz técnica, controles, métricas y tablas**: `Inter, Arial, sans-serif`, con números tabulares (`font-variant-numeric: tabular-nums`) en relojes y contadores en vivo.

### 7.3 Adaptabilidad (Responsive & Immersive)
- **Puntos de ruptura (`@media`)**:
  - `min-width: 1600px`: Sidebar ampliado a `310px`, cabecera de `90px`.
  - `max-width: 1200px`: Compactación de paddings y ocultación de subtítulos secundarios en cabecera.
  - `max-width: 850px`: Layout flexible adaptativo para tablets.
  - `max-width: 640px`: El rail de navegación pasa a ser una barra superior horizontal `sticky` y el sidebar se sitúa sobre el mapa.
- **Modo Inmersivo (`body.immersive`)**: Oculta `.header`, `.rail`, `.sidebar` y `.source-bar` para dedicar el 100 % del alto (`100dvh`) al área del mapa y la barra de simulación.

---

## 8. Stack Tecnológico y Arquitectura del Nuevo Proyecto

Para transformar el prototipo en una aplicación mantenible, escalable y preparada para su futura conversión en **Desktop App**, se empleará el siguiente stack:

### 8.1 Tecnologías Seleccionadas
- **Framework UI y Lenguaje**: **React 18+ con TypeScript** estricto.
- **Bundler y Entorno de Desarrollo**: **Vite**.
- **Gestión de Estado**: **Zustand** (estado de proyecto, escenas, herramientas y UI desacoplado de la referencia mutable de alta frecuencia del motor `EventEngine` para garantizar 60 FPS en el lienzo SVG).
- **Persistencia y Base de Datos**:
  - **Capa de Repositorio (`StorageRepository`)** con esquema relacional tipado mediante **Drizzle ORM + SQLite (WASM/OPFS en navegador o SQLite nativo en Desktop)** y soporte de **IndexedDB (Dexie.js)** / `localStorage` como fallback inmediato, manteniendo además la compatibilidad 100 % con la importación/exportación de archivos `Ojo_de_Buey_Proyecto.json` y `.csv`.
- **Calidad de Código y Estilo**: **ESLint** configurado con la **Guía de Estilo de TypeScript de Google (`gts`)** + **Prettier**.
- **Documentación de Código**: **TypeDoc** para generar documentación automática de todos los módulos del motor, modelos geométricos y componentes.
- **Testing**:
  - **Playwright**: Pruebas End-to-End (E2E) de los flujos de usuario (menú/wizard, colocación de piezas en el plano, ejecución de simulación, diálogos de inventario/demanda/laboratorio y exportación).
  - **Vitest**: Pruebas unitarias rápidas para las funciones puras del motor (`demandPlan`, `reconcile`, `shift`, transformaciones UTM, colisiones geométricas).

### 8.2 Estructura de Directorios Propuesta

```text
OxEye/
├── public/
│   └── assets/                  # Ortofotos PNOA (cristo, constitucion, vega) y fuentes estáticas
├── src/
│   ├── assets/                  # Iconos SVG y recursos gráficos
│   ├── components/              # Componentes React de UI desacoplados
│   │   ├── header/              # Header, barra de acciones y estado de guardado
│   │   ├── layout/              # Rail lateral, Sidebar, Barra de fases, Footer de fuentes
│   │   ├── map/                 # MapShell, capas SVG, controles de zoom/herramientas, Inspector, DirectorHUD
│   │   ├── simulation/          # SimulationStrip, controles de línea temporal y métricas en vivo
│   │   ├── modals/              # DemandDialog, InventoryDialog, LaboratoryDialog, ContactsDialog, OrgDialog, SettingsDialog, InfoDialog, ClosingDialog, ComparisonDialog
│   │   ├── menu/                # GameMenu y Wizard de 4 pasos
│   │   └── common/              # ExplainPopup (Lenguaje claro), Toast, controles reutilizables
│   ├── engine/                  # Motor matemático, geométrico y de simulación en TypeScript puro (documentado con TypeDoc)
│   │   ├── cartography/         # Transformaciones UTM EPSG:32628, celdas, mallas y datos OSM
│   │   ├── crowd/               # EventEngine, campos BFS, 1.000 PERSONAS y demografía de La Laguna
│   │   ├── dining/              # Subsistema de comedor, mesas picnic, lluvia y secado
│   │   ├── emergency/           # ResponseSimulation, patrullas Watch, trayectorias vehiculares y cesión de paso
│   │   ├── logistics/           # Simulación de turnos Pre/Post-evento (shift), camiones, carretillas y limpieza
│   │   ├── planning/            # Demand, Inventory, Layout (autoconfigurador), Batch (laboratorio) y Evaluator (autoinforme)
│   │   └── experience/          # ExperienceMonitor, cálculo de nivel sonoro dB y recomendaciones
│   ├── data/                    # Presets (Navidad en el Cristo, Noche abierta), catálogo de piezas y cartografía base
│   ├── db/                      # Esquema Drizzle/SQLite y adaptadores de persistencia local/exportación
│   ├── store/                   # Stores de Zustand (useProjectStore, useUIStore, useSimulationStore)
│   ├── styles/                  # Hojas de estilo CSS modulares manteniendo el diseño original exacto
│   ├── types/                   # Interfaces y tipos globales de TypeScript
│   ├── App.tsx                  # Componente raíz
│   └── main.tsx                 # Punto de entrada de la aplicación
├── tests/
│   ├── e2e/                     # Tests End-to-End con Playwright
│   └── unit/                    # Tests unitarios del motor con Vitest
├── eslint.config.js             # Configuración ESLint (Google TS Style Guide)
├── playwright.config.ts         # Configuración de Playwright
├── typedoc.json                 # Configuración de TypeDoc
├── vite.config.ts               # Configuración de Vite
├── tsconfig.json                # Configuración estricta de TypeScript
└── package.json
```
