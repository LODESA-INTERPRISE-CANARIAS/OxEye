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

---

## Anexo · Revisión 1 · reunión con Yeray (27 de noviembre de 2026)

> Anexo a la visión, no la sustituye. Recoge lo que pedimos tras recorrer el prototipo con Yeray como lo usaría Elvis. Plan técnico: `doc/specs/2026-11-27-revision-1.md`.

### Qué hemos visto al usarlo

La base funciona: los cinco espacios, el calendario por lugar, los avisos, «¿Y si…?», el catálogo y el cierre de jornada. Lo que pedimos ahora es pulirlo para que se lea mejor de un vistazo, para que los conflictos se puedan resolver y no solo ver, para que el dinero y los permisos estén donde un responsable de eventos los espera, y para que cada persona tenga un acceso propio y privado. Todo se entrega antes de la jornada con Elvis del 2 de diciembre, por entregas pequeñas que se pueden probar de principio a fin.

### Lo que pedimos

- **Hoy.** «Actividad reciente» con altura fija y desplazamiento interno. «Próximos» pasa a «Próximos eventos», a todo el ancho, de una a cuatro columnas, con tarjetas que enseñan más cuando hay sitio.
- **Tareas.** Un espacio propio con todas las tareas, buscador, filtros y vistas agrupadas. Las dependencias se ven en la lista y en el calendario. Cuando un enlace cerraría un círculo, el texto nombra la cadena real. «Calidad del dato» nombra lo que se edita («Calidad de la tarea», «del evento»…).
- **Conflictos.** El aviso propone salidas (retrasar, adelantar o mantener ambas con un motivo) con vista previa de lo que se mueve en cadena, confirmación y firma, reutilizando el cálculo de «¿Y si…?». Las hipótesis dejan de ir rayadas y se distinguen con borde, etiqueta y tono.
- **Calendario.** Mover una tarea manteniéndola pulsada medio segundo, dentro del horario de su lugar (los lugares y almacenes pasan a tener horario opcional). Columnas que se ensanchan, flechas con más de tres lugares, lugares que se contraen con sus siglas («A.M.»), avisos en la cabecera de cada lugar y un marco horario que siempre se lee.
- **Controles propios** de hora, fecha, desplegable y selección múltiple, con el estilo del Gestor.
- **Preguntas abiertas** que se responden dentro de la nota, con autor, una respuesta vigente y cierre por quien preguntó.
- **Imágenes** en la ficha del material. «Gestionar» categorías con las propias en rojo y una ×.
- **Precios e impuestos.** Impuesto por empresa (IGIC, IVA, otro, ninguno, sin saber) con porcentaje; precio sin impuestos y estimación con impuestos; comparativa justa entre impuestos distintos; medallas en los tres primeros; botón «Comparar» junto a la categoría.
- **PDF** con la marca **OxEye** y nombres que se entienden sin abrirlos (`SCLL_Cierre-de-jornada_2026-12-02_18-30.pdf`), sin textos solapados.
- **Quién ve qué.** Administradores (Yeray, Elvis, Dailos y Fabián) ven presupuesto y gastos del evento; el equipo no. El Invitado deja de entrar en Contactos y Catálogo. Se cumple en el servidor, no solo escondiendo pantallas.
- **Navegar hacia atrás** con las flechas del navegador y el gesto del móvil.

### Decisiones tomadas

- La marca se escribe **OxEye** (una sola palabra), tanto en lo que lee una persona como en lo técnico; «Ojo de Buey» desaparece del producto (el identificador del formato de proyecto `ojo-de-buey` se conserva para que los proyectos guardados sigan abriéndose).
- Un solo modelo de roles por organización, sumables en una cuenta: administrador, desarrollador (también ve presupuestos; se puede retirar), equipo (cuenta compartida «Equipo») e invitado (solo lectura). Los usuarios del piloto pasan a ser seis con Fabián.
- El desarrollador y el administrador pueden poner una contraseña provisional a cualquier cuenta sin ver nunca la actual; el usuario la cambia antes de ver información sensible.
- La recuperación de contraseña llega al correo personal verificado del usuario o, si no tiene, al buzón del proyecto. Las solicitudes de presupuesto a proveedores se siguen enviando a mano desde el correo de quien usa la aplicación.
- Presupuesto sencillo y agradable de mirar: total por evento y gastos previstos o confirmados, sin contabilidad. Un gasto guarda una copia del precio y del impuesto de su momento.
- Impuesto elegido de una lista con porcentaje editable «por verificar»; nunca se supone un impuesto que nadie ha indicado.
- Solo los administradores aprueban una oferta recibida. Una foto principal y hasta cuatro más por material. «Mantener ambas» pide un motivo.

### Dos funciones nuevas de Yeray: primero maqueta, después código

Para las dos, antes de programar, una maqueta navegable con datos ficticios que Yeray aprueba.

#### Sistema inteligente de ofertas, proveedores y renegociación comercial (texto de Yeray)

> Quiero ampliar el funcionamiento del catálogo de OxEye sin modificar la gestión del inventario propio, que debe seguir funcionando como hasta ahora. La idea es crear un sistema de contratación externa en el que podamos registrar manualmente las ofertas de nuestros proveedores, pero también permitir que sean las propias empresas quienes las presenten mediante un formulario web accesible desde el móvil, sin necesidad de instalar nada ni acceder a nuestra aplicación. Quiero que prepares una maqueta de este formulario y que cuides especialmente la experiencia de usuario: debe ser extraordinariamente sencillo, visual y rápido, casi como una conversación guiada en la que el proveedor va pulsando tarjetas, seleccionando opciones y respondiendo únicamente a las preguntas que corresponden a su actividad. Por ejemplo, si una empresa ofrece carpas, el formulario debería preguntarle por sus dimensiones, unidades disponibles, precio por unidad o jornada, montaje, transporte y condiciones de alquiler, pero nunca mostrarle preguntas irrelevantes. Si ofrece servicios de limpieza, en cambio, debería preguntarle por personal disponible, horas de trabajo, tarifas y demás cuestiones específicas. Las preguntas deben adaptarse dinámicamente a las respuestas anteriores, permitiendo incluso registrar varios productos o servicios en una misma oferta.
>
> Desde nuestro catálogo también quiero que podamos seleccionar un recurso que necesitamos contratar y enviar solicitudes de presupuesto a una o varias empresas mediante correo electrónico, incluyendo un enlace personalizado al formulario. Por ejemplo, si necesitamos tres carpas de 6 × 6 metros durante cuatro jornadas, el proveedor debería recibir esa información ya cumplimentada y limitarse a indicar si puede ofrecerlas, en qué condiciones y a qué precio. Una vez enviada, la propuesta debe quedar registrada en OxEye, pendiente de nuestra revisión y aprobación, y posteriormente incorporarse al catálogo de contratación con sus correspondientes tarifas, condiciones y datos del proveedor. También quiero que podamos comparar varias ofertas de un mismo recurso, teniendo en cuenta no solamente el precio, sino también los servicios incluidos, la disponibilidad y el coste total de contratación.
>
> Hay un aspecto especialmente importante: las ofertas deben tener una vigencia comercial definida y negociable. No podemos asumir que una empresa que este año nos alquila una carpa por 180 € vaya a mantener indefinidamente ese precio. Por eso, al registrar una oferta, el proveedor debe indicar hasta qué fecha se compromete a respetar sus condiciones económicas, pudiendo establecer periodos de 30 días, varios meses o incluso varios años. Esto también debe permitir acuerdos comerciales más interesantes: por ejemplo, una empresa podría ofrecernos un castillo hinchable a un precio especialmente reducido si nos comprometemos a contratarlo durante cinco años, mientras que otra podría ofrecernos una tarifa más económica en verano y otra superior durante la temporada de lluvias, cuando aumentan sus costes operativos. Debemos distinguir claramente entre la fecha hasta la que puede aceptarse una oferta, las fechas en las que el proveedor puede prestar el servicio y la duración de cualquier compromiso contractual. También debemos contemplar tarifas estacionales, suplementos, cantidades mínimas y condiciones especiales, de manera que el precio de cada recurso pueda calcularse correctamente según las características y fechas del evento.
>
> Finalmente, quiero que este sistema esté conectado con nuestro gestor de tareas y con el módulo económico. Cuando una oferta esté próxima a caducar, OxEye debe generar automáticamente una tarea pendiente indicando que debemos contactar con el proveedor para renegociar sus condiciones, con avisos anticipados configurables. Por ejemplo, si el precio de las carpas de Mario vence dentro de un mes, el sistema debería recordarnos que debemos renegociarlo antes de utilizarlo en futuras contrataciones. Las ofertas caducadas deben conservarse en un historial, junto con sus precios y condiciones anteriores, pero no utilizarse automáticamente como tarifas vigentes. Cuando renegociemos una oferta, podremos actualizarla conservando sus versiones anteriores, sin modificar presupuestos históricos ni contratos ya formalizados. El objetivo es que el catálogo deje de ser únicamente una relación de recursos y se convierta en una herramienta de gestión comercial capaz de solicitar, recibir, comparar, contratar y renovar ofertas, manteniendo siempre la trazabilidad económica y reduciendo al mínimo el trabajo administrativo tanto para nosotros como para las empresas colaboradoras. Antes de programar toda la funcionalidad, quiero que prepares una maqueta navegable del formulario móvil y de su correspondiente panel administrativo, para que podamos comprobar que el proceso resulta realmente cómodo y coherente con el resto de OxEye.

#### Perfiles personales, autenticación privada y gestión segura de contraseñas (texto de Yeray)

> Quiero mejorar el sistema de acceso de OxEye para que cada integrante del equipo disponga de una cuenta personal, privada y personalizable. Actualmente accedemos seleccionando nuestro usuario de una lista e introduciendo una contraseña predefinida, pero quiero sustituir esa selección por un inicio de sesión convencional en el que cada persona escriba su nombre de usuario y contraseña. Los nombres de usuario actuales deben conservarse exactamente como están, al igual que las contraseñas iniciales que ya hemos asignado, para que nadie pierda el acceso durante la transición. Una vez dentro, quiero que cada usuario pueda acceder a una sección de perfil desde la que gestionar sus datos personales, subir o cambiar su fotografía, escribir una breve descripción, personalizar algunos aspectos visuales de su cuenta y consultar su actividad dentro del proyecto. Me gustaría que esta sección tuviera cierta personalidad y resultara agradable de utilizar, como un pequeño espacio propio dentro de OxEye, pero sin perder la estética profesional del programa. También debe permitir modificar el nombre visible, el correo electrónico de recuperación y la contraseña, manteniendo el identificador interno de usuario para no perder la vinculación con las tareas, registros y acciones anteriores.
>
> En el primer inicio de sesión tras implementar esta función, quiero que aparezca una pequeña pantalla de bienvenida en la que se invite al usuario a configurar su perfil y se le pregunte si desea conservar temporalmente su contraseña inicial o establecer una nueva. Por seguridad, las contraseñas iniciales deberían considerarse provisionales y solicitar su sustitución antes de acceder a información sensible. El usuario podrá elegir una contraseña privada que solamente él conozca, sin necesidad de comunicárnosla. Para recuperarla, deberá disponer de una dirección de correo electrónico previamente verificada, de manera que, si la olvida, pueda solicitar un enlace temporal de recuperación y establecer una nueva contraseña. Es importante que ni los administradores ni los desarrolladores podamos consultar las contraseñas personales de los usuarios, por lo que deberán almacenarse mediante un sistema de hash seguro, nunca como texto legible ni mediante cifrado reversible. Tampoco deben aparecer en registros, bases de datos exportadas o herramientas de depuración.
>
> Al mismo tiempo, necesitamos conservar la posibilidad de realizar labores de administración, mantenimiento y pruebas sin depender de que cada compañero nos facilite sus credenciales. Para ello, quiero implementar un acceso administrativo independiente, con permisos específicos, que nos permita revisar el funcionamiento del sistema, gestionar usuarios, restablecer accesos y, cuando resulte estrictamente necesario, acceder a una sesión de soporte con los permisos de un usuario determinado. Esta funcionalidad sustituiría la idea de utilizar una contraseña maestra universal, porque no quiero introducir una vulnerabilidad que permita saltarse indiscriminadamente la seguridad de todas las cuentas. El acceso de soporte deberá estar protegido mediante autenticación reforzada, limitarse a administradores autorizados y registrar quién lo utilizó, cuándo, sobre qué cuenta y con qué finalidad. Siempre que sea posible, deberá notificarse al usuario afectado y evitar el acceso a información estrictamente privada. Las sesiones de soporte deben estar claramente identificadas, tener una duración limitada y poder revocarse. De esta manera podremos comprobar errores o ayudar a un compañero sin conocer, modificar ni apropiarnos de su contraseña personal.
>
> También quiero que cada cuenta tenga permisos asociados a su función dentro del proyecto, diferenciando administradores, desarrolladores y otros colaboradores, de forma que cada persona pueda acceder únicamente a las herramientas e información que le correspondan. Los cambios de contraseña, las recuperaciones de acceso y las modificaciones importantes del perfil deberán quedar registrados como eventos de seguridad, sin almacenar información confidencial. El cierre de sesión, la expiración de sesiones inactivas y la posibilidad de revocar sesiones abiertas en otros dispositivos también deben contemplarse. Todo esto debe integrarse con el gestor de tareas compartido, de modo que las fotografías, nombres y perfiles aparezcan de forma coherente en las asignaciones, comentarios e historiales de actividad. El objetivo es que cada integrante sienta que tiene su propio espacio de trabajo dentro de OxEye, con libertad para personalizarlo y garantías reales de privacidad, mientras nosotros conservamos las herramientas administrativas necesarias para mantener y desarrollar el software sin invadir sus credenciales personales. Antes de implementar la funcionalidad completa, prepara una maqueta visual del inicio de sesión, la bienvenida inicial, el editor de perfil, el cambio y recuperación de contraseña y el panel administrativo de usuarios, prestando especial atención a la sencillez del flujo, la jerarquía visual y la coherencia con el diseño actual de OxEye.

### Lo que no cambia

Siguen valiendo esta visión, los invariantes de OxEye aplicados a la logística, la distinción entre confirmado, previsto e hipótesis, la firma de cada cambio, el modo sin cobertura y la regla de que nada se envía a una empresa sin confirmación. Los datos registrados no se pierden: todo cambio de base de datos va por migración. Mover una tarea nunca oculta los recordatorios de rutas de emergencia A/B/C, Carpa Amarilla ni subsuelo; el Gestor no conoce la geometría de las rutas y nunca afirma que una franja sea segura. OxEye ayuda a decidir; no certifica.
