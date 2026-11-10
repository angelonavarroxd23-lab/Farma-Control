# FarmaControl 2.0 — Sistema de gestión de ventas de farmacia

Proyecto académico (UPN · Diseño y Arquitectura de Software · 2026-2). Todos los datos son ficticios.
Arquitectura de tres capas: **vista** (SPA en JavaScript) → **API REST** (Node.js) → **SQL Server**.

## ▶ Ejecutar en GitHub (enlace para visualizar)
[![Abrir en GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/angelonavarroxd23-lab/desarrollo-de-software?quickstart=1)

1. Pulse el botón (requiere iniciar sesión en GitHub). Se crea un entorno con Node.js 22 y **SQL Server 2022** en contenedor.
2. Espere a que la terminal muestre `FarmaControl API en http://localhost:3000 (base de datos: mssql)` (la primera vez tarda unos minutos).
3. Se abre el navegador con la aplicación; si no, pestaña **PORTS** → puerto **3000** → icono del globo. Ese es el enlace (`https://…-3000.app.github.dev`).
4. Para compartirlo con otra persona: clic derecho en el puerto 3000 → *Port Visibility* → *Public*.

El script `scripts/codespace-start.sh` genera un `.env` con contraseñas aleatorias (no se suben al repositorio), inicia SQL Server, ejecuta
`db:setup` y `db:check` y arranca la aplicación. Usuarios de demostración en la sección 7. Detenga el Codespace al terminar para no consumir horas gratuitas.
GitHub Pages **no** sirve: solo publica archivos estáticos y FarmaControl necesita el servidor Node.js y SQL Server.

> **Estado de verificación (léase antes de evaluar el proyecto)**
> | Componente | Estado | Evidencia |
> |---|---|---|
> | API + reglas de negocio contra **SQL Server 2022** | Verificado: **62/62 pruebas aprobadas** (51 de API + 11 de integración que consultan las tablas) | `docs/evidencias/pruebas_automatizadas_sqlserver.txt` |
> | Base de datos (14 tablas, 19 FK, 3 procedimientos, 5 vistas, 0 disparadores) | Verificada con `npm run db:check` | `docs/evidencias/db_check_sqlserver.txt` |
> | Interfaz web conectada a SQL Server | Recorrido automatizado con Edge: 18/18 pasos, contrastados con consultas a la base | `docs/evidencias/recorrido_ui_sqlserver.txt`, `docs/capturas_sqlserver/` |
> | Controlador en memoria (solo pruebas/vista previa) | 51 aprobadas, 11 de integración omitidas | `docs/evidencias/pruebas_automatizadas_memoria.txt` |
>
> **Conversión a MVC (9-nov-2026):** posterior a la verificación en SQL Server de la tabla anterior. Tras la conversión se comprobaron 51 pruebas en memoria; la ejecución contra SQL Server la hace el workflow de *Actions* (`pruebas-sqlserver`) y, en su PC, `npm run test:sqlserver`.
>
> **Reservas honestas:** la instancia usada es SQL Server 2022 **Evaluation** (caduca a los ~180 días; recomendable pasar a Developer);
> las pruebas se ejecutaron con una cuenta administradora (Autenticación de Windows). El script de cuenta de mínimo privilegio y
> `DB_AUTH=sql` **no se han ejecutado**. Pendientes del equipo: aprobación con usuarios, pruebas de usabilidad con participantes,
> video, repositorio público y prueba de impresión física de la constancia.

## 1. Requisitos
- **Node.js 20 o superior** (desarrollado con Node 22) y npm.
- **SQL Server 2019 o superior** (Express, Developer o Evaluation); verificado en 2022. SSMS es opcional.
- Autenticación de Windows (`DB_AUTH=windows`, requiere *ODBC Driver 18 for SQL Server*; no necesita TCP/IP) o usuario SQL (`DB_AUTH=sql`, requiere modo mixto y TCP/IP).
- Navegador moderno (Chrome, Edge, Firefox).

## 2. Tecnologías
Node.js (módulos `http`, `crypto`, `node:test`), `mssql` (tedious; `msnodesqlv8` opcional para Autenticación de Windows), SQL Server (T-SQL),
frontend en HTML + CSS + JavaScript ES modules sin framework. Hash de contraseñas con scrypt, tokens JWT HS256.

## 3. Estructura de carpetas (patrón MVC)
```
FarmaControl/
├── models/             MODELO: reglas de negocio y acceso a datos
│                       (schema, validate, inventario, reportes, util, errors, mssql = SQL Server, memory = pruebas, seed)
├── views/              VISTA: SPA (index.html, css/, js/, js/pages/) y serve.js opcional
├── controllers/        CONTROLADOR: auth, usuarios, clientes, proveedores, catalogo, recetas, compras,
│                       ventas, inventario, reportes, auditoria (+ presenters.js)
├── routes/index.js     Tabla de rutas: método + URL + permiso → método del controlador
├── config/config.js    Lectura de .env y validación de la configuración
├── lib/                Servicios transversales: auth/ (scrypt, JWT, permisos) y http/ (enrutador, utilidades)
├── app.js · server.js  Aplicación HTTP (autenticación, permisos, auditoría) y punto de entrada
├── scripts/            db:setup, db:check, db:reset, lanzador de pruebas, modo memoria
├── tests/              62 pruebas automatizadas (51 de API + 11 de integración con SQL Server)
├── database/           FarmaControl_Database.sql · _UsuarioAplicacion.sql · _Reset.sql
├── docs/               Informe, manual, arquitectura (incl. ARQUITECTURA_MVC.md), evidencias, capturas, diagramas
├── original/           Recursos de la entrega anterior, conservados sin modificar
├── .github/workflows/  CI: pruebas en memoria y contra SQL Server 2022 (GitHub Actions)
└── package.json · .env.example
```

## 4. Base de datos
Desde la carpeta del proyecto (usa `.env`; con `DB_AUTH=windows` no hay contraseñas):
```
npm run db:setup            # ejecuta database/FarmaControl_Database.sql (crea FarmaControlBD, 14 tablas, procedimientos, vistas y datos). Re-ejecutable
npm run db:check            # verifica tablas, FK, CHECK, procedimientos, vistas, índices, 0 disparadores, usuarios y coherencia de stock
npm run db:reset -- --confirmar   # BORRA y recrea la base (solo desarrollo; úselo antes de grabar el video)
```
Alternativa manual: `sqlcmd -S localhost -E -i database/FarmaControl_Database.sql`.
Cuenta de aplicación con privilegios mínimos (recomendada, **no ejecutada en esta entrega**): `database/FarmaControl_UsuarioAplicacion.sql`.

**Modelo:** 13 tablas del informe original + `AuditoriaOperacion` (RF-18). Cambios justificados en el encabezado del script.

## 5. Configuración
```
cd FarmaControl
npm install
copy .env.example .env      # Linux/macOS: cp .env.example .env
```
Edite `.env`: `DB_DRIVER=mssql`, `DB_AUTH` (`windows` o `sql`), `DB_SERVER` (p. ej. `DESKTOP-0L15125` o `localhost`), `DB_NAME=FarmaControlBD`,
`DB_USER`/`DB_PASSWORD` solo si `DB_AUTH=sql`, y `JWT_SECRET` (genere uno con
`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`).
**Las credenciales viven solo en `.env` (raíz del proyecto)** (excluido del control de versiones y de la entrega); el navegador nunca las recibe.
**No hay respaldo silencioso:** si SQL Server no responde, `npm start` termina con un error claro y no cambia a memoria.

## 6. Ejecución
```
npm start                   # http://localhost:3000  (sirve API y frontend)
```
Abra `http://localhost:3000`. Frontend por separado (opcional): `node views/serve.js` (puerto 5173), definir
`CORS_ORIGIN=http://localhost:5173` en `.env` y definir `window.FARMACONTROL_API` en `views/js/config.js`.
Vista previa **sin SQL Server** (solo demostración, datos volátiles, opt-in explícito): `npm run start:memory`.
Comprobación: `http://localhost:3000/api/health` debe mostrar `"driver":"mssql"`.

## 7. Usuarios de demostración (solo entorno de prueba)
| Perfil | Correo | Contraseña |
|---|---|---|
| Administrador | admin@farmacontrol.local | Admin#2026Fc |
| Cajero | cajero@farmacontrol.local | Cajero#2026Fc |
| Almacenero | almacen@farmacontrol.local | Almacen#2026Fc |
| Químico farmacéutico | quimico@farmacontrol.local | Quimico#2026Fc |

En la base solo se guardan hashes scrypt. **Cambie estas contraseñas antes de cualquier uso fuera del aula.**

## 8. Pruebas
```
npm run test:sqlserver      # 62 pruebas contra SQL Server (51 de API + 11 de integración SQL-01…SQL-11), en serie
npm test                    # 51 pruebas con el controlador en memoria (11 de integración omitidas)
```
Se ejecutan en serie (`--test-concurrency=1`) porque comparten la base. `test:sqlserver` crea datos con códigos únicos y es repetible,
pero **modifica la base configurada**; úselo solo en desarrollo. Resultado real (9-nov-2026, SQL Server 2022 Evaluation, Node v24.22.0):
62 aprobadas, 0 fallidas, 0 omitidas (`docs/evidencias/pruebas_automatizadas_sqlserver.txt`).

## 9. Reglas de negocio garantizadas
Venta ≤ stock disponible; no se venden lotes vencidos; compras suman y ventas restan; anulación repone el stock una sola vez
(motivo obligatorio, solo Administrador); movimientos sin duplicar (índices únicos filtrados) y con origen, lote y responsable;
receta vigente, válida y del mismo cliente para medicamentos con receta; alertas calculadas del estado real; compras, ventas y
anulaciones transaccionales (procedimientos con `XACT_ABORT`, `UPDLOCK/HOLDLOCK`).
Las constancias son comprobantes **simulados**, sin integración tributaria.

## 10. Solución de errores frecuentes
| Síntoma | Causa probable y solución |
|---|---|
| `JWT_SECRET debe definirse…` | Falta o es corto el secreto en `.env` (mínimo 32 caracteres). |
| `No se pudo conectar a SQL Server…` | Instancia detenida, `DB_SERVER` incorrecto o base inexistente (ejecute `npm run db:setup`). El sistema no cambia de almacenamiento. |
| `Login failed for user` | Con `DB_AUTH=sql`: credenciales erróneas o modo mixto deshabilitado. Con `windows`: su usuario no tiene acceso a la instancia. |
| `ECONNREFUSED` (solo `DB_AUTH=sql`) | TCP/IP deshabilitado: actívelo en el Administrador de configuración de SQL Server y reinicie el servicio, o use `DB_AUTH=windows`. |
| `msnodesqlv8` / `Data source name not found` | Instale *ODBC Driver 18 for SQL Server* y ejecute `npm install` (módulo opcional); o defina `DB_ODBC_DRIVER`. |
| `self-signed certificate` | Use `DB_TRUST_SERVER_CERT=true` (desarrollo). |
| `Cannot open database "FarmaControlBD"` | No se ejecutó `npm run db:setup`, o la cuenta no tiene acceso. |
| Error 429 al iniciar sesión | Límite de intentos fallidos; espere unos minutos. |
| Pantalla en blanco | Abra `http://localhost:3000` (no el HTML directamente); revise la consola del navegador. |
