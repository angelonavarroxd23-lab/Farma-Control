import { api, qs } from '../api.js';
import { h, money, title, fdt, fdate, table, modal, toast, formDialog } from '../ui.js';

// CU-07 Registrar compra: ingresa unidades a lotes existentes o nuevos (creados en la misma operación), asocia el proveedor y puede cerrar una orden de reposición.
export async function render(el, ctx) {
  const canC = ctx.can('compras:read');
  el.innerHTML = title('Compras y recepción de mercadería', 'Cada compra incrementa el stock de los lotes y conserva su movimiento de entrada.') + `
  <div class="tabs"><button class="tab active" data-tab="nueva">Nueva compra</button><button class="tab" data-tab="hist">Historial</button></div><div id="view"></div>`;
  const $ = (s) => el.querySelector(s); const view = () => $('#view');
  let lines = [];

  async function nueva() {
    const [provs0, lotes, meds, ordenes] = await Promise.all([api.get('/api/proveedores'), api.get('/api/lotes'), api.get('/api/medicamentos?activo=true'), api.get('/api/ordenes?estado=PENDIENTE').catch(() => [])]);
    let provs = provs0; const usable = lotes.filter((l) => !l.vencido && l.medicamento_activo);
    let modo = 'existente'; let ordenSel = null;
    lines = [];
    const provOpts = () => provs.filter((p) => p.activo).map((p) => `<option value="${p.proveedor_id}">${h(p.razon_social)}</option>`).join('');
    view().innerHTML = `<div class="grid2"><div class="panel"><h3>Datos de la recepción</h3><div data-error></div>
      <div class="field"><label for="prov">Proveedor</label><div class="inlineRow"><select class="input" id="prov">${provOpts()}</select><button class="btn small" type="button" id="newProv">+ Nuevo proveedor</button></div></div>
      <div class="grid2e"><div class="field"><label for="doc">Documento de compra</label><input class="input" id="doc" maxlength="40" placeholder="Ej.: FAC-2026-0002"><span class="hint">Debe ser único por proveedor.</span></div>
      <div class="field"><label for="orden">Orden de reposición (opcional)</label><select class="input" id="orden"></select><span class="hint" id="ordenHint">Al registrar la compra, la orden elegida pasa a «Recibida».</span></div></div>
      <div id="ordenDet"></div>
      <h3 style="margin-top:22px">Agregar lote</h3>
      <div class="subTabs"><button class="btn small on" type="button" data-modo="existente">Lote existente</button><button class="btn small" type="button" data-modo="nuevo">Lote nuevo</button></div>
      <div id="modoExistente"><div class="field"><label for="lote">Lote</label><select class="input" id="lote"><option value="">Seleccione…</option>${usable.map((l) => `<option value="${l.lote_id}">${h(l.medicamento)} — ${h(l.codigo_lote)} (stock ${l.stock_actual}, vence ${fdate(l.fecha_vencimiento)})</option>`).join('')}</select></div></div>
      <div id="modoNuevo" class="hidden"><div class="field"><label for="nmed">Medicamento</label><select class="input" id="nmed"><option value="">Seleccione…</option>${meds.map((m) => `<option value="${m.medicamento_id}">${h(m.nombre)} — ${h(m.presentacion)}</option>`).join('')}</select></div>
        <div class="grid2e"><div class="field"><label for="ncod">Código de lote</label><input class="input" id="ncod" maxlength="60"></div><div class="field"><label for="nven">Fecha de vencimiento</label><input class="input" id="nven" type="date"></div></div>
        <div class="field"><label for="nmin">Stock mínimo (umbral de alerta)</label><input class="input" id="nmin" type="number" min="0" value="5"></div>
        <span class="hint" style="display:block;margin-bottom:12px">El lote se crea al registrar la compra y recibe sus unidades en la misma operación; queda asociado al proveedor elegido.</span></div>
      <div class="grid2e"><div class="field"><label for="cant">Cantidad</label><input class="input" id="cant" type="number" min="1" value="10"></div><div class="field"><label for="costo">Costo unitario (S/)</label><input class="input" id="costo" type="number" min="0" step="0.01" value="5.00"></div></div>
      <button class="btn" id="add">+ Agregar a la compra</button></div>
      <div class="panel"><h3>Detalle de la compra</h3><div id="lines"></div><div class="totals"><span>Total</span><span id="tot">${money(0)}</span></div>
      <button class="btn primary" id="save" style="margin-top:16px;width:100%">Registrar compra</button>
      <div class="notice" style="margin-top:16px">La compra es la única forma de ingresar unidades. Puede usar un lote ya creado o crear uno nuevo aquí mismo; ambos quedan asociados al proveedor de la compra.</div></div></div>`;
    const drawOrdenes = () => {
      const p = Number($('#prov').value); const lista = ordenes.filter((o) => o.proveedor_id === p);
      $('#orden').innerHTML = `<option value="">— Sin orden —</option>${lista.map((o) => `<option value="${o.orden_id}">Orden #${o.orden_id} · ${o.items} medicamento(s) · ${o.unidades} unid.</option>`).join('')}`;
      $('#ordenDet').innerHTML = ''; ordenSel = null;
    };
    const draw = () => { $('#lines').innerHTML = lines.length ? lines.map((x, i) => `<div class="detailLine"><div><b>${h(x.nombre)}</b><small>${x.nuevo ? '<span class="badge info">Lote nuevo</span> ' : ''}${x.cantidad} × ${money(x.costo_unitario)}</small></div><div><b>${money(x.cantidad * x.costo_unitario)}</b> <button class="btn small danger" data-del="${i}">Quitar</button></div></div>`).join('') : '<p class="empty">Agregue al menos un lote.</p>';
      $('#tot').textContent = money(lines.reduce((a, x) => a + x.cantidad * x.costo_unitario, 0)); };
    $('#prov').addEventListener('change', drawOrdenes);
    $('#orden').addEventListener('change', async () => {
      const id = $('#orden').value; if (!id) { $('#ordenDet').innerHTML = ''; ordenSel = null; return; }
      ordenSel = await api.get(`/api/ordenes/${id}`);
      $('#ordenDet').innerHTML = `<div class="recetaBox"><b>Se solicitó en la orden #${ordenSel.orden_id}</b>${ordenSel.detalle.map((d) => `<div class="detailLine"><div><b>${h(d.medicamento)}</b><small>${d.cantidad_solicitada} unidad(es) solicitadas</small></div><button class="btn small" type="button" data-pre="${d.medicamento_id}" data-cant="${d.cantidad_solicitada}">Usar</button></div>`).join('')}</div>`;
    });
    $('#newProv').addEventListener('click', () => formDialog({ title: 'Nuevo proveedor', fields: [{ name: 'ruc', label: 'RUC', req: true, max: 11, hint: '11 dígitos.' }, { name: 'razon_social', label: 'Razón social', req: true, max: 180 }, { name: 'contacto', label: 'Contacto', max: 120 }, { name: 'telefono', label: 'Teléfono', max: 20 }],
      onSubmit: async (v) => { const p = await api.post('/api/proveedores', { ...v, activo: true }); provs = await api.get('/api/proveedores'); $('#prov').innerHTML = provOpts(); $('#prov').value = String(p.proveedor_id); drawOrdenes(); toast('Proveedor registrado y seleccionado.'); } }));
    view().querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => { modo = b.dataset.modo;
      view().querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('on', x === b)); $('#modoExistente').classList.toggle('hidden', modo !== 'existente'); $('#modoNuevo').classList.toggle('hidden', modo !== 'nuevo'); }));
    $('#add').addEventListener('click', () => {
      const cantidad = Number($('#cant').value), costo = Number($('#costo').value);
      if (!Number.isInteger(cantidad) || cantidad < 1) return toast('La cantidad debe ser un entero mayor que cero.', 'error');
      if (!(costo >= 0)) return toast('El costo no puede ser negativo.', 'error');
      if (modo === 'existente') {
        const id = Number($('#lote').value); if (!id) return toast('Seleccione un lote.', 'error');
        if (lines.some((x) => x.lote_id === id)) return toast('Ese lote ya está en la compra.', 'error');
        lines.push({ lote_id: id, cantidad, costo_unitario: costo, nombre: $('#lote').selectedOptions[0].textContent });
      } else {
        const medicamento_id = Number($('#nmed').value), codigo_lote = $('#ncod').value.trim(), fecha_vencimiento = $('#nven').value;
        if (!medicamento_id) return toast('Seleccione el medicamento del lote nuevo.', 'error');
        if (!codigo_lote) return toast('Indique el código del lote.', 'error');
        if (!fecha_vencimiento) return toast('Indique la fecha de vencimiento.', 'error');
        if (lines.some((x) => x.nuevo && x.nuevo.medicamento_id === medicamento_id && x.nuevo.codigo_lote.toLowerCase() === codigo_lote.toLowerCase())) return toast('Ese lote nuevo ya está en la compra.', 'error');
        lines.push({ nuevo: { medicamento_id, codigo_lote, fecha_vencimiento, stock_minimo: Number($('#nmin').value) }, cantidad, costo_unitario: costo, nombre: `${$('#nmed').selectedOptions[0].textContent} — ${codigo_lote} (vence ${fdate(fecha_vencimiento)})` });
        $('#ncod').value = '';
      }
      draw();
    });
    view().onclick = (e) => { const d = e.target.closest('[data-del]'); if (d) { lines.splice(Number(d.dataset.del), 1); draw(); }
      const pre = e.target.closest('[data-pre]'); if (pre) { // atajo desde la orden: deja listo el medicamento y la cantidad solicitada en "Lote nuevo"
        view().querySelector('[data-modo="nuevo"]').click(); $('#nmed').value = pre.dataset.pre; $('#cant').value = pre.dataset.cant; $('#ncod').focus(); } };
    $('#save').addEventListener('click', async () => {
      const box = view().querySelector('[data-error]'); box.innerHTML = ''; const btn = $('#save'); btn.disabled = true;
      try {
        const r = await api.post('/api/compras', { proveedor_id: Number($('#prov').value), numero_documento: $('#doc').value, orden_id: $('#orden').value ? Number($('#orden').value) : null,
          items: lines.map(({ lote_id, nuevo, cantidad, costo_unitario }) => (nuevo ? { nuevo_lote: nuevo, cantidad, costo_unitario } : { lote_id, cantidad, costo_unitario })) });
        toast(`Compra #${r.compra_id} registrada: existencias actualizadas${r.lotes_creados?.length ? ` (${r.lotes_creados.length} lote(s) nuevo(s))` : ''}${r.orden_id ? `; orden #${r.orden_id} recibida` : ''}.`);
        if (r.advertencias?.length) toast(r.advertencias.join(' '), 'error');
        await nueva();
      } catch (err) { const l = (err.details || []).map((d) => `<li>${h(d)}</li>`).join(''); box.innerHTML = `<div class="formError" role="alert">${h(err.message)}${l ? `<ul>${l}</ul>` : ''}</div>`; }
      finally { btn.disabled = false; }
    });
    drawOrdenes(); draw();
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
