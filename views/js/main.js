import { api, session, setUnauthorizedHandler } from './api.js';
import { h, toast, modal, formDialog } from './ui.js';
import * as inicio from './pages/inicio.js';
import * as venta from './pages/venta.js';
import * as ventas from './pages/ventas.js';
import * as catalogo from './pages/catalogo.js';
import * as compras from './pages/compras.js';
import * as maestros from './pages/maestros.js';
import * as inventario from './pages/inventario.js';
import * as reportes from './pages/reportes.js';
import * as admin from './pages/admin.js';

// Permisos de la interfaz: solo controlan qué se muestra. La autorización real la aplica el servidor.
const PERMS = {
  'clientes:write': ['Administrador', 'Cajero'], 'proveedores:read': ['Administrador', 'Almacenero'], 'catalogo:write': ['Administrador', 'Almacenero'],
  'recetas:read': ['Administrador', 'Cajero', 'Quimico farmaceutico'], 'recetas:write': ['Administrador', 'Quimico farmaceutico'],
  'ventas:read': ['Administrador', 'Cajero', 'Quimico farmaceutico'], 'ventas:create': ['Administrador', 'Cajero'], 'ventas:anular': ['Administrador'],
  'compras:read': ['Administrador', 'Almacenero'], 'movimientos:read': ['Administrador', 'Almacenero', 'Quimico farmaceutico'],
  'reportes:read': ['Administrador'], 'usuarios:read': ['Administrador'], 'auditoria:read': ['Administrador'],
};
const can = (user, p) => !PERMS[p] || PERMS[p].includes(user.rol);

const PAGES = [
  ['Operación'],
  { id: 'inicio', label: 'Resumen', icon: '▦', mod: inicio },
  { id: 'venta', label: 'Nueva venta', icon: '▣', perm: 'ventas:create', mod: venta },
  { id: 'ventas', label: 'Historial de ventas', icon: '☰', perm: 'ventas:read', mod: ventas },
  { id: 'compras', label: 'Compras', icon: '▧', perm: 'compras:read', mod: compras },
  ['Inventario'],
  { id: 'medicamentos', label: 'Medicamentos y lotes', icon: '▤', mod: catalogo },
  { id: 'alertas', label: 'Alertas', icon: '⚠', mod: inventario.alertas },
  { id: 'movimientos', label: 'Movimientos', icon: '⇄', perm: 'movimientos:read', mod: inventario.movimientos },
  ['Gestión'],
  { id: 'clientes', label: 'Clientes', icon: '♙', mod: maestros.clientes },
  { id: 'recetas', label: 'Recetas', icon: '℞', perm: 'recetas:read', mod: maestros.recetas },
  { id: 'proveedores', label: 'Proveedores', icon: '⛟', perm: 'proveedores:read', mod: maestros.proveedores },
  ['Administración'],
  { id: 'reportes', label: 'Reportes', icon: '▥', perm: 'reportes:read', mod: reportes },
  { id: 'usuarios', label: 'Usuarios y perfiles', icon: '⚙', perm: 'usuarios:read', mod: admin.usuarios },
  { id: 'auditoria', label: 'Auditoría', icon: '✎', perm: 'auditoria:read', mod: admin.auditoria },
];

const $ = (s) => document.querySelector(s);
let user = null;
let current = null;

function renderLogin() {
  $('#app').classList.add('hidden'); const el = $('#login'); el.classList.remove('hidden');
  el.innerHTML = `<div class="loginHero"><div class="logoBar"><div class="logoMark">✚</div><span>FarmaControl</span></div><h1>Tu farmacia,<br>bajo control.</h1><p>Sistema de gestión de ventas, compras e inventario por lotes. Entorno académico con información ficticia.</p><div>● Ventas por lote &nbsp; ● Alertas de vencimiento &nbsp; ● Reportes</div></div>
  <form class="loginForm" id="loginForm" novalidate><h2>Iniciar sesión</h2><p>Ingrese con la cuenta asignada a su perfil.</p><div data-error></div>
  <div class="field"><label for="correo">Correo</label><input class="input" id="correo" name="correo" type="email" autocomplete="username" required></div>
  <div class="field"><label for="contrasena">Contraseña</label><input class="input" id="contrasena" name="contrasena" type="password" autocomplete="current-password" required></div>
  <button class="btn primary" type="submit">Ingresar →</button>
  <div class="notice warning" style="margin-top:18px">Prototipo académico. Los comprobantes son constancias internas, no documentos tributarios.</div></form>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const box = f.querySelector('[data-error]'); box.innerHTML = '';
    try {
      const r = await api.post('/api/auth/login', { correo: f.correo.value, contrasena: f.contrasena.value });
      session.token = r.token; user = r.usuario; startApp();
    } catch (err) { box.innerHTML = `<div class="formError" role="alert">${h(err.message)}</div>`; }
  });
  el.querySelector('#correo').focus();
}

function startApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#userLabel').textContent = `${user.nombres} · ${user.rol}`;
  const nav = PAGES.map((p) => {
    if (Array.isArray(p)) return `<div class="navGroup">${h(p[0])}</div>`;
    if (p.perm && !can(user, p.perm)) return '';
    return `<a class="nav" href="#/${p.id}" data-page="${p.id}"><span class="nicon" aria-hidden="true">${p.icon}</span><span>${h(p.label)}</span></a>`;
  }).join('').replace(/<div class="navGroup">[^<]*<\/div>(?=<div class="navGroup">|$)/g, '');
  $('#sidebar').innerHTML = `<div class="logoBar"><div class="logoMark">✚</div><span>FarmaControl</span></div>${nav}<div class="sideNote">Versión académica 2.0<br><span id="driverNote">Verificando conexión…</span></div>`;
  api.get('/api/health').then((x) => { const n = document.getElementById('driverNote'); if (n) n.textContent = x.driver === 'mssql' ? 'Datos en SQL Server mediante API REST' : 'Modo demostración: datos en memoria (sin SQL Server)'; }).catch(() => {});
  route();
}

async function route() {
  if (!user) return;
  const id = (location.hash.replace(/^#\//, '') || 'inicio').split('?')[0];
  let page = PAGES.find((p) => !Array.isArray(p) && p.id === id && (!p.perm || can(user, p.perm)));
  if (!page) { page = PAGES.find((p) => p.id === 'inicio'); if (id !== 'inicio') location.hash = '#/inicio'; }
  document.querySelectorAll('.nav[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === page.id));
  $('#topTitle').textContent = page.label; $('#sidebar').classList.remove('open');
  const content = $('#content'); const token = (current = Symbol());
  content.innerHTML = ''; const host = document.createElement('div'); host.innerHTML = '<p class="muted">Cargando…</p>'; content.appendChild(host); // contenedor nuevo: evita acumular listeners
  try { await page.mod.render(host, { user, can: (p) => can(user, p), go: (hash) => { location.hash = hash; }, isCurrent: () => current === token }); }
  catch (e) { if (current === token) host.innerHTML = `<div class="notice warning" role="alert">${h(e.message)}</div>`; }
  content.focus({ preventScroll: true });
}

function logout(silent) {
  if (user && !silent) api.post('/api/auth/logout', {}).catch(() => {});
  session.token = null; user = null; current = null; renderLogin();
}

function changePassword() {
  formDialog({ title: 'Cambiar mi contraseña', submitLabel: 'Actualizar', fields: [
    { name: 'actual', label: 'Contraseña actual', type: 'password', req: true, autocomplete: 'current-password' },
    { name: 'nueva', label: 'Nueva contraseña', type: 'password', req: true, autocomplete: 'new-password', hint: 'Mínimo 10 caracteres, con mayúsculas, minúsculas y números.' }],
  onSubmit: async (v) => { await api.post('/api/auth/password', v); toast('Contraseña actualizada.'); } });
}

setUnauthorizedHandler(() => { if (user) { toast('Su sesión expiró. Inicie sesión nuevamente.', 'error'); logout(true); } });
window.addEventListener('hashchange', route);
$('#logoutBtn').addEventListener('click', () => logout(false));
$('#pwdBtn').addEventListener('click', changePassword);
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

(async function boot() {
  if (!session.token) return renderLogin();
  try { user = await api.get('/api/auth/me'); startApp(); } catch { session.token = null; renderLogin(); }
})();
