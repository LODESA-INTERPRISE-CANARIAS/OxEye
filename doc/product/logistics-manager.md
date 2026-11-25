# Gestor logístico de OxEye: visión de producto

> Documento de dirección de producto. Es la fuente de verdad sobre la intención del módulo: el equipo técnico lo lee antes de diseñar y propone cambios aquí en lugar de apartarse en silencio.
>
> Referencias de diseño (concepto, no implementado): [Especificación para el equipo](../logistic/OxEye_Operaciones_Especificacion_Equipo_A4.pdf) y [Workflow visual](../logistic/OxEye_Operaciones_Workflow_Visual_A4.pdf).

## 1. Qué es y para qué

Una nueva sección de gestión operativa dentro de OxEye, independiente pero conectada con el simulador, para administrar eventos desde su planificación inicial hasta su ejecución y cierre. Se abre desde el menú principal de OxEye como una ventana propia, una pausa de la simulación centrada solo en la logística: qué tiene que llegar, cuándo, de quién, quién lo instala y si está hecho.

## 2. El primer uso real: la jornada con Elvis

El miércoles 2 de diciembre de 2026 acompañaremos a Elvis, responsable de la gestión de eventos, durante una jornada real, para observar qué decisiones toma, qué información necesita, cómo coordina a las empresas, qué incidencias surgen y qué herramientas utiliza.

No es un piloto completo de OxEye. El objetivo es entender sus necesidades y demostrarle que estamos construyendo una herramienta capaz de facilitarle el trabajo. Llevaremos una aplicación funcional en el móvil para registrar, consultar y relacionar información a medida que la obtengamos, sin interrumpir su actividad.

La finalidad de esta primera versión no es desarrollar todas las posibilidades de una plataforma de gestión municipal, sino demostrar su utilidad de manera inmediata: en una sola jornada, registrar información real, organizarla sin esfuerzo, consultarla rápidamente y usarla para responder preguntas o anticipar problemas. A partir de esa experiencia priorizaremos las siguientes funciones con criterios basados en necesidades reales y no solo en nuestras hipótesis de diseño.

## 3. Una sola base de información, cinco espacios

La aplicación se organiza alrededor de una misma base de información, con cinco espacios principales: **calendario**, **inventarios**, **contactos**, **catálogo de proveedores** y **seguimiento operativo**.

Cada dato se registra una vez y se reutiliza: la organización (por ejemplo, el Ayuntamiento de La Laguna) aporta sus recursos, contactos y datos generales a todos sus eventos, y cada evento conserva sus propias necesidades, horarios, contrataciones y responsabilidades. Así evitamos duplicar información y podemos detectar coincidencias o conflictos entre actividades.

### 3.1 Calendario

Crear un evento con lo que se sepa en ese momento (por ejemplo, «Navidad en la Plaza del Cristo», con fecha, franja horaria y vinculado al Ayuntamiento de La Laguna) y completarlo después. Si ese mismo día hay otra actividad en la Plaza del Adelantado, registrarla al momento, ver ambos eventos en el calendario y asociarlos a la misma organización.

### 3.2 Inventarios

Crear la ficha de un almacén (por ejemplo, uno municipal), indicar su ubicación y registrar sus materiales: carpas, vallas, mesas, bancos, vehículos, equipos y cualquier otro recurso. Cada elemento admite cantidades, dimensiones, características, estado, localización y disponibilidad, aunque solo se conozca una parte.

Hay que distinguir entre **recursos propios** y **servicios contratados**. Si el Ayuntamiento trabaja con una empresa de aseos portátiles, registramos la empresa, el servicio, su precio diario, el coste de transporte y las condiciones, sin confundirlo con un elemento físico propiedad del Ayuntamiento. Toda esta información debe poder asociarse después a eventos, presupuestos y necesidades logísticas.

### 3.3 Contactos y empresas

Cada contacto puede pertenecer a una organización y tiene nombre, cargo, teléfono, correo electrónico, descripción y observaciones. Desde su ficha se puede llamar, abrir una conversación de WhatsApp o redactar un correo sin copiar datos a mano.

### 3.4 Catálogo de proveedores

Cuando el contacto es una empresa, dispone de un catálogo editable de productos y servicios: un directorio interno de proveedores donde consultar ofertas conocidas y comparar recursos. Cada producto o servicio tiene descripción, precio y una unidad de contratación configurable (unidad, metro, hora, jornada, paquete o cualquier otra modalidad indicada a mano).

La clasificación cubre un espectro amplio y ampliable: montaje, estructuras, carpas, vallas, transporte, catering, publicidad, personal, seguridad, sonido, iluminación, audiovisuales, limpieza, ocio y otros servicios para eventos.

La búsqueda debe ser especialmente rápida: sugerencias mientras se escribe, filtros por categoría y acceso preferente a las cinco búsquedas recientes.

### 3.5 Seguimiento de la jornada

Una pantalla para consultar qué debería estar ocurriendo en cada momento, qué empresa tiene asignada cada tarea, qué recursos deben llegar y qué dependencias hay entre actividades. Si un camión transporta las estructuras de un escenario, el montaje no puede empezar antes de su llegada y descarga.

La aplicación representa esas relaciones y permite evaluar hipótesis: ¿qué ocurre si el camión se retrasa quince minutos?, ¿qué actividades se ven afectadas?, ¿se solapa su descarga con otro transporte?, ¿qué margen queda antes de comprometer el horario previsto? Introducir un retraso debe ser sencillo, con valores concretos o estimaciones, y la aplicación distingue siempre entre **datos confirmados**, **previsiones** e **hipótesis**. Una hipótesis nunca sobrescribe el horario real sin confirmación.

## 4. Compartir instrucciones con las empresas

Por ejemplo, Nova Staff coordina parte del personal y Mario es su responsable. Queremos seleccionar sus tareas y generar una ficha de trabajo con horarios, ubicaciones, materiales, responsables, dependencias y observaciones, y enviarla por correo electrónico o WhatsApp, preferiblemente con un PDF fácil de imprimir o repartir. Así cada empresa sabe qué tiene que hacer, cuándo y qué necesita para empezar. Nada se envía sin la confirmación de quien usa la aplicación.

Los datos generales se ven sin dificultad; las configuraciones técnicas (duraciones, dependencias, márgenes, costes, condiciones especiales) aparecen en desplegables o paneles contextuales para no sobrecargar las pantallas.

## 5. Experiencia de uso

La experiencia de usuario es una prioridad absoluta. Tomamos como referencia la comodidad de navegación de Clash Royale (grandes superficies táctiles, organización por pantallas, desplazamientos fluidos, cambio de sección deslizando el dedo en horizontal) sin reproducir su estética infantil. La identidad sigue siendo profesional, sobria y coherente con OxEye.

- **Vertical:** los gestos horizontales cambian entre calendario, inventarios, contactos y las demás secciones.
- **Calendario en horizontal:** el cambio de sección se bloquea temporalmente; el desplazamiento vertical recorre las franjas horarias y el gesto de pinza cambia la escala temporal (altura de los intervalos). Debe existir también un control alternativo (+/−) para accesibilidad y escritorio.
- **Una sola mano** siempre que sea posible: botones grandes, desplazamiento vertical y opciones adicionales que aparecen solo cuando hacen falta.

## 6. Persistencia, sincronización e identidad

La aplicación no depende de mantener abierta una pestaña ni de una sesión del navegador. Se puede introducir información, cerrar, volver más tarde e identificarse para recuperar exactamente el trabajo, también desde otro dispositivo. Los cambios se guardan de forma fiable y están disponibles en el móvil y en el ordenador.

- **Servidor externo:** el backend y sus bases de datos se alojan en un servidor externo elegido por el equipo, para que el equipo lo use desde el móvil en la calle y desde la oficina con el mismo enlace. El desarrollo se hace en local.
- **Conexión intermitente:** durante visitas a almacenes o espacios públicos no se pierde información si falta cobertura; la aplicación guarda borradores y muestra el estado de sincronización, sin prometer un guardado remoto que no ha ocurrido.
- **Usuarios del piloto:** cinco usuarios con nombre y contraseña: Elvis, Dailos, Yeray, Invitado y Equipo. Cada cambio queda firmado por quien lo hizo, para saber quién registró qué durante el piloto. El equipo recibe el enlace por la mañana y lo usa como libreta; Dailos puede seguir desde su oficina lo que va ocurriendo. Las contraseñas nunca se guardan en el repositorio ni en el código de la web.
- **Calidad del dato:** cada dato conserva, cuando corresponda, su fecha de registro, su origen (observado, comunicado, documento) y su estado de verificación (borrador, por verificar, validado). Lo que falta se marca como «Pendiente de verificar»; nunca se inventa.

## 7. Cierre de jornada

Al terminar el día, la aplicación genera un informe con los eventos creados o modificados, los nuevos contactos, las empresas registradas, los recursos inventariados, el porcentaje de información pendiente de completar, los contratos o presupuestos incorporados, las incidencias observadas y las decisiones tomadas. También identifica qué información seguimos necesitando y qué nuevas funcionalidades hemos descubierto para el piloto. El informe se consulta desde el ordenador y se exporta en PDF para compartirlo con Elvis y el equipo.

## 8. Reglas que no cambian

Los invariantes de dominio de OxEye también obligan al Gestor logístico: ninguna franja de entrega, ruta de camión, zona de almacenamiento o zona de montaje puede bloquear las rutas de emergencia A/B/C ni los servicios de accesibilidad (incluida la Carpa Amarilla), y las cargas pesadas (escenarios, generadores, depósitos, lastres) siguen pasando por la comprobación del subsuelo. OxEye ayuda a decidir; no certifica.
