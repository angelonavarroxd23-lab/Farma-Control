import { api, qs } from '../api.js';
import { h, money, title, fdt, fdate, table, modal, toast } from '../ui.js';

// CU-07 Registrar compra: ingresa unidades a lotes existentes y registra los movimientos de entrada.
export async function render(el, ctx) {
  const canC = ctx.can('compras:read');
  el.innerHTML = title('Compras y recepción de mercadería', 'Cada compra incrementa el stock de los lotes y conserva su movimiento de entrada.') + `
  <div class="tabs"><button class="tab active" data-tab="nueva">Nueva compra</button><button class="tab" data-tab="hist">Historial</button></div><div id="view"></div>`;
  const $ = (s) => el.querySelector(s); const view = () => $('#view');
  let lines = [];

  async function nueva() {
    const [provs, lotes] = await Promise.all([api.get('/api/proveedores'), api.get('/api/lotes')]);
    const usable = lotes.filter((l) => !l.vencido && l.medicamento_activo);
    lines = [];
    view().innerHTML = `<div class="grid2"><div class="panel"><h3>Datos de la recepción</h3><div data-error></div>
      <div class="field"><label for="prov">Proveedor</label><select class="input" id="prov">${provs.filter((p) => p.activo).map((p) => `<option value="${p.proveedor_id}">${h(p.razon_social)}</option>`).join('')}</select></div>
      <div class="field"><label for="doc">Documento de compra</label><input class="input" id="doc" maxlength="40" placeholder="Ej.: FAC-2026-0002"><span class="hint">Debe ser único por proveedor.</span></div>
      <h3 style="margin-top:22px">Agregar lote</h3>
      <div class="field"><label for="lote">Lote</label><select class="input" id="lote"><option value="">Seleccione…</option>${usable.map((l) => `<option value="${l.lote_id}">${h(l.medicamento)} — ${h(l.codigo_lote)} (stock ${l.stock_actual}, vence ${fdate(l.fecha_vencimiento)})</option>`).join('')}</select></div>
      <div class="grid2e"><div class="field"><label for="cant">Cantidad</label><input class="input" id="cant" type="number" min="1" value="10"></div><div class="field"><label for="costo">Costo unitario (S/)</label><input class="input" id="costo" type="number" min="0" step="0.01" value="5.00"></div></div>
      <button class="btn" id="add">+ Agregar a la compra</button></div>
      <div class="panel"><h3>Detalle de la compra</h3><div id="lines"></div><div class="totals"><span>Total</span><span id="tot">${money(0)}</span></div>
      <button class="btn primary" id="save" style="margin-top:16px;width:100%">Registrar compra</button>
      <div class="notice" style="margin-top:16px">Los lotes se crean primero en <b>Medicamentos y lotes</b> (stock 0). La compra es la única forma de ingresar unidades.</div></div></div>`;
    const draw = () => { $('#lines').innerHTML = lines.length ? lines.map((x, i) => `<div class="detailLine"><div><b>${h(x.nombre)}</b><small>${x.cantidad} × ${money(x.costo_unitario)}</small></div><div><b>${money(x.cantidad * x.costo_unitario)}</b> <button class="btn small danger" data-del="${i}">Quitar</button></div></div>`).join('') : '<p class="empty">Agregue al menos un lote.</p>';
      $('#tot').textContent = money(lines.reduce((a, x) => a + x.cantidad * x.costo_unitario, 0)); };
    $('#add').addEventListener('click', () => {
      const id = Number($('#lote').value), cantidad = Number($('#cant').value), costo = Number($('#costo').value);
      if (!id) return toast('Seleccione un lote.', 'error');
      if (!Number.isInteger(cantidad) || cantidad < 1) return toast('La cantidad debe ser un entero mayor que cero.', 'error');
      if (!(costo >= 0)) return toast('El costo no puede ser negativo.', 'error');
      if (lines.some((x) => x.lote_id === id)) return toast('Ese lote ya está en la compra.', 'error');
      lines.push({ lote_id: id, cantidad, costo_unitario: costo, nombre: $('#lote').selectedOptions[0].textContent }); draw();
    });
    view().onclick = (e) => { const d = e.target.closest('[data-del]'); if (d) { lines.splice(Number(d.dataset.del), 1); draw(); } };
    $('#save').addEventListener('click', async () => {
      const box = view().querySelector('[data-error]'); box.innerHTML = ''; const btn = $('#save'); btn.disabled = true;
      try {
        const r = await api.post('/api/compras', { proveedor_id: Number($('#prov').value), numero_documento: $('#doc').value, items: lines.map(({ lote_id, cantidad, costo_unitario }) => ({ lote_id, cantidad, costo_unitario })) });
        toast(`Compra #${r.compra_id} registrada: existencias actualizadas.`); await nueva();
      } catch (err) { const l = (err.details || []).map((d) => `<li>${h(d)}</li>`).join(''); box.innerHTML = `<div class="formError" role="alert">${h(err.message)}${l ? `<ul>${l}</ul>` : ''}</div>`; }
      finally { btn.disabled = false; }
    });
    draw();
  }

  async function hist() {
    view().innerHTML = '<div class="panel" id="p"></div>';
    const rows = await api.get('/api/compras');
    $('#p').innerHTML = table([{ label: 'N.º', key: 'compra_id' }, { label: 'Fecha', val: (c) => fdt(c.fecha) }, { label: 'Proveedor', key: 'proveedor' }, { label: 'Documento', key: 'numero_documento' }, { label: 'Registró', key: 'usuario' },
      { label: 'Total', num: true, html: (c) => `<span class="money">${money(c.total)}</span>` }, { label: '', html: (c) => `<button class="btn small" data-ver="${c.compra_id}">Detalle</button>` }], rows, 'Aún no hay compras registradas.');
    $('#p').onclick = async (e) => { const b = e.target.closest('[data-ver]'); if (!b) return;
      const c = await api.get(`/api/compras/${b.dataset.ver}`);
      modal({ title: `Compra #${c.compra_id} · ${c.numero_documento}`, wide: true, body: `<p class="muted">${h(c.proveedor)} · ${fdt(c.fecha)} · registrada por ${h(c.usuario)}</p>${table([{ label: 'Medicamento', key: 'medicamento' }, { label: 'Lote', key: 'codigo_lote' }, { label: 'Cantidad', num: true, key: 'cantidad' }, { label: 'Costo unit.', num: true, html: (d) => money(d.costo_unitario) }, { label: 'Subtotal', num: true, html: (d) => money(d.subtotal) }], c.detalle)}<div class="totals"><span>Total</span><span>${money(c.total)}</span></div>`, footer: '<button class="btn" data-close>Cerrar</button>' }); };
  }

  el.querySelector('.tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (!t) return;
    el.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t)); (t.dataset.tab === 'nueva' ? nueva : hist)().catch((x) => toast(x.message, 'error')); });
  await nueva();
}
