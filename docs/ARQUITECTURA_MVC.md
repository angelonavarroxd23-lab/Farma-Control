# FarmaControl — Organización MVC

La arquitectura de despliegue sigue siendo de **tres capas** (navegador → API REST en Node.js → SQL Server, decisiones AD-01…AD-08).
El código se organiza con el patrón **Modelo–Vista–Controlador**, visible desde la raíz del repositorio:

| Capa MVC | Carpeta | Responsabilidad |
|---|---|---|
| **Modelo** | `models/` | Reglas de negocio y acceso a datos: `schema`, `validate`, `inventario`, `reportes`, `util`, `errors`, `seed`, y los almacenes `mssql.js` (SQL Server, producción) y `memory.js` (solo pruebas). |
| **Vista** | `views/` | SPA en HTML, CSS y módulos JavaScript (`views/js/pages/`). Solo llama a la API; nunca conoce credenciales de la base. |
| **Controlador** | `controllers/` + `routes/index.js` | `routes/index.js` asocia método + URL + permiso con un método de controlador; cada controlador valida la entrada, invoca a los modelos y devuelve la respuesta. |

Soporte: `config/` (configuración desde `.env`), `lib/auth/` (scrypt, JWT, permisos), `lib/http/` (enrutador y utilidades), `app.js` (autenticación,
autorización y auditoría de accesos denegados) y `server.js` (punto de entrada).

Flujo de una petición: **Vista** (`fetch`) → `app.js` → `routes/index.js` → **Controlador** → **Modelo** (`mssql.js`) → SQL Server
(procedimientos `sp_RegistrarCompra`, `sp_RegistrarVenta`, `sp_AnularVenta`).

| Controlador | Rutas |
|---|---|
| authController | `/api/health`, `/api/auth/*` |
| usuariosController | `/api/roles`, `/api/usuarios` |
| clientesController · proveedoresController · recetasController | `/api/clientes`, `/api/proveedores`, `/api/recetas` |
| catalogoController | `/api/categorias`, `/api/medicamentos`, `/api/lotes` |
| comprasController · ventasController | `/api/compras`, `/api/ventas` (incl. anulación) |
| inventarioController | `/api/movimientos`, `/api/alertas` |
| reportesController | `/api/resumen`, `/api/reportes/*` (incl. CSV) |
| auditoriaController | `/api/auditoria` |

**Alcance de la conversión:** reorganización del código; la API (44 rutas), las reglas de negocio y el script SQL no cambiaron.
Verificación: 51 pruebas aprobadas con el controlador en memoria tras la conversión; la ejecución contra SQL Server 2022 la realiza
el workflow `.github/workflows/ci.yml` (trabajo `pruebas-sqlserver`), visible en la pestaña *Actions*.
