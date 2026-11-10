# FarmaControl — Organización MVC

La arquitectura de despliegue sigue siendo de **tres capas** (navegador → API REST en Node.js → SQL Server, decisiones AD-01…AD-08).
MVC organiza el código **dentro** de esas capas:

| Capa MVC | Dónde está | Responsabilidad |
|---|---|---|
| **Vista** | `frontend/` (HTML, CSS y módulos JS en `frontend/js/pages/`) | Pantallas que ve el usuario; solo llama a la API, nunca a la base. |
| **Controlador** | `backend/src/controllers/*Controller.js` + `backend/src/routes.js` | `routes.js` asocia método + URL + permiso con un método del controlador; cada controlador valida la entrada, aplica el caso de uso y devuelve la respuesta. |
| **Modelo** | `backend/src/models/` | Reglas de negocio y acceso a datos: `schema`, `validate`, `inventario`, `reportes`, `util`, `errors`, y los almacenes `mssql` (producción) y `memory` (pruebas). |

Servicios transversales: `backend/src/auth/` (contraseñas scrypt, JWT, permisos) y `backend/src/http/` (enrutador, utilidades HTTP).

```
backend/src/
├── routes.js              tabla de rutas  → controladores
├── controllers/           auth, usuarios, clientes, proveedores, catalogo, recetas,
│                          compras, ventas, inventario, reportes, auditoria (+ presenters.js)
├── models/                schema, validate, inventario, reportes, util, errors, mssql, memory, seed
├── auth/  http/           servicios transversales
├── app.js  server.js  config.js
```

Flujo de una petición: `Vista (fetch)` → `app.js` (autenticación, permisos, auditoría de accesos denegados) → `routes.js` → `Controlador` → `Modelo/Store` → SQL Server.

**Alcance honesto de la conversión:** es una reorganización del código; la API (44 rutas), las reglas de negocio y el script SQL no cambiaron.
La conversión se verificó con el controlador en memoria (51 pruebas aprobadas, 11 de integración omitidas). La ejecución contra SQL Server
tras la conversión la realiza el workflow de GitHub Actions `pruebas-sqlserver` (ver `.github/workflows/ci.yml`); su resultado figura en la pestaña *Actions* del repositorio.
