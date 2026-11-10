import { api, qs } from '../api.js';
import { h, title, table, badge, formDialog, toast, debounce, fdate, today } from '../ui.js';

// Fábrica de pantallas de mantenimiento (listado + búsqueda + alta/edición en diálogo).
function maestro({ titulo, sub, endpoint, searchable, cols, fields, canWrite, newLabel, okNew, okEdit, extra, idKey }) {
  return {
    async render(el, ctx) {
      const w = ctx.can(canWrite);
      el.innerHTML = title(titulo, sub) + `<div class="panel"><div class="actions">${searchable ? '<input class="input" id="q" placeholder="Buscar…" aria-label="Buscar">' : '<span></span>'}${w ? `<button class="btn primary" id="new">${newLabel}</button>` : ''}</div><div id="tbl"></div></div>`;
      const $ = (s) => el.querySelector(s); let rows = [];
      const load = async () => { rows = await api.get(endpoint + (searchable ? qs({ q: $('#q').value }) : ''));
        $('#tbl').innerHTML = table([...cols(ctx), ...(w ? [{ label: '', html: (r) => `<button class="btn small" data-edit="${r[idKey]}">Editar</button>` }] : [])], rows, 'Sin registros.'); };
      $('#q')?.addEventListener('input', debounce(load));
      $('#new')?.addEventListener('click', async () => formDialog({ title: newLabel.replace('+ ', ''), fields: await fields(false), wide: true, values: { activo: true }, onSubmit: async (v) => { await api.post(endpoint, v); toast(okNew); await load(); } }));
      $('#tbl').addEventListener('click', async (e) => { const b = e.target.closest('[data-edit]'); if (!b) return; const r = rows.find((x) => x[idKey] === Number(b.dataset.edit));
        formDialog({ title: 'Editar registro', fields: await fields(true), values: r, wide: true, onSubmit: async (v) => { await api.patch(`${endpoint}/${r[idKey]}`, v); toast(okEdit); await load(); } }); });
      await load();
    },
  };
}

const DOC = [{ value: 'DNI', label: 'DNI' }, { value: 'CE', label: 'Carné de extranjería' }, { value: 'RUC', label: 'RUC' }, { value: 'OTR', label: 'Otro documento' }];

// CU-02 Gestionar clientes
export const clientes = maestro({
  titulo: 'Clientes', sub: 'Registro y consulta de compradores. El documento es único por tipo.', endpoint: '/api/clientes', searchable: true, idKey: 'cliente_id',
  canWrite: 'clientes:write', newLabel: '+ Nuevo cliente', okNew: 'Cliente registrado.', okEdit: 'Cliente actualizado.',
  cols: () => [{ label: 'Documento', html: (c) => `${badge(c.tipo_documento, 'info')} ${h(c.numero_documento)}` }, { label: 'Nombre / razón social', html: (c) => `<b>${h(c.nombre_razon_social)}</b>` }, { label: 'Teléfono', key: 'telefono' }],
  fields: async () => [{ name: 'tipo_documento', label: 'Tipo de documento', type: 'select', req: true, options: DOC }, { name: 'numero_documento', label: 'Número de documento', req: true, max: 15, hint: 'DNI: 8 dígitos · RUC: 11 dígitos.' },
    { name: 'nombre_razon_social', label: 'Nombre o razón social', req: true, max: 160 }, { name: 'telefono', label: 'Teléfono (opcional)', max: 20 }],
});

// Proveedores (mantenimiento de apoyo a CU-07)
export const proveedores = maestro({
  titulo: 'Proveedores', sub: 'Empresas que entregan mercadería. Solo los proveedores activos pueden registrar compras.', endpoint: '/api/proveedores', searchable: false, idKey: 'proveedor_id',
  canWrite: 'catalogo:write', newLabel: '+ Nuevo proveedor', okNew: 'Proveedor registrado.', okEdit: 'Proveedor actualizado.',
  cols: () => [{ label: 'RUC', key: 'ruc' }, { label: 'Razón social', html: (p) => `<b>${h(p.razon_social)}</b>` }, { label: 'Contacto', key: 'contacto' }, { label: 'Teléfono', key: 'telefono' }, { label: 'Estado', html: (p) => (p.activo ? badge('Activo') : badge('Inactivo', 'muted')) }],
  fields: async () => [{ name: 'ruc', label: 'RUC', req: true, max: 11, hint: '11 dígitos.' }, { name: 'razon_social', label: 'Razón social', req: true, max: 180 }, { name: 'contacto', label: 'Contacto', max: 120 }, { name: 'telefono', label: 'Teléfono', max: 20 }, { name: 'activo', label: 'Activo', type: 'checkbox' }],
});

// CU-04 Registrar y validar referencia de receta
export const recetas = {
  async render(el, ctx) {
    const w = ctx.can('recetas:write');
    el.innerHTML = title('Recetas', 'Referencias de recetas vinculadas al cliente. El sistema verifica registro, estado y vigencia; no evalúa el contenido clínico.') + `<div class="panel"><div class="actions"><span></span>${w ? '<button class="btn primary" id="new">+ Registrar receta</button>' : ''}</div><div id="tbl"></div></div>`;
    const $ = (s) => el.querySelector(s); let rows = [];
    const load = async () => { rows = await api.get('/api/recetas');
      $('#tbl').innerHTML = table([{ label: 'N.º receta', html: (r) => `<b>${h(r.numero_receta)}</b>` }, { label: 'Cliente', key: 'cliente' }, { label: 'Prescriptor', key: 'nombre_prescriptor' }, { label: 'Emisión', val: (r) => fdate(r.fecha_emision) }, { label: 'Vence', val: (r) => fdate(r.fecha_vencimiento) },
        { label: 'Estado', html: (r) => (r.estado === 'ANULADA' ? badge('Anulada', 'error') : r.vigente ? badge('Vigente') : badge('No vigente', 'alert')) },
        ...(w ? [{ label: '', html: (r) => (r.estado === 'VALIDA' ? `<button class="btn small danger" data-anular="${r.receta_id}">Anular</button>` : '') }] : [])], rows, 'Aún no hay recetas registradas.'); };
    $('#new')?.addEventListener('click', async () => { const cl = await api.get('/api/clientes');
      formDialog({ title: 'Registrar receta', wide: true, values: { fecha_emision: today() }, fields: [
        { name: 'cliente_id', label: 'Cliente (titular)', type: 'select', req: true, placeholder: 'Seleccione…', options: cl.map((c) => ({ value: c.cliente_id, label: `${c.nombre_razon_social} · ${c.numero_documento}` })) },
        { name: 'numero_receta', label: 'Número de receta', req: true, max: 50 }, { name: 'nombre_prescriptor', label: 'Prescriptor', req: true, max: 160 },
        { name: 'fecha_emision', label: 'Fecha de emisión', type: 'date', req: true }, { name: 'fecha_vencimiento', label: 'Vigente hasta', type: 'date', req: true }, { name: 'observacion', label: 'Observación', max: 250 }],
        onSubmit: async (v) => { await api.post('/api/recetas', v); toast('Receta registrada.'); await load(); } }); });
    $('#tbl').addEventListener('click', async (e) => { const b = e.target.closest('[data-anular]'); if (!b) return;
      try { await api.patch(`/api/recetas/${b.dataset.anular}`, { estado: 'ANULADA' }); toast('Receta anulada.'); await load(); } catch (x) { toast(x.message, 'error'); } });
    await load();
  },
};
