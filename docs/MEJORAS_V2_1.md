# FarmaControl · Mejoras de la versión 2.1 (23-nov-2026)

Documento de cambios posterior a las observaciones del docente. **Importante:** el texto exacto de la observación del docente no se tiene; las mejoras se basan en una **interpretación** de la conversación del equipo («poner la receta ahí mismo, donde se hace la compra», «hacer la receta», «sobre el lote», «nuestro proveedor de…»). Conviene confirmarlas con el docente.

## 1. Qué se interpretó y qué se implementó
| Observación (interpretada) | Implementación | Dónde |
|---|---|---|
| Registrar la receta en el mismo lugar donde se hace la venta | Botón **+ Nueva receta** en *Nueva venta*; la receta queda seleccionada. El **cajero** puede registrarla (antes solo químico/administrador) | `views/js/pages/venta.js`, `recetaForm.js`; permiso `recetas:create` |
| «Hacer la receta»: que la receta tenga contenido | Tabla `DetalleReceta` (medicamento, cantidad, indicaciones); consulta con prescrito / dispensado / pendiente | `models/recetas.js`, `recetasController.js` |
| La venta debe respetar la receta | Con detalle: solo medicamentos prescritos y hasta el saldo pendiente (error 422 si no). Recetas sin detalle conservan la regla anterior | `ventasController.js` |
| «Sobre el lote»: crear el lote al comprar | En *Compras*, pestaña **Lote nuevo**: el lote se crea con la compra y recibe sus unidades | `comprasController.js`, `compras.js` |
| «Nuestro proveedor»: relacionarlo con lote/medicamento | `Lote.proveedor_id` (se completa al comprar), `Medicamento.proveedor_id` (habitual); proveedor creable desde *Compras* | `schema.js`, SQL, `catalogo.js` |
| Reposición a proveedor (caso de negocio BN-04, antes sin soporte) | Pantalla *Reposición*: sugerencias + órdenes; la orden pasa a «Recibida» al registrar su compra | `ordenesController.js`, `reposicion.js` |
| Despachar primero lo que vence antes | Lotes ordenados por vencimiento, badge **FEFO** y aviso al elegir otro lote; botón «Agregar pendiente» usa FEFO. Es una **sugerencia**, el servidor no la impone | `inventario.js`, `venta.js` |

## 2. Cambios en la base de datos
- Tablas nuevas: `DetalleReceta`, `OrdenReposicion`, `DetalleOrdenReposicion` → **17 tablas**, **28 claves foráneas** (antes 14 y 19).
- Columnas nuevas (NULL): `Lote.proveedor_id`, `Medicamento.proveedor_id`.
- Restricciones nuevas: `UQ_DetReceta_Med`, `CK_DetReceta_Cantidad`, `CK_Orden_Estado`, `CK_Orden_Recibida` (RECIBIDA exige compra), `UQ_DetOrden_Med`, `CK_DetOrden_Cantidad`.
- El script sigue siendo re-ejecutable y **migra** una base v2.0 sin borrar datos. Los **procedimientos almacenados no cambiaron**.
- `FarmaControl_UsuarioAplicacion.sql`: permisos para las tablas nuevas y `DELETE` acotado (solo para compensar operaciones que fallan a medias).

## 3. Decisiones y límites (leer antes de la defensa)
1. **Reglas fuera del procedimiento almacenado.** La regla del saldo de receta y la creación del lote dentro de la compra viven en la API (Node), no en T-SQL. Dos ventas simultáneas con la misma receta podrían superar el saldo; la regla anterior (receta vigente y del cliente) sí está en el procedimiento.
2. **Compensación, no transacción única.** Si la compra falla después de crear un lote nuevo, la API lo elimina. Si falla la actualización posterior (proveedor del lote u orden), la compra queda registrada y la respuesta incluye `advertencias`.
3. **Cambio de permisos:** el cajero ahora registra recetas (necesario para hacerlo «ahí mismo»); anular o modificar sigue siendo de químico/administrador. Se revierte cambiando una línea en `lib/auth/permissions.js`.
4. **Sugerencia de reposición:** reponer cuando existencias vendibles (lotes no vencidos) ≤ suma de stocks mínimos; cantidad = `max(2 × mínimo − vendible, mínimo)`. Es una regla propuesta, no validada con el docente.
5. Las órdenes de reposición **no se envían** al proveedor (sin correo ni integración); son un registro interno.

## 4. Estado de verificación
| Verificación | Resultado |
|---|---|
| `npm test` (controlador en memoria) | **68 aprobadas, 0 fallidas, 15 omitidas** (las 15 son de integración con SQL Server). Evidencia: `docs/evidencias/pruebas_automatizadas_memoria.txt` |
| Recorrido de interfaz (receta en caja → venta con FEFO → reposición → compra con lote nuevo y orden) | Ejecutado con navegador automatizado contra la API en memoria **y** contra la demostración de GitHub Pages construida localmente: sin errores de consola |
| Script SQL v2.1, `db:check`, `npm run test:sqlserver` (83 pruebas) | **No ejecutados.** Requieren SQL Server; pendiente en el equipo o en *Actions* |
| Informe, manual, diagramas y matrices de requisitos | **No actualizados** a la versión 2.1 (describen 14 tablas, 62 pruebas y la estructura anterior) |
