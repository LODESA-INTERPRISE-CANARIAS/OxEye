# 01 · Visión, Dominio y Glosario — Ojo de Buey (OxEye)

## 1. Identidad del producto

- **Nombre**: **Ojo de Buey (OxEye)**
- **Lema**: *«Espacio para anticiparse · Laboratorio de eventos»* — *«Un plano para conversar, un modelo para ensayar»*.
- **Organización / Repositorio**: `LODESA-INTERPRISE-CANARIAS/OxEye`
- **Origen**: Evolución modular profesional a partir del prototipo monolítico inicial e idea de *Yeray López de Saja* (`Ojo_de_Buey.html`).
- **Propósito**: Entorno interactivo de **planificación espacial**, **gestión logística por fases** y **simulación multi-agente en vivo** para eventos públicos sobre cartografía georreferenciada real.

## 2. Qué problema resuelve

Organizar un evento en el espacio público suele obligar a decidir a ciegas entre planos estáticos, hojas de cálculo aisladas e intuición. OxEye permite **anticipar fricciones antes del montaje**:

1. **Un plano para conversar**: Equipos municipales, producción, seguridad y ciudadanía visualizan sobre el terreno real dónde va cada carpa, puesto, acceso, valla, subsuelo o reserva logística.
2. **Un modelo para ensayar**: Simula en tiempo real cómo se mueven los asistentes, dónde se forman colas o congestiones, cómo afecta la lluvia o el viento, cómo se propaga un incendio, cuánto tarda una ambulancia o camilla en evacuar, y cuántas horas y operarios exige el montaje y desmontaje.
3. **Transparencia metodológica y lenguaje claro**: Distingue siempre entre **mediciones geométricas exactas** e **hipótesis editables**, e incorpora explicaciones contextuales (`?`) en lenguaje claro para perfiles no técnicos.

## 3. Ámbito geográfico y cartográfico

Contextualizado inicialmente en **San Cristóbal de La Laguna (Santa Cruz de Tenerife)** bajo el sistema de referencia **UTM Zona 28N (`EPSG:32628`)**, con soporte adicional para **cualquier ubicación personalizada del mundo** mediante buscador Nominatim + extracción vectorial Overpass (OpenStreetMap) + ortofotos de alta resolución (**PNOA–IGN** `z19–z20` en España/Canarias y **Esri World Imagery** en el resto del mundo).

### Recintos preconfigurados

| Clave | Recinto | `bbox` (`EPSG:32628`) | Dimensiones | Resolución PNOA |
| :--- | :--- | :--- | :--- | :--- |
| `cristo` | **Plaza del Cristo** *(Casco Histórico · principal)* | `[371250, 3152300, 371750, 3152700]` | `500 × 400 m` | `0,20 m/px` |
| `constitucion` | **Parque de la Constitución** *(Camino Largo)* | `[370990, 3152350, 371400, 3152760]` | `410 × 410 m` | `0,25 m/px` |
| `vega` | **Parque de La Vega** *(Pedro González)* | `[371260, 3152710, 371700, 3153080]` | `440 × 370 m` | `0,25 m/px` |

- **Población sintética base**: Catálogo determinista de **1.000 perfiles ficticios** calibrados al padrón de San Cristóbal de La Laguna (`167.176` habitantes: `86.902` mujeres y `80.274` hombres en 11 tramos de edad), con barrios reales locales, presupuesto, ritmo, paciencia y preferencias.
- **Tiempos de respuesta externos de referencia (Tenerife)**: Detección y aviso 1-1-2 (`45 s`), Bomberos de Tenerife (`7 min` / `420 s`), Policía Local/Nacional (`6 min` / `360 s`), SUC / Ambulancia 1-1-2 Canarias (`8 min` / `480 s`), todos editables por proyecto.

## 4. Marco técnico y normativo de referencia

Los parámetros orientativos del simulador se apoyan en:
- **PEMU de La Laguna (2011)** (Plan de Emergencias Municipal).
- **Plan de Autoprotección de la Plaza del Cristo (2021)**.
- **Directiva Europea 89/391/CEE (art. 8)** (primeros auxilios, lucha contra incendios y evacuación).
- **Manual de buenas prácticas de montaje y desmontaje del INSST (2020)**.
- **Fuentes cartográficas**: OpenStreetMap (ODbL) y PNOA–IGN (CC BY 4.0).

## 5. Identidad visual y paletas

Estética editorial/cartográfica (`Georgia` para títulos editoriales + `Inter` con números tabulares para interfaz técnica). Soporta **6 paletas oficiales** seleccionables en vivo (con logotipo y favicon SVG reactivos al color de la paleta):

| ID | Nombre | Modo | Carácter |
| :--- | :--- | :---: | :--- |
| `oxeye` | **Ox Eye** *(por defecto)* | Claro | Púrpura editorial profundo y lavanda suave. |
| `atlas` | **Atlas** | Claro | Cartografía técnica azul petróleo y cian oceánico. |
| `noctis` | **Noctis** | Oscuro | Modo oscuro de alto contraste para análisis nocturno. |
| `territorio` | **Territorio** | Claro | Papel cálido, verde bosque y ocre topográfico clásico. |
| `vector` | **Vector** | Claro | Gris pizarra CAD con acento terracota industrial. |
| `bendy` | **Bendy** | Claro | Alto contraste personalizado (cian eléctrico y amarillo intenso). |

## 6. Glosario oficial del dominio

- **Espacios de trabajo (Rail lateral)**: `01 · Diseñar` (`design`), `02 · Simular` (`simulate`), `03 · Revisar` (`review`).
- **Fases operativas (Barra superior)**:
  - `Pre-evento` (`pre`, ocre `#89561d`): limpieza previa, acceso de camiones, descarga con carretillas y montaje progresivo.
  - `Evento` (`event`, verde azulado `#175e58`): apertura al público, comercio, gastronomía, multitudes, clima y emergencias.
  - `Postevento` (`post`, púrpura `#77548d`): limpieza entre jornadas o desmontaje inverso, residuos y retirada.
  - `Compuesta` (`all`): superposición de fases con detector geométrico de solapamientos (conflictos reales vs. usos sucesivos compatibles).
  - `Solo subsuelo` (`subsoilOnly`): vista limpia de la capa Rayos X sin mobiliario de superficie.
- **Capa «Rayos X» (Subsuelo)**: Estructura subterránea opcional por recinto (garaje/sótano) con perímetro booleano (`add`/`subtract`), columnas, muros de carga, muros perimetrales automáticos y mapa de calor estructural para validar piezas de carga pesada.
- **Lastre / Contrapeso (`ballast`)**: Elemento de sujeción con masa (`kg`), superficie de apoyo (`m²`) y carga superficial (`kg/m²`). Al superar `500 kg/m²` activa automáticamente el aviso orientativo de `heavyLoad`.
- **Rebeldes (`rebelShare`)**: Fracción determinista de asistentes (`1 %` por defecto) que intenta saltar vallas bloqueantes generando incidencias `fence_breach`.
- **Watch**: Subsistema de detección temprana y patrullas policiales a pie (móviles o en puesto fijo `fixedPost`).
- **Steward (`StewardSystem`)**: Personal de asistencia y orientación al público; atiende consultas cotidianas sin emergencia, verifica falsas alarmas y orienta grupos de `1–10` personas en congestiones.
- **Carpa Amarilla (`yellow_tent`)**: Punto especializado de accesibilidad, descanso adaptado, apoyo cognitivo/sensorial y acompañamiento.
- **Punto Violeta (`violet_point`)**: Espacio seguro de información y atención confidencial ante agresiones sexistas, sujeto a **protocolo estricto de privacidad** (`sensitive: true`, anonimizado en vista pública).
- **Rutas sanitarias A / B / C**: Separación de intervención médica en **Ruta A** (aproximación vehicular hasta `stagingPoint`), **Ruta B** (sanitarios a pie hasta víctima) y **Ruta C** (evacuación con camilla desplegada `2,00 × 0,65 m`).
- **Objetivos SMART (`ProjectObjectives`)**: Catálogo estructurado de 40 objetivos calculables en 10 categorías con prioridades, compromisos (*tradeoffs*) e hipótesis explícitas confirmables.
- **Fuente única de demanda (`EventDemandConfig`)**: Modelo canónico sincronizado bidireccionalmente entre la Calculadora de servicios y el panel de simulación (asistentes únicos, curva horaria, permanencia, aforo autorizado y variantes).
