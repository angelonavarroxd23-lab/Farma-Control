'use strict';
// Metadatos del modelo físico (14 tablas). Se usan para: (1) validar entradas en el servidor,
// (2) construir sentencias SQL parametrizadas con identificadores de una lista cerrada
// (nunca derivados de la entrada del usuario) y (3) emular restricciones en el controlador de memoria.
// t: tipo | max: longitud | req: obligatorio | def: valor por defecto | auto: identidad
// ro: no escribible desde la API | ascii: VARCHAR/CHAR | enum | fk: tabla referenciada
const col = (t, o = {}) => ({ t, ...o });

const TABLES = {
  Rol: {
    pk: 'rol_id',
    cols: { rol_id: col('int', { auto: true }), nombre: col('str', { max: 40, req: true }), descripcion: col('str', { max: 180 }) },
    unique: [{ name: 'UQ_Rol_Nombre', cols: ['nombre'], label: 'el nombre del rol' }],
  },
  Usuario: {
    pk: 'usuario_id',
    cols: {
      usuario_id: col('int', { auto: true }), rol_id: col('int', { req: true, fk: 'Rol' }),
      nombres: col('str', { max: 120, req: true }), correo: col('str', { max: 160, req: true }),
      hash_contrasena: col('str', { max: 255, req: true, ro: true }), activo: col('bit', { def: true }),
    },
    unique: [{ name: 'UQ_Usuario_Correo', cols: ['correo'], label: 'el correo' }],
  },
  Cliente: {
    pk: 'cliente_id',
    cols: {
      cliente_id: col('int', { auto: true }),
      tipo_documento: col('str', { max: 3, req: true, ascii: true, enum: ['DNI', 'CE', 'RUC', 'OTR'] }),
      numero_documento: col('str', { max: 15, req: true, ascii: true }),
      nombre_razon_social: col('str', { max: 160, req: true }), telefono: col('str', { max: 20, ascii: true }),
    },
    unique: [{ name: 'UQ_Cliente_Doc', cols: ['tipo_documento', 'numero_documento'], label: 'el tipo y número de documento' }],
  },
  Proveedor: {
    pk: 'proveedor_id',
    cols: {
      proveedor_id: col('int', { auto: true }), ruc: col('str', { max: 11, req: true, ascii: true }),
      razon_social: col('str', { max: 180, req: true }), contacto: col('str', { max: 120 }),
      telefono: col('str', { max: 20, ascii: true }), activo: col('bit', { def: true }),
    },
    unique: [{ name: 'UQ_Proveedor_Ruc', cols: ['ruc'], label: 'el RUC' }],
  },
  Categoria: {
    pk: 'categoria_id',
    cols: { categoria_id: col('int', { auto: true }), nombre: col('str', { max: 90, req: true }) },
    unique: [{ name: 'UQ_Categoria_Nombre', cols: ['nombre'], label: 'el nombre de la categoría' }],
  },
  Medicamento: {
    pk: 'medicamento_id',
    cols: {
      medicamento_id: col('int', { auto: true }), categoria_id: col('int', { req: true, fk: 'Categoria' }),
      sku: col('str', { max: 30, req: true, ascii: true }), nombre: col('str', { max: 160, req: true }),
      principio_activo: col('str', { max: 160 }), presentacion: col('str', { max: 90, req: true }),
      precio_venta: col('dec', { req: true }), requiere_receta: col('bit', { def: false }), activo: col('bit', { def: true }),
    },
    unique: [{ name: 'UQ_Medicamento_Sku', cols: ['sku'], label: 'el SKU' }],
  },
  Receta: {
    pk: 'receta_id',
    cols: {
      receta_id: col('int', { auto: true }), cliente_id: col('int', { req: true, fk: 'Cliente' }),
      numero_receta: col('str', { max: 50, req: true, ascii: true }), nombre_prescriptor: col('str', { max: 160, req: true }),
      fecha_emision: col('date', { req: true }), fecha_vencimiento: col('date', { req: true }),
      estado: col('str', { max: 12, ascii: true, def: 'VALIDA', enum: ['VALIDA', 'ANULADA'] }), observacion: col('str', { max: 250 }),
    },
    unique: [{ name: 'UQ_Receta_Numero', cols: ['numero_receta'], label: 'el número de receta' }],
  },
  Lote: {
    pk: 'lote_id',
    cols: {
      lote_id: col('int', { auto: true }), medicamento_id: col('int', { req: true, fk: 'Medicamento' }),
      codigo_lote: col('str', { max: 60, req: true }), fecha_vencimiento: col('date', { req: true }),
      stock_actual: col('int', { def: 0, ro: true }), stock_minimo: col('int', { def: 5 }),
    },
    unique: [{ name: 'UQ_Lote_Codigo', cols: ['medicamento_id', 'codigo_lote'], label: 'el código de lote para ese medicamento' }],
  },
  Compra: {
    pk: 'compra_id',
    cols: {
      compra_id: col('int', { auto: true }), proveedor_id: col('int', { fk: 'Proveedor' }), usuario_id: col('int', { fk: 'Usuario' }),
      fecha: col('dt', { auto: true }), numero_documento: col('str', { max: 40, ascii: true }), total: col('dec'),
    },
    unique: [{ name: 'UQ_Compra_Documento', cols: ['proveedor_id', 'numero_documento'], label: 'el documento para ese proveedor' }],
  },
  DetalleCompra: {
    pk: 'detalle_compra_id',
    cols: {
      detalle_compra_id: col('int', { auto: true }), compra_id: col('int', { fk: 'Compra' }), lote_id: col('int', { fk: 'Lote' }),
      cantidad: col('int'), costo_unitario: col('dec'), subtotal: col('dec', { computed: true }),
    },
    unique: [],
  },
  Venta: {
    pk: 'venta_id',
    cols: {
      venta_id: col('int', { auto: true }), cliente_id: col('int', { fk: 'Cliente' }), usuario_id: col('int', { fk: 'Usuario' }),
      receta_id: col('int', { fk: 'Receta' }), fecha: col('dt', { auto: true }),
      tipo_comprobante: col('str', { max: 10, ascii: true }), numero_comprobante: col('str', { max: 30, ascii: true }),
      estado: col('str', { max: 12, ascii: true }), total: col('dec'), fecha_anulacion: col('dt'),
      usuario_anulacion_id: col('int', { fk: 'Usuario' }), motivo_anulacion: col('str', { max: 250 }),
    },
    unique: [{ name: 'UQ_Venta_Comprobante', cols: ['tipo_comprobante', 'numero_comprobante'], label: 'el comprobante' }],
  },
  DetalleVenta: {
    pk: 'detalle_venta_id',
    cols: {
      detalle_venta_id: col('int', { auto: true }), venta_id: col('int', { fk: 'Venta' }), lote_id: col('int', { fk: 'Lote' }),
      cantidad: col('int'), precio_unitario: col('dec'), subtotal: col('dec', { computed: true }),
    },
    unique: [],
  },
  MovimientoStock: {
    pk: 'movimiento_id',
    cols: {
      movimiento_id: col('bigint', { auto: true }), lote_id: col('int', { fk: 'Lote' }), usuario_id: col('int', { fk: 'Usuario' }),
      compra_id: col('int', { fk: 'Compra' }), venta_id: col('int', { fk: 'Venta' }),
      tipo: col('str', { max: 18, ascii: true }), cantidad: col('int'), fecha: col('dt', { auto: true }),
    },
    unique: [],
  },
  AuditoriaOperacion: {
    pk: 'auditoria_id',
    cols: {
      auditoria_id: col('bigint', { auto: true }), usuario_id: col('int', { fk: 'Usuario' }),
      accion: col('str', { max: 40, ascii: true, req: true }), entidad: col('str', { max: 40, ascii: true, req: true }),
      entidad_id: col('int'), detalle: col('str', { max: 500 }), ip: col('str', { max: 45, ascii: true }), fecha: col('dt', { auto: true }),
    },
    unique: [],
  },
};

module.exports = { TABLES };
