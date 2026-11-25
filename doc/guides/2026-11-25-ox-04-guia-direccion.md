# OX-04 · Recinto reutilizable y varias distribuciones por evento

**Guía para la dirección del proyecto**
Fecha: 25/11/2026 · Rama de trabajo: `feat/ox-04-recinto-distribuciones` (pendiente de publicar)

Este documento explica, sin términos técnicos, qué cambia en OxEye con OX-04, cómo encaja con lo que pedía la ficha de especificación y cómo probarlo usted mismo en el navegador.

> **Importante.** La revisión que hace OxEye antes de confirmar una distribución es **orientativa**. Ayuda a detectar problemas, pero **no certifica la seguridad del evento**. Los umbrales (por ejemplo, 500 kg/m² para carga pesada sobre el subsuelo) son valores de referencia que se pueden revisar, no límites certificados.

---

## 1. La idea en dos minutos

Hasta ahora, cada evento llevaba "todo junto": el plano de la plaza, su perímetro, sus accesos, su subsuelo **y** las carpas, vallas y servicios de ese evento. Si se quería otro montaje en el mismo sitio, había que volver a dibujar la plaza.

Con OX-04 se separan dos cosas:

| Concepto | Qué es | Ejemplo | Cambia… |
|---|---|---|---|
| **Recinto** | El lugar físico, lo que no cambia de un evento a otro: perímetro, accesos, zonas restringidas, subsuelo (Rayos X), elementos permanentes y mapa base. | La Plaza del Cristo. | Rara vez. Se guarda **una vez** y se reutiliza. |
| **Distribución** | Todo lo que se coloca en el recinto para un evento: carpas, vallas, escenarios, servicios, rutas, mediciones… | "Montaje de Navidad", "Montaje alternativo con escenario al norte". | En cada evento y en cada versión del montaje. |

Un mismo evento puede tener **varias distribuciones** del mismo recinto (por ejemplo, una opción A y una opción B), y comparar cuál conviene.

### Estados de una distribución

| Estado | Significado |
|---|---|
| **Borrador** | En preparación. Se puede guardar siempre, aunque tenga problemas. |
| **Propuesta** | Presentada para su aprobación. |
| **Vigente** | La que se usará. Solo puede haber **una vigente** por evento, recinto y fase. |
| **Archivada** | Guardada como histórico; ya no se usa. |

Para pasar a **Propuesta** o **Vigente**, OxEye revisa antes la distribución (ver apartado 2.4).

### Fases operativas

Cada distribución indica qué fases cubre: **Montaje**, **Evento** y **Recogida** (por defecto, las tres).

### Dos modos de edición

En la barra superior hay un selector:

- **Editar distribución** (modo normal): se trabaja sobre el montaje del evento. Los elementos del recinto (perímetro, accesos, subsuelo…) se ven pero están **bloqueados**, para no modificarlos por accidente.
- **Editar recinto**: se modifica el lugar físico. Un aviso naranja recuerda que **los cambios afectan a todas las distribuciones que usan ese recinto**. Solo pueden usarlo los perfiles con permiso (de momento, administración de la organización y coordinación del evento).

---

## 2. Qué ha cambiado

### 2.1 El recinto se guarda una vez y se reutiliza
- Al crear un evento nuevo aparece la opción **«Usar un recinto guardado — Sin volver a dibujar el perímetro»**.
- El recinto se guarda a nivel de organización, así que lo pueden usar varios eventos.

### 2.2 Varias distribuciones por evento
En la barra superior, el botón **«Distribuciones»** abre una ventana desde la que se puede:
- **Abrir** una distribución.
- **Renombrar** una distribución.
- **Duplicar** una distribución. La copia empieza como borrador y **sin la revisión de seguridad de la original**: cada copia se revisa de nuevo.
- Crear una **Nueva distribución en blanco**, que solo contiene el recinto.
- **Proponer**, **Confirmar como vigente** y **Archivar**.
- Marcar las **fases operativas** que cubre cada distribución.

Si se confirma como vigente otra distribución de las mismas fases, la que lo era pasa automáticamente a **propuesta**.

### 2.3 Cambios en el recinto: aviso a las distribuciones afectadas
Si alguien cambia el recinto (por ejemplo, añade un acceso):
- al terminar, OxEye muestra la **lista de distribuciones afectadas**. Esas distribuciones **no se modifican solas**;
- cada una muestra la etiqueta **«Recinto modificado: revisar»**;
- no se puede proponer ni confirmar una distribución afectada hasta revisarla con **«Revisar con el recinto actual»**.

### 2.4 Revisión antes de confirmar
Al pulsar **Proponer** o **Confirmar como vigente**, OxEye comprueba la distribución en cinco apartados. Si hay un problema grave, **no deja confirmar** y explica la causa en cada caso:

1. **Perímetro**: ninguna instalación puede quedar fuera, ni siquiera una esquina.
2. **Accesos (público y emergencias)**.
3. **Subsuelo / carga pesada** (Rayos X).
4. **Rutas sanitarias A/B/C**: A, acceso de vehículos; B, sanitario a pie; C, evacuación en camilla.
5. **Aproximación de bomberos y policía**.

Otros avisos críticos se muestran aparte («Otros bloqueos críticos (no impiden confirmar)»). La ventana recuerda siempre que la revisión es **orientativa** y que solo evalúa la **fase de evento**.

### 2.5 Cada distribución tiene su propia revisión de seguridad
El análisis de subsuelo (Rayos X) y las rutas A/B/C se evalúan **para cada distribución**. Una distribución **nunca hereda** el visto bueno de otra.

### 2.6 Los proyectos antiguos siguen funcionando
Al abrir un proyecto creado antes de OX-04, OxEye lo convierte solo en **un recinto y una distribución vigente**. No se pierde nada y no hay que hacer nada. Exportar e importar archivos sigue funcionando igual que antes.

### 2.7 Versiones
Cada distribución lleva un número de versión (**v1, v2…**) que sube con cada cambio guardado. El recinto tiene también su propia versión.

---

## 3. Lo que pedía la ficha y cómo ha quedado

**Leyenda:** ✅ cumplido y comprobado · ⚠️ cumplido con matiz · ⏳ pendiente de una decisión de dirección

| Lo que pedía la ficha OX-04 | Estado | Cómo se ha resuelto |
|---|---|---|
| Guardar el recinto (perímetro, accesos, zonas restringidas, subsuelo, elementos permanentes, mapa base) separado del montaje | ✅ | Nuevo concepto **Recinto**, guardado a nivel de organización. |
| Crear dos distribuciones del mismo recinto **sin volver a dibujar el perímetro** | ✅ | Distribución en blanco, duplicar, y «Usar un recinto guardado» al crear un evento. Hay una prueba automática que lo comprueba. |
| Duplicar una distribución | ✅ | La copia empieza como borrador, en v1 y sin revisión de seguridad heredada. |
| Estados y fases (borrador, propuesta, vigente, archivada; montaje, evento, recogida) | ✅ | Solo puede haber una vigente por evento, recinto y fase. |
| **VAL-MAP-CORE-001**: una instalación colocada, girada y movida conserva su identidad, posición, giro, tamaño y versión al guardar y volver a abrir | ✅ | Comprobado con prueba automática. |
| **VAL-MAP-BOUNDARY-001**: una instalación fuera del perímetro no se puede confirmar y se explica por qué | ✅ | La revisión la bloquea y el panel de la instalación indica cuántas esquinas quedan fuera. |
| Añadir un acceso al recinto muestra las distribuciones afectadas | ✅ | Lista de afectadas y etiqueta «Recinto modificado: revisar». |
| Un proyecto antiguo se abre como recinto + una distribución vigente | ✅ | Conversión automática al abrir. Se ha comprobado que la simulación da exactamente el mismo resultado antes y después. |
| Rayos X y rutas A/B/C evaluados por distribución, nunca heredados; si faltan, no se confirma | ✅ | Revisión propia en cada distribución. |
| No romper lo que ya funcionaba | ✅ | Todas las pruebas automáticas pasan (ver apartado 5). |
| Los cambios en el recinto no se hacen "sin querer" desde una distribución | ✅ | Modo «Editar recinto» separado y elementos del recinto bloqueados en el modo normal. |
| Vehículos de emergencia (ambulancia, bomberos, policía) en la comprobación de perímetro | ⚠️ | **Se excluyen** de esa comprobación, porque se sitúan legítimamente fuera del recinto, en la vía de aproximación. Sus rutas sí se evalúan en los apartados de rutas y de aproximación. |
| Quién puede editar el recinto | ⏳ | Provisional: administración de la organización y coordinación del evento. Se cambia fácilmente cuando dirección lo decida. |

---

## 4. Cómo probarlo paso a paso

**Antes de empezar:**
- Use un ordenador con la ventana del navegador **maximizada**. La barra de distribuciones solo aparece si la ventana mide **más de 1200 píxeles de ancho**.
- Todo se guarda en el propio navegador. No necesita usuario ni conexión a un servidor.
- Para cada paso, anote: ✔ si ocurrió lo esperado, o ✘ y una breve descripción (mejor con una captura de pantalla).

### Paso 1 · Crear un evento de ejemplo
1. En el menú inicial pulse **«Crear nuevo modelo»**.
2. En el paso de ubicación elija **Plaza del Cristo** y avance hasta terminar el asistente.

**Debería ver** el mapa de la Plaza del Cristo con el montaje de ejemplo.

### Paso 2 · Localizar la barra de recinto y distribución
Mire la parte superior de la pantalla.

**Debería ver**, de izquierda a derecha:
- el nombre del recinto;
- un desplegable con la distribución actual;
- una etiqueta de estado (por ejemplo **Vigente**) y la versión (**v1**);
- el botón **«Distribuciones»**;
- el selector **«Editar distribución / Editar recinto»**.

### Paso 3 · Crear una segunda distribución sin redibujar nada
1. Pulse **«Distribuciones»**.
2. Pulse **«Nueva distribución en blanco»**, póngale un nombre (por ejemplo, "Opción B") y ábrala.

**Debería ver** la plaza con su perímetro y sus accesos, pero **sin** las carpas del montaje de ejemplo. No ha tenido que dibujar el perímetro.

3. Vuelva a **«Distribuciones»**, pulse **Duplicar** sobre la distribución original y abra la copia.

**Debería ver** el mismo montaje que el original, con estado **Borrador** y **v1**.

### Paso 4 · Cambiar entre distribuciones
Use el desplegable de la barra superior para pasar de una distribución a otra.

**Debería ver** que el mapa cambia al montaje de cada una, y que lo que mueve en una **no afecta** a las demás.

### Paso 5 · Intentar confirmar con una instalación fuera del perímetro
1. Abra la distribución original del ejemplo.
2. En **«Distribuciones»**, pulse **«Confirmar como vigente»** sobre ella. Si ya es vigente, haga la prueba con la copia del paso 3.

**Debería ver** que OxEye **no deja confirmar**. En el apartado **Perímetro** aparecen instalaciones del ejemplo que quedan fuera del recinto, como **«WC · pasillo oeste»** y la **Carpa Amarilla** de ejemplo. Debajo aparece el aviso de que la revisión es orientativa.

> Este bloqueo es **correcto**: el ejemplo de la Plaza del Cristo trae esas instalaciones fuera del perímetro dibujado. Qué hacer con ellas es una decisión pendiente (apartado 6, punto 1).

3. Cierre la ventana. En el mapa, haga clic en una de esas instalaciones.

**Debería ver** en el panel lateral una nota que explica cuántas de sus 4 esquinas quedan fuera del perímetro.

4. Arrástrela dentro del perímetro, o selecciónela y pulse la tecla **Supr** para eliminarla. Repita con las demás que se señalaban y vuelva a intentar **«Confirmar como vigente»**.

**Debería ver** que el apartado Perímetro ya no bloquea. Si aparece otro bloqueo (accesos, subsuelo, rutas A/B/C…), lea la explicación: indica qué hay que corregir.

### Paso 6 · Modificar el recinto y ver las distribuciones afectadas
1. En el selector de la barra superior elija **«Editar recinto»**.

**Debería ver** un aviso: «Editando el recinto: los cambios afectan a todas las distribuciones que lo usan.» Además, el desplegable de distribuciones queda bloqueado mientras edita el recinto.

2. En el panel lateral, en **INFRAESTRUCTURA DEL ESPACIO**, pulse **«⇄ Acceso»** y dibuje un acceso nuevo sobre el borde del perímetro.
3. Pulse **«Terminar edición del recinto»**.

**Debería ver** una ventana: «El recinto ha cambiado (versión N). Estas distribuciones no se han modificado; revísalas antes de confirmarlas.», con la lista de distribuciones afectadas. Esas distribuciones mostrarán la etiqueta **«Recinto modificado: revisar»**.

4. Abra **«Distribuciones»** y pulse **«Revisar con el recinto actual»** en una de ellas.

**Debería ver** que la etiqueta desaparece en esa distribución.

### Paso 7 · Comprobar que el recinto está protegido en el modo normal
Con **«Editar distribución»** seleccionado, intente usar una herramienta de subsuelo (Rayos X), añadir un acceso o tocar el perímetro.

**Debería ver** un aviso breve, por ejemplo: «El subsuelo (Rayos X) se edita en «Editar recinto».» El recinto no cambia.

### Paso 8 · Comprobar que todo se guarda
Recargue la página (tecla **F5**) y pulse **«Continuar»**.

**Debería ver** el mismo evento, la misma distribución abierta y los mismos cambios, con el mismo número de versión.

### Paso 9 · Reutilizar el recinto en un evento nuevo
1. Vuelva al menú inicial y pulse **«Crear nuevo modelo»**.
2. En el paso de ubicación elija **«Usar un recinto guardado»** y seleccione la Plaza del Cristo.

**Debería ver** el nuevo evento con el perímetro, los accesos (incluido el que añadió en el paso 6) y el subsuelo ya puestos, sin dibujar nada.

### Paso 10 (opcional) · Abrir un proyecto antiguo
Si tiene un archivo de proyecto `.json` guardado antes de esta versión, ábralo con **«Cargar modelo»**.

**Debería ver** el proyecto como siempre, con **una distribución en estado Vigente**.

### Qué enviar de vuelta
- La lista de pasos con ✔ o ✘.
- Para cada ✘: qué hizo, qué esperaba y qué vio (con captura si es posible).
- Su respuesta a las decisiones del apartado 6.

---

## 5. Comprobaciones automáticas realizadas

Las ha ejecutado el equipo sobre esta versión:

| Comprobación | Resultado |
|---|---|
| Pruebas de la lógica | 224 de 224 superadas |
| Pruebas de uso en navegador | 21 superadas, 3 omitidas a propósito (ver limitaciones) |
| Revisión de calidad del código | Sin errores |
| Construcción de la aplicación | Correcta |
| Simulación del ejemplo Plaza del Cristo antes y después del cambio | Resultado idéntico |

---

## 6. Decisiones pendientes de dirección

1. **Instalaciones del ejemplo fuera del perímetro.** El ejemplo de la Plaza del Cristo trae «WC · pasillo oeste» y la Carpa Amarilla de ejemplo fuera del perímetro, así que no se puede confirmar sin tocarlo. ¿Corregimos el ejemplo (moverlas dentro o ampliar el perímetro) o se deja así, como caso didáctico?
2. **Otros recursos exteriores.** Ahora solo los vehículos de emergencia quedan fuera de la comprobación de perímetro. ¿Debe haber más excepciones (por ejemplo, puestos o servicios situados a propósito fuera del recinto)?
3. **Fases revisadas.** La revisión solo comprueba la **fase de evento**; lo que existe solo en montaje o en recogida no se revisa. ¿Basta así o se quiere revisar también montaje y recogida?
4. **Quién puede editar el recinto.** Provisionalmente, administración de la organización y coordinación del evento. ¿Es correcto?

---

## 7. Limitaciones conocidas

- **Pantallas estrechas.** La barra de recinto y distribución no aparece con la ventana a 1200 píxeles o menos. A 1280 píxeles algunos botones de la cabecera se salen de la pantalla. Este fallo ya existía antes de OX-04 (viene de OX-03) y la prueba automática correspondiente está marcada como pendiente.
- **Protección incompleta.** Algunas acciones (copiar y pegar, ciertos botones del panel lateral y la selección múltiple de subsuelo) aún no están del todo bloqueadas en el modo «Editar distribución».
- **Punto Violeta.** El historial de revisiones puede incluir el título de una incidencia de Punto Violeta, como ya ocurría antes. Ahora ese historial también se guarda dentro de la distribución. Se recomienda no poner datos identificativos en los títulos.
- **Varias pestañas.** Si se abre el mismo evento en dos pestañas a la vez y se edita en ambas, gana el último cambio guardado.
- **Solo en este navegador.** Todo se guarda localmente. Compartir recintos y distribuciones entre personas u ordenadores llegará con el servidor (OX-21).

---

## 8. Recordatorio

OxEye es una herramienta de **apoyo a la decisión**. Las revisiones, simulaciones y umbrales (como los 500 kg/m² de carga sobre el subsuelo) son **orientativos y editables**, con referencias al PEMU La Laguna (2011), al plan de autoprotección de la Plaza del Cristo (2021), a la Directiva 89/391/CEE y al INSST (2020). **No sustituyen** la validación técnica ni la aprobación de las autoridades competentes.
