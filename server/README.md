# Servidor del Gestor logístico

API y base de datos del Gestor logístico de OxEye: eventos, tareas (montaje, entregas, transporte, desmontaje) con sus dependencias, lugares, empresas, usuarios y registro de actividad. Es un único servicio (Hono + PostgreSQL) que se ejecuta igual en el portátil y en el servidor externo; toda la configuración sale de variables de entorno.

El simulador de OxEye no depende de este servidor: la web publicada sigue funcionando sin él.

## Requisitos

- Node.js 26 (ejecuta TypeScript directamente; no hay paso de compilación).
- Docker Desktop (o Docker Engine con Compose v2) para PostgreSQL 17. **Opcional en el portátil**: sin Docker se puede usar la base local embebida (siguiente apartado).

## Sin Docker: base local embebida

Para probar en un portátil sin Docker. Es PostgreSQL de verdad (PGlite), pero dentro del propio proceso y guardado en `server/pgdata/pglite` (no se sube a Git). Solo para desarrollo: el servidor lo rechaza con `NODE_ENV=production`.

1. En `server/.env`, cambia la línea `DATABASE_URL` por `DATABASE_URL=pglite:./pgdata/pglite`.
2. Desde la raíz del repositorio:

```sh
npm --prefix server install                 # dependencias del servidor
npm --prefix server run db:migrate          # crea las tablas
npm --prefix server run db:seed             # organización, 6 usuarios y datos de demostración
npm --prefix server run dev                 # API en http://localhost:8787
```

No hace falta `db:up`. La base local solo admite un proceso a la vez: para la API (Ctrl+C) antes de lanzar `db:migrate`, `db:seed` o `db:clear-demo`; si no, el comando lo avisa. Al arrancar, la API aplica sola las migraciones pendientes. Para empezar de cero, para la API y borra la carpeta `server/pgdata`.

## Primera puesta en marcha (con Docker)

Desde la raíz del repositorio:

```sh
npm --prefix server ci                      # dependencias del servidor
cp server/.env.example server/.env          # configuración local (no se sube a Git)
npm --prefix server run db:up               # PostgreSQL en el puerto 5433
npm --prefix server run db:migrate          # crea las tablas
npm --prefix server run db:seed             # organización, 6 usuarios y datos de demostración
npm --prefix server run dev                 # API en http://localhost:8787
```

`db:seed` imprime **una sola vez** la contraseña de cada usuario nuevo (Elvis, Dailos, Yeray, Equipo, Invitado y Fabián) con sus roles. Apúntalas: no se guardan en claro en ningún sitio. Las personales son **provisionales**: cada persona la cambia en «Tu espacio en OxEye» al entrar. Las de **Equipo** e **Invitado** son cuentas compartidas: nadie que las use puede cambiarlas; solo administración o desarrollo, desde «Usuarios». Si se pierden, `npm --prefix server run db:seed -- --reset-passwords` genera otras y cierra las sesiones abiertas; también puede hacerlo una persona de administración o desarrollo desde «Usuarios», cuenta por cuenta.

Comprobación: `http://localhost:8787/api/health` responde `{"status":"ok","database":"ok","version":"0.1.0"}`.

Después arranca la web con `npm run dev` y abre `http://localhost:5173/gestor-logistico`.

## Uso diario

| Qué                                             | Comando                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Arrancar la base de datos                       | `npm --prefix server run db:up`                                            |
| Arrancar la API (se recarga al guardar)         | `npm --prefix server run dev`                                              |
| Parar la base de datos (los datos se conservan) | `npm --prefix server run db:down`                                          |
| Ver el registro de PostgreSQL                   | `npm --prefix server run db:logs`                                          |
| Aplicar migraciones nuevas                      | `npm --prefix server run db:migrate`                                       |
| Borrar los datos de demostración                | `npm --prefix server run db:clear-demo`                                    |
| Base de datos y API en Docker                   | `docker compose -f server/docker-compose.yml --profile full up -d --build` |
| Tests (sin Docker: PostgreSQL en memoria)       | `npx vitest run --root server`                                             |

**Al actualizar el código** (por ejemplo, al llegar las tareas y el calendario, o los contactos y el catálogo): para la API, ejecuta `db:migrate` y después `db:seed`. Las migraciones nuevas solo añaden tablas y columnas, así que los datos existentes se conservan; `db:seed` conserva los usuarios y contraseñas existentes, da a la organización las 15 categorías de serie y añade al evento demo lo que le falte (tareas; empresas, personas y ofertas de demostración), una sola vez. Con «Roles y acceso» (migración `0009_roles_access.sql`) las contraseñas existentes pasan a ser provisionales y `db:seed` crea el usuario Fabián (imprime su contraseña una vez) y asigna los roles del piloto.

**Datos de demostración**: se borran desde la app («Borrar datos de demostración») o con `db:clear-demo`. Una vez borrados, la base de datos lo recuerda y `db:seed` (también con `--reset-passwords`) ya no los vuelve a crear; lo indica con una línea «Datos de demostración: se borraron el …». Los registros reales que tenían un enlace a la demo se conservan y lo pierden: tareas (su evento, una tarea previa o su contacto), personas (el evento demo) y empresas (su contacto principal). Quedan en «Actividad reciente» como modificados por quien borró la demo («Sistema» si fue con `db:clear-demo`). Las personas y empresas de demostración son ficticias (teléfonos `+34 000 000 00X`, correos `@example.com`); si una tarea real usa una de ellas, pasa a ser real y no se borra.

**Invitado** solo consulta: ve el plan (tareas con el nombre de la empresa, lugares, inventario, notas), pero no Contactos ni Catálogo (el servidor responde 403 y la búsqueda no los devuelve), ni la persona de contacto de una tarea, ni fotos de perfil, observaciones, precios, costes o condiciones: el servidor los envía vacíos con `restricted: true`. No tiene perfil ni puede cambiar su contraseña.

## Cuentas, roles y correo

Cada persona entra con su **nombre de usuario** (el nombre con el que se creó; no cambia nunca, da igual mayúsculas o minúsculas). El nombre visible, la descripción, el color y la foto se cambian en «Mi cuenta».

Los roles son por organización y se suman:

| Rol            | Qué permite                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Administración | Editar el plan, Contactos y Catálogo, presupuesto, aprobar ofertas, usuarios y roles, soporte                           |
| Desarrollo     | Editar el plan, Contactos y Catálogo, ver el presupuesto, ayudar a entrar (contraseña provisional, enlace), diagnóstico |
| Equipo         | Editar el plan, Contactos y Catálogo                                                                                    |

Mientras la contraseña sea provisional, presupuesto, aprobación de ofertas, usuarios, soporte y diagnóstico quedan retenidos hasta cambiarla. `db:seed` asigna los roles del piloto una sola vez; si después alguien de administración los cambia, `db:seed` ya no los toca.

**Sesión de soporte**: una persona de administración puede entrar como otra cuenta durante 5 a 30 minutos, repitiendo su contraseña y con un motivo. La cuenta lo ve en su historial de seguridad y en sus sesiones y puede cerrarla; en soporte no se llega a la contraseña, el correo, las sesiones, el perfil ni la administración. **Ver como Invitado** abre durante 30 minutos exactamente lo que ve Invitado.

**Correo**: «¿Olvidaste tu contraseña?» manda un enlace de un solo uso, válido 30 minutos, al correo personal verificado de la cuenta o, si no tiene, al buzón del proyecto (`RECOVERY_FALLBACK_EMAIL`). La respuesta es siempre la misma, exista o no la cuenta. Restablecer cierra todas las sesiones de esa cuenta. Los correos son texto en español, firmados «OxEye», y nunca llevan una contraseña.

Sin `SMTP_HOST` no se envía nada: en desarrollo el enlace aparece en la consola de la API; en producción solo «Correo pendiente para y•••@… (SMTP sin configurar)». Desde «Usuarios», el enlace para restablecer se muestra en pantalla para pasarlo en mano.

**Enviar con Gmail (contraseña de aplicación)**

1. Con la cuenta de Google del proyecto, activa la verificación en dos pasos: <https://myaccount.google.com/security>.
2. Crea una contraseña de aplicación en <https://myaccount.google.com/apppasswords> (nombre, por ejemplo, «OxEye»). Google muestra 16 letras una sola vez.
3. En `server/.env` (nunca en el repositorio):
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=<la cuenta de Gmail>
   SMTP_PASS=<las 16 letras, sin espacios>
   MAIL_FROM=OxEye <la cuenta de Gmail>
   RECOVERY_FALLBACK_EMAIL=<buzón del proyecto>
   PUBLIC_APP_URL=<dirección de la web, sin /gestor-logistico ni #>
   ```
4. Reinicia la API: al arrancar indica «Correo de cuentas: SMTP smtp.gmail.com:465».

Si la contraseña de aplicación se filtra, revócala en la misma página y crea otra. Con el puerto 587, `SMTP_SECURE=false` (la API exige STARTTLS).

**Empezar de cero** (borra todos los datos locales): `npm --prefix server run db:down`, elimina la carpeta `server/pgdata` y repite migrate y seed.

## Desde el móvil en la misma Wi-Fi

1. Arranca la base de datos y la API como arriba.
2. Arranca la web expuesta a la red: `npm run dev -- --host`. Vite muestra una dirección del tipo `http://192.168.1.23:5173`.
3. Abre en el móvil `http://192.168.1.23:5173/gestor-logistico`.

El móvil solo habla con Vite, que reenvía `/api` a `http://localhost:8787`; no hace falta tocar CORS. Si no carga, permite Node.js en el cortafuegos de Windows para redes privadas.

## Probar con el equipo desde fuera

Para que alguien del equipo pruebe el Gestor desde su móvil u ordenador, esté donde esté, mientras la API y la web corren en tu PC. Usa un túnel rápido de Cloudflare: una dirección `https://….trycloudflare.com` con HTTPS que llega a tu PC sin abrir puertos en el router. **Solo para pruebas**: no tiene garantía de disponibilidad y no sustituye al servidor externo.

Por el túnel solo pasa la web; la API sigue escuchando únicamente en tu PC y la web le reenvía `/api` por dentro. La web se compila en modo producción, así que también se puede probar el modo sin cobertura (necesita HTTPS, que pone el túnel).

**Una vez**

1. Instala la herramienta del túnel (es un programa de tu PC, no una dependencia del proyecto) y abre una terminal nueva:
   ```
   winget install --id Cloudflare.cloudflared
   ```
2. La base de datos lista como en «Sin Docker» o «Primera puesta en marcha» (migrate y seed hechos).
3. Recomendado: `HOST=127.0.0.1` en `server/.env`, para que la API no sea accesible desde la red aunque la arranques a mano.

**Cada vez**

```
npm run equipo
```

Arranca la API (o usa la que ya esté en marcha), compila la web, la sirve en `http://127.0.0.1:4173` y abre el túnel. Cuando está listo muestra un recuadro con la dirección para el equipo, ya con `/gestor-logistico`. Ábrela tú primero en el móvil con datos móviles (sin Wi-Fi) e inicia sesión; después mándala. **Ctrl+C** lo para todo.

| Por partes (para ver qué falla), cada uno en su terminal | Comando                |
| -------------------------------------------------------- | ---------------------- |
| API                                                      | `npm run equipo:api`   |
| Web compilada en `http://127.0.0.1:4173`                 | `npm run equipo:web`   |
| Túnel (muestra la dirección en el registro)              | `npm run equipo:tunel` |

**A tener en cuenta**

- Tu PC tiene que estar encendido, sin suspenderse y con la terminal abierta.
- La dirección cambia cada vez que arrancas: hay que reenviarla.
- Si cambias el código, para y vuelve a lanzar `npm run equipo` (compila de nuevo).
- Cada persona entra con su usuario y la contraseña que generó `db:seed` (provisional: la cambia al entrar).
- «¿Olvidaste tu contraseña?» no manda enlace por el túnel (su dirección cambia cada vez y la API no la conoce); usa «Usuarios › Enlace para restablecer» desde una cuenta de administración o desarrollo.
- La API ve todas las peticiones como si vinieran de tu PC, así que el límite de intentos de acceso es compartido: si alguien falla varias veces la contraseña, el bloqueo temporal afecta a todos.
- Los datos viajan cifrados, pero pasan por Cloudflare. Para la jornada real, el servidor externo.

**Problemas**

| Qué ves                                        | Qué hacer                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| «No encuentro cloudflared»                     | Instálalo con `winget` (arriba) y abre una terminal nueva.                                                           |
| «La API no responde»                           | Revisa `server/.env` (`DATABASE_URL`) y que la base de datos esté arrancada (o la carpeta de PGlite).                |
| «El puerto 4173 ya está ocupado»               | Cierra la otra ventana con `npm run preview` o `equipo:web`.                                                         |
| La dirección abre, pero dice «Blocked request» | El túnel no reescribe el host: usa `npm run equipo` o `equipo:tunel`, no el comando a mano sin `--http-host-header`. |
| Entra la web, pero no se puede iniciar sesión  | La API se ha parado: mira las líneas `[api]`.                                                                        |
| La dirección no responde nada                  | Espera unos segundos tras el recuadro; si sigue, Ctrl+C y vuelve a lanzar.                                           |

## Paso al servidor externo

Se usa la misma imagen y otro `.env`:

1. En el servidor, copia el repositorio (o solo `server/` y `shared/logistics/`) y crea `server/.env` a partir de `.env.example` con:
   - contraseñas largas y aleatorias en `POSTGRES_PASSWORD` y en `DATABASE_URL`;
   - `NODE_ENV=production`;
   - `CORS_ORIGINS` con la dirección real de la web (por ejemplo `https://usuario.github.io`);
   - `TRUST_PROXY` con el número de proxies inversos que hay delante de la API: `false` si no hay ninguno, `true` (o `1`) con un nginx o Caddy en el propio servidor, `2` si además hay otro delante (por ejemplo, una CDN). La API toma la IP del cliente de la entrada de `X-Forwarded-For` que añadió el proxy de confianza (contando desde la derecha) e ignora las que el navegador pueda inventar a la izquierda. Esa IP solo se usa para limitar los intentos de acceso.
   - El contenedor de la API solo escucha en `127.0.0.1:8787`: el proxy del propio servidor llega a él y nadie puede saltárselo desde fuera para inventarse una IP. Solo si no hay proxy y necesitas abrirlo, define `API_BIND=0.0.0.0` (y entonces `TRUST_PROXY=false`).

   Sin `server/.env`, Docker Compose usa la contraseña local de ejemplo (`oxeye_local_only`). En el servidor externo no arranques nunca sin ese archivo.

2. `docker compose -f server/docker-compose.yml --profile full up -d --build`. El contenedor aplica las migraciones al arrancar (`MIGRATE_ON_START=true`).
3. `docker compose -f server/docker-compose.yml exec api node src/cli/seed.ts` para crear los usuarios y anotar sus contraseñas.
4. Publica la API con HTTPS mediante un proxy inverso (Caddy, nginx). PostgreSQL queda accesible solo desde la propia máquina.

### Servir la web en el servidor del piloto

Las direcciones del Gestor son rutas normales (`/gestor-logistico`, `/gestor-logistico/calendario/2026-12-02`, `/gestor-logistico/tareas/ficha/tarea/<id>`), no fragmentos `#`. Quien sirva la web compilada (`dist/`) tiene que devolver `index.html` para **cualquier ruta que no sea un archivo existente ni `/api`**; si no, recargar o abrir un enlace guardado da «404».

- nginx:
  ```nginx
  location /api/ { proxy_pass http://127.0.0.1:8787; }
  location /     { try_files $uri $uri/ /index.html; }
  ```
- Caddy:
  ```
  handle /api/* { reverse_proxy 127.0.0.1:8787 }
  handle {
    root * /ruta/a/dist
    try_files {path} /index.html
    file_server
  }
  ```

`npm run dev`, `vite preview` y `npm run equipo` ya lo hacen solos. Si la web vive en una subcarpeta (por ejemplo `/oxeye/`), la regla apunta a `/oxeye/index.html` y `PUBLIC_APP_URL` incluye esa subcarpeta.

Los enlaces de los correos y de los formularios de proveedor llevan el código secreto después de `#` (`…/gestor-logistico/cuenta/restablecer#<código>`, `…/gestor-logistico/proveedor#<código>`): esa parte nunca se envía al servidor, así que no aparece en los registros del proxy ni del túnel. Los enlaces antiguos con `#logistica` (correos ya enviados, marcadores, la app instalada) siguen funcionando: la web los abre en el mismo sitio y cambia la dirección a la nueva.

## Problemas frecuentes

- **`ECONNREFUSED` en migrate o seed**: la base de datos no está arrancada o aún no está lista. `npm --prefix server run db:up` espera a que esté sana.
- **`Configuración no válida`**: falta `server/.env` o alguna variable tiene un formato incorrecto; el mensaje dice cuál.
- **El puerto 5433 u 8787 está ocupado**: cambia el puerto en `docker-compose.yml` / `PORT` y en `DATABASE_URL`.
- **PostgreSQL no arranca en Windows por permisos de `pgdata`**: cambia el volumen `./pgdata` por un volumen con nombre en `docker-compose.yml` (los datos quedarán dentro de Docker).
- **`La migración … ha cambiado`**: alguien editó una migración ya aplicada. Las migraciones no se editan: se deshace el cambio y se añade una nueva.
- **`429 Demasiados intentos fallidos`**: tras 5 contraseñas erróneas para un usuario (o 20 desde la misma red) hay que esperar 10 minutos, o reiniciar la API.
