import { api, qs } from '../api.js';
import { h, money, title, fdate, table, badge, estadoLote, formDialog, confirmDialog, modal, toast, debounce, ALERTA } from '../ui.js';

// CU-03 Consultar medicamentos y CU-08 Gestionar medicamentos, lotes, categorías y presentaciones.
export async function render(el, ctx) {
  const canW = ctx.can('catalogo:write');
  let tab = 'med';
  el.innerHTML = title('Medicamentos y lotes', 'Catálogo, existencias por lote y fechas de vencimiento.') + `
  <div class="tabs" role="tablist"><button class="tab active" data-tab="med" role="tab">Medicamentos</button><button class="tab" data-tab="lotes" role="tab">Lotes y vencimientos</button><button class="tab" data-tab="cat" role="tab">Categorías</button></div><div id="view"></div>`;
  const $ = (s) => el.querySelector(s);
  const view = () => $('#view');

  const medFields = (cats, v = {}) => [
    { name: 'sku', label: 'SKU', req: true, max: 30 }, { name: 'nombre', label: 'Nombre comercial', req: true, max: 160 },
    { name: 'principio_activo', label: 'Principio activo', max: 160 }, { name: 'presentacion', label: 'Presentación', req: true, max: 90, hint: 'Ej.: Caja x 20 tabletas, Frasco 250 ml.' },
    { name: 'categoria_id', label: 'Categoría', type: 'select', req: true, placeholder: 'Seleccione…', options: cats.map((c) => ({ value: c.categoria_id, label: c.nombre })) },
    { name: 'precio_venta', label: 'Precio de venta (S/)', type: 'number', req: true, min: 0, step: '0.01' },
    { name: 'requiere_receta', label: 'Requiere receta', type: 'checkbox' }, { name: 'activo', label: 'Activo (disponible para la venta)', type: 'checkbox' }];

  async function showMed() {
    view().innerHTML = `<div class="panel"><div class="actions"><div class="filters"><input class="input" id="q" placeholder="Buscar por nombre, SKU o principio activo…" aria-label="Buscar medicamento"><select class="input" id="cat" aria-label="Filtrar por categoría"></select></div>${canW ? '<button class="btn primary" id="new">+ Nuevo medicamento</button>' : ''}</div><div id="tbl"></div></div>`;
    const cats = await api.get('/api/categorias');
    $('#cat').innerHTML = '<option value="">Todas las categorías</option>' + cats.map((c) => `<option value="${c.categoria_id}">${h(c.nombre)}</option>`).join('');
    async function load() {
      const rows = await api.get('/api/medicamentos' + qs({ q: $('#q').value, categoria_id: $('#cat').value }));
      $('#tbl').innerHTML = table([
        { label: 'SKU', key: 'sku' }, { label: 'Medicamento', html: (m) => `<b>${h(m.nombre)}</b><br><span class="muted">${h(m.principio_activo || '')}</span>` },
        { label: 'Presentación', key: 'presentacion' }, { label: 'Categoría', key: 'categoria' },
        { label: 'Precio', num: true, html: (m) => money(m.precio_venta) },
        { label: 'Stock vendible', num: true, html: (m) => `<b>${m.stock_vendible}</b>${m.stock_vencido ? `<br><span class="badge error">${m.stock_vencido} vencidas</span>` : ''}` },
        { label: 'Estado', html: (m) => `${m.activo ? badge('Activo') : badge('Inactivo', 'muted')} ${m.requiere_receta ? badge('Con receta', 'alert') : ''}` },
        { label: '', html: (m) => `<div class="rowButtons"><button class="btn small" data-lotes="${m.medicamento_id}">Lotes (${m.lotes})</button>${canW ? `<button class="btn small" data-edit="${m.medicamento_id}">Editar</button>` : ''}</div>` }], rows, 'No se encontraron medicamentos.');
      view().__rows = rows;
    }
    $('#q').addEventListener('input', debounce(load)); $('#cat').addEventListener('change', load);
    $('#new')?.addEventListener('click', () => formDialog({ title: 'Nuevo medicamento', fields: medFields(cats), values: { activo: true }, wide: true,
      onSubmit: async (v) => { await api.post('/api/medicamentos', v); toast('Medicamento registrado.'); await load(); } }));
    view().onclick = (e) => {
      const ed = e.target.closest('[data-edit]'); const lo = e.target.closest('[data-lotes]');
      if (ed) { const m = view().__rows.find((x) => x.medicamento_id === Number(ed.dataset.edit)); formDialog({ title: `Editar ${m.nombre}`, fields: medFields(cats), values: m, wide: true,
        onSubmit: async (v) => { await api.patch(`/api/medicamentos/${m.medicamento_id}`, v); toast('Medicamento actualizado.'); await load(); } }); }
      if (lo) lotesDeMedicamento(Number(lo.dataset.lotes), load);
    };
    await load();
  }

  const loteFields = (med) => [
    ...(med ? [] : []), { name: 'codigo_lote', label: 'Código de lote', req: true, max: 60 },
    { name: 'fecha_vencimiento', label: 'Fecha de vencimiento', type: 'date', req: true }, { name: 'stock_minimo', label: 'Stock mínimo (umbral de alerta)', type: 'number', min: 0, value: 5, req: true }];

  async function lotesDeMedicamento(id, after) {
    const m = await api.get(`/api/medicamentos/${id}`);
    const body = () => `<p class="muted">${h(m.presentacion)} · ${m.requiere_receta ? 'requiere receta' : 'venta libre'}. El stock de un lote nuevo es 0: se incrementa registrando una compra.</p>${table([
      { label: 'Lote', key: 'codigo_lote' }, { label: 'Vencimiento', val: (l) => fdate(l.fecha_vencimiento) }, { label: 'Stock', num: true, key: 'stock_actual' }, { label: 'Mínimo', num: true, key: 'stock_minimo' }, { label: 'Estado', html: estadoLote }], m.lotes, 'Este medicamento aún no tiene lotes.')}`;
    const mm = modal({ title: m.nombre, wide: true, body: `<div id="lb">${body()}</div>`, footer: `<button class="btn" data-close>Cerrar</button>${canW ? '<button class="btn primary" data-newlot>+ Nuevo lote</button>' : ''}`, onClose: after });
    mm.el.querySelector('[data-newlot]')?.addEventListener('click', () => formDialog({ title: `Nuevo lote de ${m.nombre}`, fields: loteFields(), submitLabel: 'Crear lote',
      onSubmit: async (v) => { await api.post('/api/lotes', { ...v, medicamento_id: id }); toast('Lote creado con stock 0. Registre una compra para ingresar unidades.');
        const f = await api.get(`/api/medicamentos/${id}`); m.lotes = f.lotes; mm.el.querySelector('#lb').innerHTML = body(); } }));
  }

  async function showLotes() {
    view().innerHTML = `<div class="panel"><div class="actions"><div class="filters"><input class="input" id="q" placeholder="Buscar por medicamento, SKU o lote…" aria-label="Buscar lote"><select class="input" id="al" aria-label="Filtrar por estado"><option value="">Todos los estados</option>${Object.entries(ALERTA).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div></div><div id="tbl"></div></div>`;
    async function load() {
      const rows = await api.get('/api/lotes' + qs({ q: $('#q').value, alerta: $('#al').value }));
      $('#tbl').innerHTML = table([
        { label: 'Medicamento', html: (l) => `<b>${h(l.medicamento)}</b><br><span class="muted">${h(l.sku)}</span>` }, { label: 'Lote', key: 'codigo_lote' },
        { label: 'Vencimiento', html: (l) => `${fdate(l.fecha_vencimiento)}<br><span class="muted">${l.vencido ? 'vencido' : `en ${l.dias_para_vencer} días`}</span>` },
        { label: 'Stock', num: true, html: (l) => `<b>${l.stock_actual}</b>` }, { label: 'Mínimo', num: true, key: 'stock_minimo' }, { label: 'Estado', html: estadoLote },
        { label: '', html: (l) => canW ? `<button class="btn small" data-edit="${l.lote_id}">Editar</button>` : '' }], rows, 'No hay lotes para el criterio indicado.');
      view().__rows = rows;
    }
    $('#q').addEventListener('input', debounce(load)); $('#al').addEventListener('change', load);
    view().onclick = (e) => { const ed = e.target.closest('[data-edit]'); if (!ed) return;
      const l = view().__rows.find((x) => x.lote_id === Number(ed.dataset.edit));
      formDialog({ title: `Editar lote ${l.codigo_lote}`, fields: [{ name: 'fecha_vencimiento', label: 'Fecha de vencimiento', type: 'date', req: true }, { name: 'stock_minimo', label: 'Stock mínimo', type: 'number', min: 0, req: true }], values: l,
        onSubmit: async (v) => { await api.patch(`/api/lotes/${l.lote_id}`, v); toast('Lote actualizado.'); await load(); } }); };
    await load();
  }

  async function showCat() {
    view().innerHTML = `<div class="panel"><div class="actions"><span class="muted">Las categorías agrupan el catálogo. La presentación (caja, frasco, etc.) se registra en cada medicamento.</span>${canW ? '<button class="btn primary" id="new">+ Nueva categoría</button>' : ''}</div><div id="tbl"></div></div>`;
    const f = [{ name: 'nombre', label: 'Nombre de la categoría', req: true, max: 90 }];
    async function load() {
      const rows = await api.get('/api/categorias');
      $('#tbl').innerHTML = table([{ label: 'Categoría', key: 'nombre' }, { label: '', html: (c) => canW ? `<div class="rowButtons"><button class="btn small" data-edit="${c.categoria_id}">Renombrar</button><button class="btn small danger" data-del="${c.categoria_id}">Eliminar</button></div>` : '' }], rows);
      view().__rows = rows;
    }
    $('#new')?.addEventListener('click', () => formDialog({ title: 'Nueva categoría', fields: f, onSubmit: async (v) => { await api.post('/api/categorias', v); toast('Categoría creada.'); await load(); } }));
    view().onclick = (e) => { const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      if (ed) { const c = view().__rows.find((x) => x.categoria_id === Number(ed.dataset.edit)); formDialog({ title: 'Renombrar categoría', fields: f, values: c, onSubmit: async (v) => { await api.patch(`/api/categorias/${c.categoria_id}`, v); await load(); } }); }
      if (dl) confirmDialog({ title: 'Eliminar categoría', message: 'Solo puede eliminarse si no tiene medicamentos asociados.', danger: true, confirmLabel: 'Eliminar', onConfirm: async () => { await api.del(`/api/categorias/${dl.dataset.del}`); toast('Categoría eliminada.'); await load(); } }); };
    await load();
  }

  const tabs = { med: showMed, lotes: showLotes, cat: showCat };
  el.querySelector('.tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (!t) return; tab = t.dataset.tab;
    el.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t)); tabs[tab]().catch((x) => toast(x.message, 'error')); });
  await showMed();
}
