import { api, qs } from '../api.js';
import { h, money, title, fdt, fdate, table, badge, modal, formDialog, toast, today } from '../ui.js';

// CU-06 Generar constancia interna (visualizar e imprimir). No es comprobante tributario.
export async function openConstancia(id) {
  const v = await api.get(`/api/ventas/${id}`);
  const html = `<div class="receipt"><h4>${h(v.establecimiento)}</h4><div class="c">CONSTANCIA INTERNA DE VENTA</div><div class="c"><b>${h(v.tipo_comprobante)} ${h(v.numero_comprobante)}</b></div><hr>
    <div>Fecha: ${fdt(v.fecha)}</div><div>Cliente: ${h(v.cliente?.nombre_razon_social)}</div><div>${h(v.cliente?.tipo_documento)}: ${h(v.cliente?.numero_documento)}</div><div>Atendió: ${h(v.usuario)}</div>${v.receta ? `<div>Receta: ${h(v.receta.numero_receta)} (${h(v.receta.nombre_prescriptor)})</div>` : ''}<hr>
    <table style="width:100%"><thead><tr><th>Producto / lote</th><th class="r">Cant</th><th class="r">P.U.</th><th class="r">Importe</th></tr></thead><tbody>${v.detalle.map((d) => `<tr><td>${h(d.medicamento)}<br><small>Lote ${h(d.codigo_lote)} · vence ${fdate(d.vencimiento)}</small></td><td class="r">${d.cantidad}</td><td class="r">${Number(d.precio_unitario).toFixed(2)}</td><td class="r">${Number(d.subtotal).toFixed(2)}</td></tr>`).join('')}</tbody></table><hr>
    <div class="r" style="text-align:right"><b>TOTAL ${money(v.total)}</b></div>
    ${v.estado === 'ANULADA' ? `<div class="void">VENTA ANULADA ${fdt(v.fecha_anulacion)}<br>Motivo: ${h(v.motivo_anulacion)}</div>` : ''}<hr><div class="c" style="font-size:11px">${h(v.aviso)}</div></div>`;
  const m = modal({ title: `Constancia ${v.numero_comprobante}`, body: html, footer: '<button class="btn" data-close>Cerrar</button><button class="btn primary" data-print>Imprimir</button>' });
  m.el.querySelector('[data-print]').addEventListener('click', () => {
    document.getElementById('printRoot').innerHTML = html; window.print();
  });
}

// CU-12 Anular venta (solo administrador) + historial.
export async function render(el, ctx) {
  el.innerHTML = title('Historial de ventas', 'Ventas confirmadas y anuladas, con su constancia y trazabilidad.') + `
  <div class="panel"><div class="actions"><div class="filters">
    <div class="field"><label for="d">Desde</label><input class="input" type="date" id="d"></div>
    <div class="field"><label for="a">Hasta</label><input class="input" type="date" id="a"></div>
    <div class="field"><label for="e">Estado</label><select class="input" id="e"><option value="">Todos</option><option>CONFIRMADA</option><option>ANULADA</option></select></div>
    <button class="btn" id="go">Filtrar</button></div></div><div id="list"></div></div>`;
  const $ = (s) => el.querySelector(s);
  async function load() {
    try {
      const rows = await api.get('/api/ventas' + qs({ desde: $('#d').value, hasta: $('#a').value, estado: $('#e').value }));
      $('#list').innerHTML = table([
        { label: 'Comprobante', html: (v) => `<b>${h(v.numero_comprobante)}</b>` }, { label: 'Fecha', val: (v) => fdt(v.fecha) }, { label: 'Cliente', key: 'cliente' }, { label: 'Atendió', key: 'usuario' },
        { label: 'Total', num: true, html: (v) => `<span class="money">${money(v.total)}</span>` },
        { label: 'Estado', html: (v) => badge(v.estado === 'ANULADA' ? 'Anulada' : 'Confirmada', v.estado === 'ANULADA' ? 'error' : '') },
        { label: '', html: (v) => `<div class="rowButtons"><button class="btn small" data-ver="${v.venta_id}">Constancia</button>${ctx.can('ventas:anular') && v.estado === 'CONFIRMADA' ? `<button class="btn small danger" data-anular="${v.venta_id}" data-nro="${h(v.numero_comprobante)}">Anular</button>` : ''}</div>` },
      ], rows, 'No hay ventas para el filtro indicado.');
    } catch (e) { toast(e.message, 'error'); }
  }
  el.addEventListener('click', (e) => {
    const ver = e.target.closest('[data-ver]'); const an = e.target.closest('[data-anular]');
    if (ver) openConstancia(ver.dataset.ver).catch((x) => toast(x.message, 'error'));
    if (an) formDialog({ title: `Anular ${an.dataset.nro}`, submitLabel: 'Anular venta', fields: [{ name: 'motivo', label: 'Motivo de la anulación', type: 'textarea', req: true, max: 250, hint: 'La anulación repone el stock de cada lote una sola vez y no se puede deshacer.' }],
      onSubmit: async (v) => { await api.post(`/api/ventas/${an.dataset.anular}/anular`, v); toast('Venta anulada y existencias repuestas.'); await load(); } });
  });
  $('#go').addEventListener('click', load);
  await load();
}
