// Iconos SVG propios (trazo de 24×24), uno por módulo. Se muestran «en recuadro» en el riel lateral.
const D = {
  inicio: 'M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z',
  venta: 'M3 4h2.2l2.3 10.5h10.3L20.5 7H6 M8.5 19.5h.01 M17 19.5h.01',
  ventas: 'M3 12a9 9 0 1 0 2.6-6.4L3 8 M3 3v5h5 M12 7v5l3 2',
  compras: 'M2 6h11v10H2z M13 9.5h4.2l3 3.2V16H13z M5 18a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0 M15 18a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0',
  medicamentos: 'M10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z M8.5 8.5l7 7',
  alertas: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
  reposicion: 'M21 12a9 9 0 0 1-15.5 6.2 M3 12a9 9 0 0 1 15.5-6.2 M18.5 2v4h-4 M5.5 22v-4h4',
  movimientos: 'M7 4v16 M3 8l4-4 4 4 M17 20V4 M13 16l4 4 4-4',
  clientes: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  recetas: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  proveedores: 'M3 21h18 M5 21V9l7-5 7 5v12 M9 21v-5h6v5 M9 12h6',
  reportes: 'M3 3v18h18 M8 17v-5 M13 17V8 M18 17v-9',
  usuarios: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5 M7.8 17a4.3 4.3 0 0 1 8.4 0',
  auditoria: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  preferencias: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  perfil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21a8 8 0 0 1 16 0',
  llave: 'M14.5 4a5.5 5.5 0 1 1-4.8 8.2L3 19v2h3v-2h2v-2h2l1.2-1.2 M16.5 7.5h.01',
  salir: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  sol: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  luna: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
};
export const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${D[name] || D.inicio}"></path></svg>`;
