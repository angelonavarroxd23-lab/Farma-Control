import { api } from '../api.js';
import { h, modal, today, toast, showError } from '../ui.js';

// Formulario de receta con detalle (medicamentos prescritos). Se usa en caja (Nueva venta) y en la página Recetas.
// Las reglas (vigencia, unicidad del número, detalle válido) las valida el servidor.
export async function nuevaReceta({ clientes, clienteId = null, onCreated }) {
  const meds = (await api.get('/api/medicamentos?activo=true')).sort((a, b) => Number(b.requiere_receta) - Number(a.requiere_receta) || a.nombre.localeCompare(b.nombre));
  let items = [];
  const m = modal({
    title: 'Registrar receta', wide: true,
    body: `<div data-error></div><form novalidate>
      <div class="grid2e"><div class="field"><label for="rf_cli">Cliente (titular) *</label><select class="input" id="rf_cli" ${clienteId ? 'disabled' : ''}>${clienteId ? '' : '<option value="">Seleccione…</option>'}${clientes.map((c) => `<option value="${c.cliente_id}" ${c.cliente_id === Number(clienteId) ? 'selected' : ''}>${h(c.nombre_razon_social)} · ${h(c.numero_documento)}</option>`).join('')}</select></div>
      <div class="field"><label for="rf_num">Número de receta *</label><input class="input" id="rf_num" maxlength="50"></div></div>
      <div class="field"><label for="rf_pre">Prescriptor *</label><input class="input" id="rf_pre" maxlength="160" placeholder="Nombre del médico"></div>
      <div class="grid2e"><div class="field"><label for="rf_em">Fecha de emisión *</label><input class="input" id="rf_em" type="date" value="${today()}"></div>
      <div class="field"><label for="rf_vc">Vigente hasta *</label><input class="input" id="rf_vc" type="date"></div></div>
      <div class="field"><label for="rf_obs">Observación</label><input class="input" id="rf_obs" maxlength="250"></div>
      <h3 style="margin:18px 0 8px">Medicamentos prescritos</h3>
      <div class="grid2e"><div class="field"><label for="rf_med">Medicamento</label><select class="input" id="rf_med"><option value="">Seleccione…</option>${meds.map((x) => `<option value="${x.medicamento_id}">${h(x.nombre)} — ${h(x.presentacion)}${x.requiere_receta ? ' (con receta)' : ''}</option>`).join('')}</select></div>
      <div class="field"><label for="rf_cant">Cantidad (unidades de venta)</label><input class="input" id="rf_cant" type="number" min="1" value="1"></div></div>
      <div class="field"><label for="rf_ind">Indicaciones (opcional)</label><input class="input" id="rf_ind" maxlength="250" placeholder="Ej.: 1 cápsula cada 8 horas por 7 días"></div>
      <button class="btn" type="button" id="rf_add">+ Agregar a la receta</button>
      <div id="rf_items" style="margin-top:10px"></div></form>`,
    footer: '<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" data-save type="button">Guardar receta</button>',
  });
  const $ = (s) => m.el.querySelector(s);
  const draw = () => { $('#rf_items').innerHTML = items.length ? items.map((x, i) => `<div class="detailLine"><div><b>${h(x.nombre)}</b><small>${x.cantidad} unidad(es)${x.indicaciones ? ' · ' + h(x.indicaciones) : ''}</small></div><div><button class="btn small danger" type="button" data-rm="${i}">Quitar</button></div></div>`).join('') : '<p class="empty">Agregue los medicamentos que prescribe la receta.</p>'; };
  $('#rf_add').addEventListener('click', () => {
    const id = Number($('#rf_med').value), cantidad = Number($('#rf_cant').value);
    if (!id) return toast('Seleccione un medicamento.', 'error');
    if (!Number.isInteger(cantidad) || cantidad < 1) return toast('La cantidad debe ser un entero mayor que cero.', 'error');
    if (items.some((x) => x.medicamento_id === id)) return toast('Ese medicamento ya está en la receta.', 'error');
    items.push({ medicamento_id: id, cantidad, indicaciones: $('#rf_ind').value.trim() || null, nombre: $('#rf_med').selectedOptions[0].textContent });
    $('#rf_ind').value = ''; $('#rf_cant').value = 1; $('#rf_med').value = ''; draw();
  });
  m.el.addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r) { items.splice(Number(r.dataset.rm), 1); draw(); } });
  $('[data-save]').addEventListener('click', async () => {
    const btn = $('[data-save]'); btn.disabled = true;
    try {
      if (!items.length) throw Object.assign(new Error('Datos no válidos.'), { details: ['Agregue al menos un medicamento a la receta.'] });
      const r = await api.post('/api/recetas', {
        cliente_id: Number($('#rf_cli').value) || null, numero_receta: $('#rf_num').value, nombre_prescriptor: $('#rf_pre').value, fecha_emision: $('#rf_em').value,
        fecha_vencimiento: $('#rf_vc').value, observacion: $('#rf_obs').value, items: items.map(({ medicamento_id, cantidad, indicaciones }) => ({ medicamento_id, cantidad, indicaciones })) });
      toast('Receta registrada.'); m.close(); await onCreated?.(r);
    } catch (e) { showError(m.el, e); } finally { btn.disabled = false; }
  });
  draw();
  return m;
}
