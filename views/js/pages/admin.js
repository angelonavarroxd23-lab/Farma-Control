import { api, qs } from '../api.js';
import { h, title, table, badge, formDialog, toast, fdt } from '../ui.js';

// CU-11 Administrar perfiles (usuarios y roles). Las contraseñas se almacenan solo como hash scrypt en el servidor.
export const usuarios = {
  async render(el, ctx) {
    const roles = await api.get('/api/roles'); let rows = [];
    el.innerHTML = title('Usuarios y perfiles', 'Cuentas del sistema y perfil asignado. Los permisos se verifican en el servidor en cada petición.') + `<div class="panel"><div class="actions"><span></span><button class="btn primary" id="new">+ Nuevo usuario</button></div><div id="tbl"></div></div>
    <div class="panel"><h3>Matriz de permisos por perfil</h3>${table([{ label: 'Perfil', key: 'p' }, { label: 'Ventas', key: 'v' }, { label: 'Compras / lotes', key: 'c' }, { label: 'Recetas', key: 'r' }, { label: 'Reportes / usuarios', key: 'a' }], [
      { p: 'Administrador', v: 'Registrar y anular', c: 'Registrar', r: 'Registrar', a: 'Administración total' }, { p: 'Cajero', v: 'Registrar', c: '—', r: 'Consultar', a: '—' },
      { p: 'Almacenero', v: '—', c: 'Registrar', r: '—', a: 'Consulta de inventario' }, { p: 'Quimico farmaceutico', v: 'Consultar', c: '—', r: 'Registrar', a: 'Alertas y movimientos' }])}</div>`;
    const $ = (s) => el.querySelector(s);
    const base = [{ name: 'nombres', label: 'Nombres', req: true, max: 120 }, { name: 'rol_id', label: 'Perfil', type: 'select', req: true, options: roles.map((r) => ({ value: r.rol_id, label: r.nombre })) }];
    const load = async () => { rows = await api.get('/api/usuarios');
      $('#tbl').innerHTML = table([{ label: 'Nombre', html: (u) => `<b>${h(u.nombres)}</b>` }, { label: 'Correo', key: 'correo' }, { label: 'Perfil', html: (u) => badge(u.rol, 'info') }, { label: 'Estado', html: (u) => (u.activo ? badge('Activo') : badge('Inactivo', 'muted')) },
        { label: '', html: (u) => `<button class="btn small" data-edit="${u.usuario_id}">Editar</button>` }], rows); };
    $('#new').addEventListener('click', () => formDialog({ title: 'Nuevo usuario', fields: [...base, { name: 'correo', label: 'Correo', type: 'email', req: true, max: 160 },
      { name: 'contrasena', label: 'Contraseña inicial', type: 'password', req: true, autocomplete: 'new-password', hint: 'Mínimo 10 caracteres, con mayúsculas, minúsculas y números.' }],
      onSubmit: async (v) => { await api.post('/api/usuarios', v); toast('Usuario creado.'); await load(); } }));
    $('#tbl').addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (!b) return; const u = rows.find((x) => x.usuario_id === Number(b.dataset.edit));
      formDialog({ title: `Editar ${u.nombres}`, values: u, fields: [...base, { name: 'activo', label: 'Activo (puede iniciar sesión)', type: 'checkbox' }, { name: 'contrasena', label: 'Nueva contraseña (opcional)', type: 'password', autocomplete: 'new-password', hint: 'Déjela vacía para conservar la actual.' }],
        onSubmit: async (v) => { if (!v.contrasena) delete v.contrasena; await api.patch(`/api/usuarios/${u.usuario_id}`, v); toast('Usuario actualizado.'); await load(); } }); });
    await load();
  },
};

// RF-18 Auditoría de operaciones
export const auditoria = {
  async render(el) {
    el.innerHTML = title('Auditoría de operaciones', 'Registro centralizado de accesos y operaciones, escrito por el servidor y por los procedimientos de la base de datos.') + `<div class="panel"><div class="actions"><div class="filters"><div class="field"><label for="ac">Acción</label><select class="input" id="ac"><option value="">Todas</option>${['LOGIN_OK', 'LOGIN_FALLIDO', 'ACCESO_DENEGADO', 'VENTA_REGISTRADA', 'VENTA_ANULADA', 'COMPRA_REGISTRADA', 'CLIENTE_CREADO', 'MEDICAMENTO_CREADO', 'LOTE_CREADO', 'USUARIO_CREADO', 'USUARIO_MODIFICADO'].map((a) => `<option>${a}</option>`).join('')}</select></div><button class="btn" id="go">Filtrar</button></div></div><div id="tbl"></div></div>`;
    const load = async () => { const rows = await api.get('/api/auditoria' + qs({ accion: el.querySelector('#ac').value, limit: 300 }));
      el.querySelector('#tbl').innerHTML = table([{ label: 'Fecha', val: (a) => fdt(a.fecha) }, { label: 'Usuario', html: (a) => h(a.usuario || '—') }, { label: 'Acción', html: (a) => badge(a.accion, a.accion.includes('FALLIDO') || a.accion.includes('DENEGADO') ? 'error' : a.accion.includes('ANULADA') ? 'alert' : 'info') }, { label: 'Entidad', html: (a) => `${h(a.entidad)} ${a.entidad_id ?? ''}` }, { label: 'Detalle', key: 'detalle' }, { label: 'IP', key: 'ip' }], rows, 'Sin registros.'); };
    el.querySelector('#go').addEventListener('click', () => load().catch((e) => toast(e.message, 'error')));
    await load();
  },
};
