# FarmaControl 2.2 · Apariencia y preferencias

Estilo elegido por el equipo en el estudio de diseño (23 de noviembre de 2026), código `L5-P3-F8-I4-T5-A2` más la plantilla L6 para la caja:

| Elemento | Elección | Dónde está |
|---|---|---|
| Estructura | **L5 Riel compacto**: menú lateral de 76 px solo con iconos y su nombre al pasar el cursor; en el móvil se despliega con nombres | `views/css/app.css` (`.sidebar`, `.nav`), `views/js/main.js` |
| Caja | **L6 Ticket impreso**: el detalle de la venta se muestra como una boleta con bordes troquelados y letra monoespaciada | `views/js/pages/venta.js` (`.ticket`) |
| Colores | **Grafito**: tema **claro por defecto** y tema **oscuro** opcional | variables CSS en `:root` y `html[data-theme="oscuro"]` |
| Tipografía | **Fraunces** (títulos) + **Inter** (texto), alojadas en el propio proyecto (`views/fonts/`, licencia SIL OFL 1.1) | `@font-face` en `app.css` |
| Iconos | **En recuadro**: SVG propios por módulo | `views/js/iconos.js` |
| Tablas | **Cuadrícula**: bordes en todas las celdas | `th`, `td`, `.tableWrap` |
| Animación | **Deslizar**: las pantallas, el ticket y los diálogos entran deslizándose | `@keyframes fcUp/fcRight/fcModal` |

## Preferencias del usuario

- Menú **Cuenta › Preferencias** (todos los perfiles) y botón **Oscuro/Claro** en la barra superior y en el inicio de sesión.
- Opciones: **Tema** (Claro, predeterminado · Oscuro) y **Animaciones** (Activadas · Reducidas). Si el sistema operativo pide reducir movimiento, las animaciones se desactivan siempre.
- Se guardan en el almacenamiento local **del navegador** (`farmacontrol.tema`, `farmacontrol.animaciones`), **no en la base de datos ni en la cuenta**: en otro equipo se empieza con el tema claro. `views/js/tema.js` aplica el tema antes de pintar la página para evitar parpadeos.
- Las fuentes se sirven desde el mismo servidor porque la política de seguridad (CSP `default-src 'self'`) no permite cargar Google Fonts.

## Verificación

- 23/11/2026, servidor en **modo memoria** (no SQL Server), Chromium automatizado (`docs/evidencias/recorrido_ui_v22_apariencia.js`): tema inicial claro; el botón cambia a oscuro y se guarda; Preferencias vuelve a claro y persiste tras recargar; animaciones reducidas/activadas; fuentes Fraunces e Inter cargadas; tablas con bordes; vista móvil de 390 px sin desplazamiento horizontal; sin errores de JavaScript. El único error de consola fue un 422 esperado: el recorrido intentó confirmar una venta de un medicamento con receta sin seleccionar receta.
- Pruebas de la API: 68 aprobadas, 0 fallidas, 15 omitidas (las de SQL Server). El cambio es solo de la interfaz: no modifica la API ni la base de datos.
- Capturas en `docs/capturas_v22/`.
- Pendiente: probarlo con SQL Server y con usuarios reales; la impresión de la constancia no cambió.
