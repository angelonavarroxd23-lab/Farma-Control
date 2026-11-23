import { api } from '../api.js';
import { h, title, fdt, table, badge, modal, toast, confirmDialog } from '../ui.js';

// Reposición (BN-04): el sistema sugiere qué reponer según las existencias vendibles y el stock mínimo,
// y el almacenero genera órdenes de reposición por proveedor. La orden pasa a "Recibida" al registrar su compra.
const ESTADO = { PENDIENTE: ['Pendiente', 'alert'], RECIBIDA: ['Recibida', ''], ANULADA: ['Anulada', 'muted'] };
const MOTIVO = { AGOTADO: ['Agotado', 'error'], STOCK_BAJO: ['Stock bajo', 'alert'], SIN_STOCK_VENDIBLE_POR_VENCIMIENTO: ['Sin stock vendible (vencido)', 'error'] };

export async function render(el, ctx) {
  const canW = ctx.can('reposicion:read');
  el.innerHTML = title('Reposición de mercadería', 'Sugerencias a partir del inventario y órdenes de reposición a proveedores.') + `
  <div class="tabs"><button class="tab active" data-tab="sug">Sugerencias</button><button class="tab" data-tab="ord">Órdenes</button></div><div id="view"></div>`;
  const $ = (s) => el.querySelector(s); const view = () => $('#view');

  async function sugerencias() {
    const [sug, provs] = await Promise.all([api.get('/api/reposicion/sugerencias'), api.get('/api/proveedores')]);
    const activos = provs.filter((p) => p.activo);
    view().innerHTML = `<div class="panel"><div data-error></div>
      <div class="actions"><span class="muted">Se sugiere reponer cuando las existencias vendibles (lotes no vencidos) son iguales o menores a la suma de los stocks mínimos.</span>${canW ? '<button class="btn primary" id="gen">Generar órdenes con lo seleccionado</button>' : ''}</div>
      <div id="tbl"></div></div>`;
    $('#tbl').innerHTML = sug.length ? `<div class="tableWrap"><table><thead><tr><th></th><th>Medicamento</th><th class="num">Vendible</th><th class="num">Mínimo</th><th>Motivo</th><th>Proveedor</th><th class="num">Cantidad</th></tr></thead><tbody>${sug.map((s) => `<tr data-med="${s.medicamento_id}">
      <td><input type="checkbox" data-sel ${s.orden_pendiente ? '' : 'checked'} aria-label="Incluir ${h(s.medicamento)}"></td>
      <td><b>${h(s.medicamento)}</b><br><span class="muted">${h(s.sku)} · ${h(s.presentacion)}</span>${s.orden_pendiente ? `<br>${badge(`En orden #${s.orden_pendiente.orden_id} (${s.orden_pendiente.cantidad} unid.)`, 'info')}` : ''}</td>
      <td class="num">${s.stock_vendible}</td><td class="num">${s.stock_minimo_total}</td><td>${badge(MOTIVO[s.motivo][0], MOTIVO[s.motivo][1])}</td>
      <td><select class="input" data-prov aria-label="Proveedor de ${h(s.medicamento)}"><option value="">Seleccione…</option>${activos.map((p) => `<option value="${p.proveedor_id}" ${p.proveedor_id === s.proveedor_id ? 'selected' : ''}>${h(p.razon_social)}</option>`).join('')}</select></td>
      <td class="num"><input class="input qty" type="number" min="1" value="${s.cantidad_sugerida}" data-cant aria-label="Cantidad de ${h(s.medicamento)}"></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Todos los medicamentos activos tienen existencias por encima del mínimo.</p>';
    $('#gen')?.addEventListener('click', async () => {
      const box = view().querySelector('[data-error]'); box.innerHTML = '';
      const filas = [...el.querySelectorAll('tr[data-med]')].filter((r) => r.querySelector('[data-sel]').checked)
        .map((r) => ({ medicamento_id: Number(r.dataset.med), proveedor_id: Number(r.querySelector('[data-prov]').value), cantidad: Number(r.querySelector('[data-cant]').value) }));
      if (!filas.length) return toast('Seleccione al menos un medicamento.', 'error');
      if (filas.some((f) => !f.proveedor_id)) return toast('Elija un proveedor para cada medicamento seleccionado.', 'error');
      if (filas.some((f) => !Number.isInteger(f.cantidad) || f.cantidad < 1)) return toast('Las cantidades deben ser enteros mayores que cero.', 'error');
      const grupos = new Map(); for (const f of filas) grupos.set(f.proveedor_id, [...(grupos.get(f.proveedor_id) || []), { medicamento_id: f.medicamento_id, cantidad: f.cantidad }]);
      const btn = $('#gen'); btn.disabled = true; let creadas = 0;
      try {
        for (const [proveedor_id, items] of grupos) { await api.post('/api/ordenes', { proveedor_id, items }); creadas++; }
        toast(`${creadas} orden(es) de reposición generada(s).`); await sugerencias();
      } catch (err) {
        const l = (err.details || []).map((d) => `<li>${h(d)}</li>`).join('');
        box.innerHTML = `<div class="formError" role="alert">${creadas ? `Se generaron ${creadas} orden(es) antes del error. ` : ''}${h(err.message)}${l ? `<ul>${l}</ul>` : ''}</div>`;
      } finally { btn.disabled = false; }
    });
  }

  async function ordenes() {
    view().innerHTML = '<div class="panel"><div class="actions"><div class="filters"><select class="input" id="est" aria-label="Filtrar por estado"><option value="">Todos los estados</option><option value="PENDIENTE">Pendientes</option><option value="RECIBIDA">Recibidas</option><option value="ANULADA">Anuladas</option></select></div></div><div id="tbl"></div></div>';
    async function load() {
      const rows = await api.get('/api/ordenes' + ($('#est').value ? `?estado=${$('#est').value}` : ''));
      $('#tbl').innerHTML = table([{ label: 'N.º', html: (o) => `<b>#${o.orden_id}</b>` }, { label: 'Fecha', val: (o) => fdt(o.fecha) }, { label: 'Proveedor', key: 'proveedor' },
        { label: 'Medicamentos', num: true, key: 'items' }, { label: 'Unidades', num: true, key: 'unidades' }, { label: 'Estado', html: (o) => badge(ESTADO[o.estado][0], ESTADO[o.estado][1]) }, { label: 'Registró', key: 'usuario' },
        { label: '', html: (o) => `<div class="rowButtons"><button class="btn small" data-ver="${o.orden_id}">Detalle</button>${canW && o.estado === 'PENDIENTE' ? `<button class="btn small danger" data-anular="${o.orden_id}">Anular</button>` : ''}</div>` }], rows, 'No hay órdenes de reposición.');
    }
    $('#est').addEventListener('change', load);
    view().onclick = async (e) => {
      const v = e.target.closest('[data-ver]'), a = e.target.closest('[data-anular]');
      if (v) { const o = await api.get(`/api/ordenes/${v.dataset.ver}`);
        modal({ title: `Orden de reposición #${o.orden_id}`, wide: true, body: `<p class="muted">${h(o.proveedor)} · ${fdt(o.fecha)} · registrada por ${h(o.usuario)} · ${badge(ESTADO[o.estado][0], ESTADO[o.estado][1])}${o.compra_id ? ` · recibida con la compra #${o.compra_id}` : ''}${o.observacion ? `<br>${h(o.observacion)}` : ''}</p>${table([{ label: 'Medicamento', html: (d) => `<b>${h(d.medicamento)}</b><br><span class="muted">${h(d.sku)} · ${h(d.presentacion)}</span>` }, { label: 'Cantidad solicitada', num: true, key: 'cantidad_solicitada' }], o.detalle)}` }); }
      if (a) confirmDialog({ title: 'Anular orden', message: `¿Anular la orden #${a.dataset.anular}? Ya no podrá asociarse a una compra.`, danger: true, confirmLabel: 'Anular', onConfirm: async () => { await api.post(`/api/ordenes/${a.dataset.anular}/anular`, {}); toast('Orden anulada.'); await load(); } });
    };
    await load();
  }

  el.querySelector('.tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (!t) return;
    el.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t)); (t.dataset.tab === 'sug' ? sugerencias : ordenes)().catch((x) => toast(x.message, 'error')); });
  await sugerencias();
}
