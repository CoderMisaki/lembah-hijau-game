// icons.js — satu set ikon SVG yang digambar dari kode untuk seluruh UI game.
// Gaya konsisten: viewBox 24, stroke currentColor (mengikuti warna teks),
// stroke-width 1.8, fill none kecuali perlu, garis membulat.
// Dipakai lewat icon(name); semua key di bawah harus ada sebelum dipakai
// (lihat verifikasi lane D). Tidak ada aset eksternal.
const svg = (inner) =>
  `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

export const ICONS = {
  leaf: svg('<path d="M5 19C5 9.5 11.5 4.5 20 4.5 20 13 14.5 19 5 19Z"/><path d="M5 19c3.5-5.5 7.5-8.5 11.5-9.5"/>'),
  coin: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2v9.6M15 9.4c-.5-1.2-1.6-1.9-3-1.9-1.7 0-3 1-3 2.3 0 3.2 6 1.6 6 4.3 0 1.3-1.3 2.3-3 2.3-1.4 0-2.5-.7-3-1.9"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  save: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
  load: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5M9.5 13.5 12 16l2.5-2.5"/>'),
  customize: svg('<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.12a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2Z"/><circle cx="7.5" cy="11.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="11" cy="7.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="17.5" cy="13" r="1.15" fill="currentColor" stroke="none"/>'),
  shop: svg('<circle cx="9" cy="21" r="1.2"/><circle cx="20" cy="21" r="1.2"/><path d="M1.5 1.5h3.6l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22.5 6H6"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>'),
  jump: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  run: svg('<circle cx="15" cy="4.6" r="2"/><path d="M14 8.2 11.4 12.4"/><path d="M13.2 9.2 16.6 7.6"/><path d="M13.4 10.2 10.2 12.2"/><path d="M11.4 12.4 14.8 15.2 13.8 19.6"/><path d="M11.4 12.4 7.8 14.8 9 18.8"/>'),
  play: svg('<path d="M7 4.8v14.4L19 12Z" fill="currentColor" stroke="none"/>'),
  'farmer-male': svg('<path d="M4 13.5h16"/><path d="M7 13.5a5 5 0 0 1 10 0"/><circle cx="12" cy="17.2" r="3.2"/><path d="M10.9 17.6h2.2"/>'),
  'farmer-female': svg('<path d="M4 13.5h16"/><path d="M7 13.5a5 5 0 0 1 10 0"/><circle cx="12" cy="17.2" r="3.2"/><path d="M8.8 15.2c-.7 2.2-.7 3.8-.2 5.3M15.2 15.2c.7 2.2.7 3.8.2 5.3"/><path d="M10.9 17.6h2.2"/>'),
  sprout: svg('<path d="M12 13.5V21"/><path d="M12 13.5C12 9 9 6 4.5 6c0 4.5 3.5 7.5 7.5 7.5Z"/><path d="M12 11.5c0-3.8 2.8-6.2 7.5-6.2 0 4.3-3.2 6.8-7.5 6.2Z"/>'),
  carrot: svg('<path d="M12 6.5C10.5 4 8.5 3 6.5 3.5M12 6.5c0-2.5 1-4.3 3-5M12 6.5c1.5-1.8 3.2-2.5 4.8-2"/><path d="M8.5 7.5h7c-.4 4.8-1.8 8.8-3.5 11.5C10.3 16.3 8.9 12.3 8.5 7.5Z"/><path d="M10 11.5h2.4M10.6 15h1.8"/>'),
  tomato: svg('<path d="M12 7.5c-4.6 0-8 3.4-8 7.7a8 8 0 0 0 16 0c0-4.3-3.4-7.7-8-7.7Z"/><path d="M12 7.5V4.8M12 5.5C10.5 4.5 9 4.3 7.5 4.8M12 5.5c1.5-1 3-1.2 4.5-.7"/>'),
  pumpkin: svg('<path d="M12 6.5C7 6.5 3.5 9.8 3.5 13.8S7 21 12 21s8.5-3.2 8.5-7.2S17 6.5 12 6.5Z"/><path d="M12 6.5V4.5M12 4.5c.8-.8 1.8-1 2.8-.8"/><path d="M8.2 7.8c-1.3 1.8-1.3 10.6 0 12.4M15.8 7.8c1.3 1.8 1.3 10.6 0 12.4"/>'),
  wheat: svg('<path d="M12 21V8"/><path d="M12 8C10.2 6.5 10.2 4 12 3c1.8 1 1.8 3.5 0 5Z"/><path d="M12 11c-2.6 0-4.2-1.6-4.2-4.2C10.4 6.8 12 8.4 12 11Z"/><path d="M12 11c2.6 0 4.2-1.6 4.2-4.2C13.6 6.8 12 8.4 12 11Z"/><path d="M12 16c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2Z"/><path d="M12 16c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2Z"/>'),
  egg: svg('<path d="M12 3.5c3.2 3.6 5.5 6.6 5.5 9.9a5.5 5.5 0 0 1-11 0c0-3.3 2.3-6.3 5.5-9.9Z"/>'),
  milk: svg('<path d="M9 3.5h6l2 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-12Z"/><path d="M9 3.5 12 7.5 15 3.5"/><path d="M9.5 13h5"/>'),
  chicken: svg('<path d="M14.8 5.5c.2-1.3 1.8-1.3 2 0 .2-1.3 1.8-1.3 2 0"/><circle cx="16.5" cy="8" r="2.7"/><path d="M19.2 7.4 21.5 8.5l-2.3 1.2"/><circle cx="17.3" cy="7.6" r=".8" fill="currentColor" stroke="none"/><path d="M14.3 9.6C12 8 8.8 8.2 6.6 10.3c-2.2 2.1-2.5 5.2-.8 7.4 1.6 2 4.6 2.4 7 1.4 2.2-.9 3.4-3 3-5.2"/><path d="M6 12.8 3.5 11M6.8 14.8 4.2 13.8"/><path d="M9.5 19.2v1.8M13 19v2"/>'),
  cow: svg('<path d="M7 8c-.6-2-1.8-3.2-3.5-3.6M17 8c.6-2 1.8-3.2 3.5-3.6"/><path d="M6.5 8h11V14a5.5 5.5 0 0 1-11 0Z"/><path d="M6.5 9.5 3.5 8v3l3 1M17.5 9.5l3-1.5v3l-3 1"/><path d="M9.5 12h.01M14.5 12h.01"/><path d="M9 15h6v1.5a2.5 2.5 0 0 1-2.5 2.5h-1A2.5 2.5 0 0 1 9 16.5Z"/><path d="M10.8 16.8h.01M13.2 16.8h.01"/>'),
  water: svg('<path d="M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0C6 9.8 12 3.5 12 3.5Z"/>'),
  hoe: svg('<path d="M4.5 19.5 15 9"/><path d="M13.5 5.5 18 4l1.5 4.5L15 10Z"/>'),
  basket: svg('<path d="M4.5 10.5h15l-1.4 8a2 2 0 0 1-2 1.5H7.9a2 2 0 0 1-2-1.5Z"/><path d="M8.5 10.5a3.5 3.5 0 0 1 7 0"/><path d="M9.5 14.5v3.5M12 14.5V19M14.5 14.5v3.5"/>'),
  sleep: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>'),
  'phone-rotate': svg('<rect x="6.5" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/><path d="M17.5 3a6.5 6.5 0 0 1 3 5.5"/><path d="M20.5 8.5v-3h-3"/>'),
  crate: svg('<path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16Z"/><path d="M3.5 8 12 12.5 20.5 8M12 12.5v8"/>'),
};

// Alias: nama lain untuk ikon yang sama.
ICONS.seed = ICONS.sprout;
ICONS.box = ICONS.crate;

// Kembalikan string SVG statis untuk nama ikon; '' bila nama tidak dikenal.
export function icon(name) {
  return ICONS[name] || '';
}
