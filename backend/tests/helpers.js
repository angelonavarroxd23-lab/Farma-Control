'use strict';
// Utilidades de prueba. Con DB_DRIVER=memory (valor por defecto de "npm test") se usa el controlador
// en memoria; con DB_DRIVER=mssql las MISMAS pruebas se ejecutan contra SQL Server (vea README).
const { start } = require('../src/server');
const { config } = require('../src/config');

const USERS = {
  admin: ['admin@farmacontrol.local', 'Admin#2026Fc'], cajero: ['cajero@farmacontrol.local', 'Cajero#2026Fc'],
  almacen: ['almacen@farmacontrol.local', 'Almacen#2026Fc'], quimico: ['quimico@farmacontrol.local', 'Quimico#2026Fc'],
};
const SUFFIX = Date.now().toString(36).slice(-6).toUpperCase();
let counter = 0;
const uid = (p = 'T') => `${p}${SUFFIX}${++counter}`;
const digits = (n) => { let s = ''; while (s.length < n) s += Math.floor(Math.random() * 10); return s; };
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function boot() {
  const driver = (process.env.DB_DRIVER || 'memory').toLowerCase();
  const cfg = { ...config, driver, port: 0, serveFrontend: false, corsOrigin: '', jwtSecret: process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef', tokenTtlMinutes: 60 };
  const srv = await start(cfg);
  const base = `http://127.0.0.1:${srv.port}`;
  async function call(method, path, body, token, extra = {}) {
    const headers = { ...(body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(extra.headers || {}) };
    const res = await fetch(base + path, { method, headers, body: extra.raw !== undefined ? extra.raw : (body !== undefined ? JSON.stringify(body) : (method === 'GET' ? undefined : '{}')) });
    const text = await res.text(); let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  const tokens = {};
  async function login(rol) {
    if (tokens[rol]) return tokens[rol];
    const [correo, contrasena] = USERS[rol];
    const r = await call('POST', '/api/auth/login', { correo, contrasena });
    if (r.status !== 200) throw new Error(`No se pudo iniciar sesión como ${rol}: ${r.status} ${JSON.stringify(r.data)}`);
    return (tokens[rol] = r.data.token);
  }
  // Fábrica de datos de prueba aislados (códigos únicos para poder repetir la suite).
  async function crearMedicamento({ precio = 10, receta = false } = {}) {
    const t = await login('almacen');
    let cats = (await call('GET', '/api/categorias', undefined, t)).data;
    const cat = cats[0] || (await call('POST', '/api/categorias', { nombre: uid('Cat') }, t)).data;
    const r = await call('POST', '/api/medicamentos', { categoria_id: cat.categoria_id, sku: uid('SKU'), nombre: uid('Med'), presentacion: 'Caja x 10', precio_venta: precio, requiere_receta: receta }, t);
    if (r.status !== 201) throw new Error('crearMedicamento: ' + JSON.stringify(r.data));
    return r.data;
  }
  async function crearLote(med, { dias = 365, minimo = 5, stock = 0 } = {}) {
    const t = await login('almacen');
    const r = await call('POST', '/api/lotes', { medicamento_id: med.medicamento_id, codigo_lote: uid('L'), fecha_vencimiento: addDays(dias), stock_minimo: minimo }, t);
    if (r.status !== 201) throw new Error('crearLote: ' + JSON.stringify(r.data));
    if (stock > 0) await comprar(r.data, stock);
    return (await call('GET', `/api/lotes?medicamento_id=${med.medicamento_id}`, undefined, t)).data.find((l) => l.lote_id === r.data.lote_id);
  }
  async function proveedor() {
    const t = await login('almacen');
    const r = await call('POST', '/api/proveedores', { ruc: '20' + digits(9), razon_social: uid('Prov'), contacto: 'Pruebas' }, t);
    if (r.status !== 201) throw new Error('proveedor: ' + JSON.stringify(r.data));
    return r.data;
  }
  async function comprar(lote, cantidad, costo = 3) {
    const t = await login('almacen'); const p = await proveedor();
    const r = await call('POST', '/api/compras', { proveedor_id: p.proveedor_id, numero_documento: uid('F'), items: [{ lote_id: lote.lote_id, cantidad, costo_unitario: costo }] }, t);
    if (r.status !== 201) throw new Error('comprar: ' + JSON.stringify(r.data));
    return r.data;
  }
  async function crearCliente(tipo = 'DNI') {
    const t = await login('cajero');
    const r = await call('POST', '/api/clientes', { tipo_documento: tipo, numero_documento: digits(tipo === 'RUC' ? 11 : 8), nombre_razon_social: uid('Cliente') }, t);
    if (r.status !== 201) throw new Error('crearCliente: ' + JSON.stringify(r.data));
    return r.data;
  }
  const stockDe = async (lote) => (await call('GET', `/api/lotes?medicamento_id=${lote.medicamento_id}`, undefined, await login('admin'))).data.find((l) => l.lote_id === lote.lote_id).stock_actual;
  return { srv, call, login, base, crearMedicamento, crearLote, proveedor, comprar, crearCliente, stockDe, uid, digits, addDays, USERS, driver, close: () => srv.close() };
}
module.exports = { boot, USERS, uid, addDays };
