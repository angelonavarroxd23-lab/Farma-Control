// Preferencias de apariencia guardadas en este navegador (no en la base de datos).
// Se carga en <head> como script clásico para aplicar el tema antes de pintar la página y evitar el parpadeo.
// Tema predeterminado: claro. Animaciones predeterminadas: activadas (salvo que el sistema pida reducir movimiento).
(function () {
  var KEY_TEMA = 'farmacontrol.tema';
  var KEY_MOV = 'farmacontrol.animaciones';
  function leer(k, def) { try { return localStorage.getItem(k) || def; } catch (e) { return def; } }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* almacenamiento no disponible: se aplica solo en esta sesión */ } }
  function aplicar() {
    var tema = leer(KEY_TEMA, 'claro') === 'oscuro' ? 'oscuro' : 'claro';
    var mov = leer(KEY_MOV, 'normal') === 'reducido' ? 'reducido' : 'normal';
    document.documentElement.setAttribute('data-theme', tema);
    document.documentElement.setAttribute('data-motion', mov);
    return { tema: tema, animaciones: mov };
  }
  window.FCPrefs = {
    leer: function () { return aplicar(); },
    tema: function (v) { guardar(KEY_TEMA, v === 'oscuro' ? 'oscuro' : 'claro'); return aplicar(); },
    animaciones: function (v) { guardar(KEY_MOV, v === 'reducido' ? 'reducido' : 'normal'); return aplicar(); },
    alternarTema: function () { return this.tema(leer(KEY_TEMA, 'claro') === 'oscuro' ? 'claro' : 'oscuro'); }
  };
  aplicar();
})();
