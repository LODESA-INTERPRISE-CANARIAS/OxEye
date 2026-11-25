# OX-02 · Cómo compartir los datos de OxEye

*Resumen para dirección del proyecto · 25 de noviembre de 2026*

---

## En una frase

Antes de que varias personas trabajen juntas en OxEye, hay que decidir **dónde se guarda cada información y quién manda sobre ella**, para que todo el equipo vea siempre la misma versión y no copias que se contradicen.

---

## 1. El problema de hoy

Ahora mismo OxEye funciona como un documento que cada persona tiene en su propio ordenador.

Si alguien quiere compartir su trabajo, **exporta un archivo y se lo manda a otra persona**, igual que se haría con un Excel por correo. Eso tiene consecuencias:

- Cada persona acaba con **su propia copia**, y nadie sabe cuál es la buena.
- Si dos personas cambian cosas a la vez, **la última que importa el archivo borra el trabajo de la otra** sin avisar.
- Si alguien borra los datos de su navegador, **pierde el proyecto**.
- No hay usuarios ni permisos: quien abre la aplicación puede cambiarlo todo.

Para un piloto individual sirve. Para coordinar a un equipo real (logística, seguridad, proveedores, dirección), no.

---

## 2. La idea central: cada dato tiene un único dueño

Hemos hecho una lista de las 20 "piezas" de información que maneja OxEye (eventos, recintos, materiales, reservas, tareas, presupuesto, proveedores, incidencias, documentos…) y **a cada una le hemos asignado un único responsable**.

**Ejemplo:** el área de inventario es la dueña de "cuántas vallas tenemos y cuáles están reservadas". El presupuesto **no apunta su propio número de vallas**: consulta el de inventario. Así, si cambia el inventario, el presupuesto se entera solo y no hay dos cifras distintas.

OxEye ya hace esto bien en un caso: la configuración de asistencia del evento alimenta a la vez la calculadora de servicios y la simulación. Lo que proponemos es **aplicar esa misma regla a todo**.

---

## 3. Los tres caminos posibles

| | **A. Seguir como ahora** | **B. Servidor propio** | **C. Servicio alquilado** |
|---|---|---|---|
| Qué es | Cada uno en su ordenador, compartiendo archivos | Un ordenador central del equipo que guarda la información de todos | Una empresa externa nos presta ese ordenador central |
| Trabajo en equipo | No | Sí | Sí |
| Usuarios y permisos | No | Sí | Sí |
| Coste mensual | Nada | Bajo (electricidad y conexión, si usamos equipos propios) | Unos 25–60 $ al mes |
| Esfuerzo de construcción | Bajo | Alto | Medio |
| Quién lo mantiene | Nadie | Nosotros | El proveedor, en parte |
| Dónde están los datos | En cada ordenador | En nuestras instalaciones | En los servidores del proveedor |

---

## 4. Nuestra recomendación

1. **Aprobar ya el "cómo se organiza"** (el modelo de dueños del punto 2 y el camino B), aunque todavía no se monte nada.
2. **Montarlo en nuestros propios equipos.** Como el equipo dispone de ordenadores propios, el camino B es el más razonable: no pagamos alquiler y **los datos no salen de casa**, algo especialmente valioso para la información sensible.
3. **Mientras tanto, seguir en el camino A** (ver el punto 7, "plan B"), pero preparando la aplicación para que el día que exista el servidor el cambio sea sencillo.
4. **La simulación seguirá funcionando en el ordenador de cada persona**, con o sin servidor. Nunca dependerá de tener conexión.

> Nota: los documentos técnicos (ADR-024-001, 002, 005 y el mapa de autoridad de datos) se actualizaron el 25/11/2026 con las decisiones del punto 9.

### Qué implica tener el servidor en nuestros equipos

No es caro, pero sí es una responsabilidad:

- **Tiene que estar encendido**, al menos durante los días de montaje y de evento. Conviene una batería de respaldo por si se va la luz.
- **Tiene que ser accesible desde fuera** de forma segura (por ejemplo, desde la plaza el día del evento).
- **Las copias de seguridad deben guardarse en otro sitio.** Una copia en el mismo ordenador no sirve si ese ordenador se estropea.
- **Alguien del equipo tiene que encargarse** de mantenerlo al día y comprobar que las copias funcionan.

---

## 5. ¿Qué se puede hacer sin internet?

En la calle, durante el montaje, la cobertura puede fallar. La regla propuesta es sencilla:

- **Sin conexión se puede:** consultar el plano y la información, preparar borradores, simular y exportar.
- **Hace falta conexión para:** todo lo que **compromete a otros**, como confirmar una reserva de material, enviar una instrucción, cambiar permisos, elegir una oferta de proveedor o cerrar una incidencia real.

Cuando vuelve la conexión, los borradores se envían. Si mientras tanto otra persona cambió lo mismo, **la aplicación avisa** en lugar de borrar el trabajo de nadie.

---

## 6. Privacidad: Punto Violeta

Es el punto más delicado.

- La información de Punto Violeta **nunca debe aparecer en vistas públicas ni en archivos exportados**.
- Hemos detectado que **hoy algunos datos de simulación relacionados con Punto Violeta se guardan dentro del proyecto** y que hay **fallos de privacidad ya conocidos** que todavía están abiertos.
- **Antes de llevar nada a un servidor** hay que corregir esos fallos.
- **Hace falta una decisión expresa** sobre si estos datos pueden guardarse en el servidor compartido o deben quedarse solo en el dispositivo de quien los registra.

---

## 7. Plan B: si no hay servidor para el piloto

Se puede hacer una demostración **honesta** en modo local:

| Se puede enseñar | No se puede prometer |
|---|---|
| Plano y distribución del recinto | Varias personas trabajando a la vez |
| Inventario: qué hace falta y qué falta | Reservas confirmadas |
| Calendario con dependencias | Envío real de mensajes y confirmaciones de lectura |
| Estimaciones de presupuesto | Centro de operaciones compartido |
| Simulación completa y comparación de distribuciones | Usuarios con permisos distintos |

La aplicación debería avisar claramente de que **los datos solo están en ese ordenador**, y no aparentar coordinación que no existe.

---

## 8. Costes

| Camino | Coste mensual estimado |
|---|---|
| A. Seguir como ahora | 0 € |
| B. Servidor en equipos propios | Electricidad y conexión (el equipo ya existe) |
| B. Servidor alquilado (alternativa) | 10–60 € |
| C. Servicio alquilado completo | 25–60 $ |

*Son estimaciones orientativas, no un presupuesto. El coste principal en B y C no es el servidor, sino **el tiempo del equipo** para construirlo y mantenerlo.*

---

## 9. Lo que necesitamos que dirección decida

1. **¿Aprobamos el modelo de organización ahora** (cada dato con un único dueño, camino B) y dejamos el montaje para cuando esté listo?
Si, nos quedamos con la opción B.
2. **¿Usamos nuestros propios equipos como servidor?** Si es así: (si.)
   - ¿Será un ordenador dedicado o uno que también se usa para trabajar?
      Un ordenador dedicado.
   - ¿Quién del equipo se encarga de mantenerlo?
      El ingeniero de sistemas.
   - ¿Dónde guardamos las copias de seguridad?
      En un disco duro externo.
3. **Punto Violeta:** ¿pueden sus datos guardarse en el servidor compartido, o deben quedarse solo en local?
En el lugar más privado posible, en el dispositivo de quien los registra.
4. **Plan B:** ¿es aceptable para el piloto lo que se puede enseñar en modo local (punto 7)?
No.

---

*Documentos técnicos completos, para quien quiera el detalle: registros de decisión ADR-024-001, ADR-024-002 y ADR-024-005, y el mapa de autoridad de datos.*
