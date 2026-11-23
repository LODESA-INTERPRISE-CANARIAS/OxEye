/**
 * @module data/plain-language-fields
 * Diccionario de preguntas comprensibles y explicaciones contextuales para todos los parámetros.
 */
export const PLAIN_LANGUAGE_FIELDS: Record<string, [string, string]> = {
  uniqueAttendees: [
    'Asistentes únicos previstos',
    'Personas distintas que visitan el evento durante toda la jornada. Es la suma real de las llegadas previstas por cada hora, sin confundirla con la ocupación simultánea ni con el aforo máximo.',
  ],
  curveProfile: [
    'Curva horaria de llegadas',
    'Forma en que se distribuyen las entradas hora a hora a lo largo del evento. La media por hora se calcula automáticamente y la hora punta indica cuándo entran más personas.',
  ],
  arrivals: [
    'Llegadas medias por hora (referencia)',
    'Media de entradas por hora calculada a partir del total diario dividido entre las horas de apertura. Las personas presentes al mismo tiempo dependen además de cuánto tiempo permanecen dentro.',
  ],
  area: [
    '¿Cuántos metros cuadrados podemos utilizar?',
    'Introduce la superficie libre operativa disponible para planificar servicios, colas y estancia. Esta cifra por sí sola no establece el aforo autorizado.',
  ],
  stayMinutes: [
    'Permanencia media esperada (min)',
    'Minutos aproximados que pasa cada visitante dentro del recinto. Con las mismas llegadas, una permanencia mayor aumenta la ocupación simultánea máxima.',
  ],
  dwellTimeMinutes: [
    'Permanencia media esperada (min)',
    'Minutos aproximados que pasa cada visitante dentro del recinto. Se combina con la curva de entradas para calcular cuántas personas coinciden dentro en cada tramo.',
  ],
  authorizedCapacity: [
    'Aforo máximo autorizado',
    'Límite oficial o de seguridad si está definido. Déjalo vacío («No definido») cuando no dispongas todavía de una cifra autorizada.',
  ],
  desiredMaxOccupancy: [
    'Ocupación simultánea máxima prevista',
    'Referencia operativa del máximo de personas coincidiendo a la vez dentro del recinto para mantener comodidad y fluidez.',
  ],
  foodShare: [
    '¿Qué porcentaje de visitantes comprará comida?',
    'Un 35 % equivale a 35 de cada 100 llegadas. Se utiliza para estimar la demanda de los puestos de comida.',
  ],
  serviceHourly: [
    '¿Cuántos pedidos puede atender un puesto en una hora?',
    'Introduce pedidos completados, no personas esperando. Por ejemplo, un pedido cada dos minutos equivale a 30 pedidos por hora. Confirma el rendimiento con el proveedor.',
  ],
  utilization: [
    '¿Qué parte de la capacidad queremos utilizar? (%)',
    'Trabajar al 75 % deja un margen del 25 % frente a la capacidad nominal. Un puesto capaz de servir 40 pedidos por hora se planifica para 30. Este margen es una decisión del ensayo.',
  ],
  seatedShare: [
    '¿Qué porcentaje de quienes comen necesitará asiento?',
    'Si se esperan 100 comidas y se introduce el 80 %, se planifica que 80 se consuman sentadas. El tiempo de comida determina cuántas plazas hacen falta simultáneamente.',
  ],
  mealMin: [
    '¿Cuánto dura una comida corta? (minutos)',
    'La simulación asigna a cada comida una duración entre este mínimo y el máximo. Diez minutos puede ser una hipótesis inicial para un consumo rápido.',
  ],
  mealMax: [
    '¿Cuánto dura una comida larga? (minutos)',
    'Veinte minutos puede ser una hipótesis inicial para comer con tranquilidad. Al aumentar este tiempo, las mesas se liberan más despacio.',
  ],
  tablesPerRoof: [
    '¿Cuántas mesas caben bajo cada carpa?',
    'Introduce una cantidad que permita bancos, acceso y circulación. El cálculo divide las mesas necesarias por este número. Después debe comprobarse el encaje real en el plano.',
  ],
  shopShare: [
    '¿Qué porcentaje del público visitará los comercios?',
    'Un 40 % supone 40 visitas a comercios por cada 100 llegadas, según esta hipótesis de cálculo. Ajusta el dato según el tipo de evento.',
  ],
  shopMinutes: [
    '¿Cuántos minutos dura la atención en un comercio?',
    'Incluye elegir, consultar y pagar. Una atención más larga requiere más puestos o más personas atendiendo para servir la misma demanda.',
  ],
  shopPlaces: [
    '¿Cuántos clientes puede atender cada comercio a la vez?',
    'Tres clientes simultáneos significa que el puesto puede atender tres operaciones al mismo tiempo. Debe haber personal y espacio suficientes.',
  ],
  toiletShare: [
    '¿Cuántos usos de baño esperamos por cada 100 llegadas?',
    'Un valor de 15 representa 15 usos por cada 100 entradas. Es una hipótesis de demanda. La dotación final también requiere requisitos sanitarios y de accesibilidad.',
  ],
  toiletMinutes: [
    '¿Cuántos minutos dura cada uso del baño?',
    'Se usa para estimar la rotación de cada cabina. Con cuatro minutos por uso, una cabina podría atender nominalmente 15 usos por hora.',
  ],
  children: [
    '¿Qué porcentaje del público serán menores?',
    'Veinte equivale a 20 de cada 100 visitantes. En este formulario es una hipótesis para dimensionar necesidades. No modifica automáticamente todos los perfiles de la simulación.',
  ],
  older: [
    '¿Qué porcentaje del público serán personas mayores?',
    'Veinte equivale a 20 de cada 100 visitantes. Permite revisar la previsión de asientos y acompañamiento. No se deduce directamente del padrón municipal.',
  ],
  'edit-x': [
    'Posición horizontal en el plano (metros)',
    'Distancia desde el borde izquierdo del mapa hasta el centro del elemento. Aumentar el número desplaza la pieza hacia la derecha, al este. También puedes arrastrarla en Diseñar.',
  ],
  'edit-y': [
    'Posición vertical en el plano (metros)',
    'Distancia desde el borde superior del mapa hasta el centro del elemento. Aumentar el número la desplaza hacia abajo, al sur.',
  ],
  'edit-gate': [
    '¿Qué uso tiene este acceso?',
    'Elige solo salida, solo entrada, entrada y salida o acceso libre. Las unidades de autoridades recomendadas se configuran por separado justo debajo.',
  ],
  'edit-width': [
    '¿Cuánto mide de ancho? (metros)',
    'Medida de un lado de la huella. Junto con el fondo y el giro determina el espacio que ocupa en el plano.',
  ],
  'edit-depth': [
    '¿Cuánto mide de fondo? (metros)',
    'Medida del otro lado de la huella. Comprueba las medidas reales del proveedor antes del montaje.',
  ],
  'edit-rotation': [
    'Orientación de la pieza (grados)',
    'Un giro de 90 grados equivale a un cuarto de vuelta. Al girar, cambia el espacio que necesita respecto a pasillos y elementos próximos.',
  ],
  'edit-labCapacity': [
    '¿Cuántas personas pueden ser atendidas a la vez?',
    'Limita la atención simultánea en este servicio. Aumentarlo requiere personal, equipos y espacio que permitan ese ritmo.',
  ],
  'edit-capacity': [
    '¿Cuántas plazas o equipos hay disponibles?',
    'En una mesa indica asientos. En un recurso de emergencia indica equipos que pueden intervenir simultáneamente.',
  ],
  'edit-staff': [
    '¿Cuántas personas forman este equipo?',
    'La simulación compara esta dotación con el personal requerido por la intervención. Es un dato de ensayo que debe confirmar la organización.',
  ],
  'edit-delay': [
    '¿Cuántos segundos tarda en ponerse en marcha?',
    'Tiempo supuesto entre la asignación del aviso y el inicio del desplazamiento. El recorrido se calcula aparte.',
  ],
  'edit-handling': [
    '¿Cuántos segundos dura la intervención?',
    'Tiempo de atención configurado después de llegar. Sustitúyelo por valores contrastados para el ejercicio concreto.',
  ],
  'edit-labTime': [
    '¿Cuántos minutos tarda en atender un pedido?',
    'Tiempo de servicio por cliente. Es distinto del tiempo que tarda el cliente en consumir la comida en una mesa.',
  ],
  fireBurnSeconds: [
    '¿Cuánto tarda una estructura en destruirse en este ensayo?',
    'Es una hipótesis visual y temporal para comparar el dispositivo. No es un cálculo físico de incendio ni un dato de resistencia al fuego del material.',
  ],
  fireSpreadSeconds: [
    '¿Cuántos segundos pasan antes de que pueda propagarse?',
    'Después de esta espera, las estructuras próximas acumulan exposición. El parámetro sirve para ensayar escenarios más o menos exigentes.',
  ],
  fireSpreadGap: [
    '¿A qué distancia puede propagarse entre piezas?',
    'Umbral geométrico de ensayo entre estructuras próximas. La propagación real depende de materiales, carga de fuego, viento y otras condiciones que aquí se simplifican.',
  ],
  localExtinguishSeconds: [
    '¿Cuántos segundos dura el intento con extintor?',
    'El intento comienza cuando la persona formada alcanza el punto de intervención. Requiere un extintor disponible y una ruta accesible.',
  ],
  'edit-clearWidth': [
    '¿Cuántos metros libres tiene este acceso?',
    'Longitud del tramo representado en el plano. Se utiliza como anchura declarada para el modelo y debe comprobarse en el lugar.',
  ],
  'edit-gateAngle': [
    '¿Cómo está orientada la línea del acceso?',
    'Cero grados dibuja una línea horizontal. Entrada y salida se indican con una flecha de doble sentido que cruza el tramo.',
  ],
  reinforcementDelay: [
    '¿Cuánto tarda en llegar un equipo de reserva? (segundos)',
    'Se aplica a recursos que hayas marcado como reserva en el inventario. Es un tiempo del ensayo, pendiente de confirmar con el servicio correspondiente.',
  ],
  incidentRadius: [
    '¿Qué radio de precaución queremos probar? (m)',
    'Es una hipótesis geométrica del ensayo, no una distancia exigida universalmente por ley. El perímetro real debe establecerlo el plan aplicable y el responsable técnico para el riesgo concreto.',
  ],
  curiosityShare: [
    '¿Qué porcentaje puede acercarse por curiosidad?',
    'Hipótesis de conducta para probar la acumulación de personas en torno a una incidencia. No es una tasa observada del público de La Laguna.',
  ],
  sensoryShare: [
    '¿Qué porcentaje tiene una percepción reducida simulada?',
    'Permite ensayar mayor demora de percepción. No atribuye diagnósticos reales ni presume que una edad implica discapacidad.',
  ],
  mildAlcoholShare: [
    '¿Qué porcentaje de adultos tiene consumo leve simulado?',
    'Parámetro de ensayo que aumenta la demora de respuesta en un subconjunto adulto. La cifra no describe a asistentes reales.',
  ],
  teamSize: [
    '¿Cuántas personas trabajarán en el turno?',
    'Dotación de referencia para la estimación de personal. Para distribuir recursos entre empresas, utiliza Empresas y recursos.',
  ],
  rate: [
    '¿Cuál es el salario bruto por hora? (€)',
    'Importe antes de añadir los costes adicionales de personal. Es una cifra para calcular el presupuesto del ensayo.',
  ],
  burden: [
    '¿Qué costes de personal añadimos al salario? (%)',
    'Incluye aquí el porcentaje adicional que quieras aplicar al salario bruto. Confirma qué conceptos incluye el presupuesto para evitar duplicarlos.',
  ],
  hoursLimit: [
    '¿Cuántas horas durará el turno de trabajo?',
    'Al agotarse el turno se muestra el trabajo completado y el pendiente. Puedes añadir otra jornada y ajustar recursos.',
  ],
  setupMin: [
    '¿Cuántos minutos tarda el montaje de una pieza de referencia?',
    'Tiempo supuesto con tres personas. El motor lo adapta al tipo de pieza y a la cuadrilla. Las carpas, mesas y puestos requieren tareas distintas.',
  ],
  strikeMin: [
    '¿Cuántos minutos tarda en desmontarse una pieza de referencia?',
    'Tiempo supuesto con tres personas. Sustitúyelo por tiempos del proveedor o partes de trabajo cuando estén disponibles.',
  ],
  cleanMin: [
    '¿Cuántos segundos se tarda en recoger cinco litros de residuos?',
    'Regula el ritmo de recogida. Los desplazamientos hasta el punto de residuos y hasta el contenedor se calculan aparte.',
  ],
  bagLitres: [
    '¿Cuántos litros de residuos admite cada bolsa?',
    'Al alcanzar esta capacidad, el equipo de limpieza debe ir al contenedor a vaciar la bolsa.',
  ],
  wasteLitres: [
    '¿Cuántos litros genera cada pieza durante una jornada?',
    'Cantidad hipotética usada para planificar la limpieza. Puede ajustarse después de medir residuos reales del evento.',
  ],
  eventDays: [
    '¿Cuántos días durará el evento?',
    'Determina las jornadas de apertura y permite ensayar limpiezas entre días antes del desmontaje final.',
  ],
  parkMin: [
    '¿Cuántos minutos necesita el camión para aparcar?',
    'Tiempo de maniobra supuesto al llegar a la descarga. La comprobación de giros y condiciones reales debe hacerse sobre el plano y el terreno.',
  ],
  truckBatch: [
    '¿Cuántos lotes de estructuras lleva cada camión?',
    'Número de piezas del inventario que se agrupan en cada viaje. Todavía no se calcula el volumen ni la carga útil real del vehículo.',
  ],
  dryStaff: [
    '¿Cuántas personas secarán las mesas y los bancos?',
    'El equipo se dirige a mesas mojadas. Si sigue lloviendo de forma lateral, las superficies pueden volver a mojarse.',
  ],
  drySeconds: [
    '¿Cuántos segundos necesita una persona para secar una mesa?',
    'Tiempo de trabajo por mesa. El recorrido a pie se calcula aparte.',
  ],
  estimateSource: [
    '¿De dónde proceden estos tiempos y tarifas?',
    'Indica presupuesto del proveedor, parte de trabajo, medición o hipótesis. Así el equipo conoce el origen de las cifras.',
  ],
  'sound-level': [
    '¿Qué nivel sonoro suponemos a cinco metros? (dB)',
    'Referencia usada para estimar la molestia por sonido en campo libre. Requiere medición y revisión acústica para decisiones reales.',
  ],
};

export const PLAIN_LANGUAGE_WORD_HELP: Record<string, [string, string]> = {
  'Visible durante': [
    '¿En qué fases estará presente?',
    'Marca cuándo debe aparecer este elemento: preparación y montaje, apertura al público, o desmontaje y limpieza. Puedes marcar más de una fase.',
  ],
  'Llegadas por hora': PLAIN_LANGUAGE_FIELDS.arrivals,
  'Duración de la jornada': [
    '¿Cuántas horas estará abierto al público?',
    'Duración de la jornada del evento. Los turnos de montaje y desmontaje se configuran por separado.',
  ],
  'Condición climática': [
    '¿Qué tiempo queremos ensayar?',
    'El clima modifica las hipótesis de llegada, búsqueda de refugio y disponibilidad de mesas secas.',
  ],
  'Respuesta sanitaria de ensayo': [
    '¿Qué respuesta sanitaria queremos poner a prueba?',
    'Elige atención en el lugar, traslado en camilla o aproximación de ambulancia. La selección representa un supuesto del ejercicio que requiere revisión profesional.',
  ],
  'Policía en el ensayo': [
    '¿Cómo se desplazará la policía en este ensayo?',
    'Puedes probar una intervención a pie o en coche. Debes disponer del recurso correspondiente en el inventario.',
  ],
  'Luz de escena': [
    '¿A qué hora del día queremos ver el plano?',
    'Este control cambia el aspecto visual. El horario efectivo del evento se configura al crear el modelo.',
  ],
  'Precio (€)': [
    '¿Cuánto pagará el cliente? (€)',
    'Precio por compra utilizado para compararlo con el presupuesto ficticio del visitante y estimar ventas.',
  ],
};
