import { title, toast } from '../ui.js';
import { icon } from '../iconos.js';

// Preferencias de apariencia de cada usuario en este navegador: tema (claro predeterminado u oscuro) y animaciones.
// Se guardan en el almacenamiento local del navegador; no se envían al servidor ni a la base de datos.
export async function render(el, ctx) {
  const prefs = window.FCPrefs;
  const draw = () => {
    const p = prefs.leer();
    el.innerHTML = title('Preferencias', 'Ajuste cómo se ve FarmaControl en este equipo. Los cambios se aplican al instante.') + `
    <div class="panel"><h3>Tema</h3>
      <div class="prefGrid" role="group" aria-label="Tema de la interfaz">
        ${[['claro', 'Claro', 'Predeterminado. Fondo claro, ideal con buena iluminación.', 'sol'], ['oscuro', 'Oscuro (grafito)', 'Fondo oscuro, reduce el brillo de la pantalla.', 'luna']].map(([v, n, d, ic]) => `
        <button type="button" class="themeCard" data-tema="${v}" aria-pressed="${p.tema === v}">
          <span class="mini ${v}" aria-hidden="true"><span class="mr"><i class="on"></i><i></i><i></i><i></i></span><span class="mc"><b></b><span></span><span></span></span></span>
          <span class="tname"><span>${n}</span>${icon(ic)}</span>
          <span class="muted" style="font-size:13px">${d}</span>
        </button>`).join('')}
      </div>
    </div>
    <div class="panel"><h3>Animaciones</h3>
      <p class="muted" style="margin:0 0 12px">Las pantallas aparecen deslizándose. Puede reducirlas si le distraen o si el equipo es lento.</p>
      <div class="prefRow" role="group" aria-label="Animaciones">
        <button type="button" class="btn ${p.animaciones === 'normal' ? 'primary' : ''}" data-mov="normal" aria-pressed="${p.animaciones === 'normal'}">Activadas</button>
        <button type="button" class="btn ${p.animaciones === 'reducido' ? 'primary' : ''}" data-mov="reducido" aria-pressed="${p.animaciones === 'reducido'}">Reducidas</button>
      </div>
    </div>
    <div class="notice">Estas preferencias se guardan solo en este navegador de este equipo, no en su cuenta. En otro equipo o navegador se usará el tema claro hasta que lo cambie allí.</div>`;
  };
  draw();
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tema]'); const m = e.target.closest('[data-mov]');
    if (t) { prefs.tema(t.dataset.tema); window.dispatchEvent(new Event('fc:tema')); draw(); toast(t.dataset.tema === 'oscuro' ? 'Tema oscuro aplicado.' : 'Tema claro aplicado.'); }
    if (m) { prefs.animaciones(m.dataset.mov); draw(); toast(m.dataset.mov === 'reducido' ? 'Animaciones reducidas.' : 'Animaciones activadas.'); }
  });
}
