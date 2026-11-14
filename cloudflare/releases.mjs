export const releases = [
  {
    version: '0.4.1',
    notes: 'Correcciones de Excel, guardado y cálculos contables. Es la edición de la app web.',
    files: [
      { label: 'Windows', name: 'ContaEZ_0.4.1_x64-setup.exe', from: 'release' },
      { label: 'Mac (DMG)', name: 'ContaEZ-0.4.1-Mac-Apple-Silicon.dmg', from: 'release', source: 'Mac/ContaEZ-0.4.1-Mac-Apple-Silicon.dmg', optional: true },
      { label: 'Mac (ZIP)', name: 'ContaEZ-0.4.1-Mac-Apple-Silicon.app.zip', from: 'release', source: 'Mac/ContaEZ-0.4.1-Mac-Apple-Silicon.app.zip', optional: true },
      { label: 'Código fuente', name: 'ContaEZ-0.4.1-fuente.zip', from: 'release' },
    ],
  },
  {
    version: '0.4.0',
    notes: 'Revisión con un Excel modelo y primera edición para Mac Apple Silicon.',
    files: [
      { label: 'Windows', name: 'ContaEZ_0.4.0_x64-setup.exe', from: 'release' },
      { label: 'Mac (DMG)', name: 'ContaEZ-0.4.0-Mac-Apple-Silicon.dmg', from: 'release', source: 'Mac/ContaEZ-0.4.0-Mac-Apple-Silicon.dmg' },
      { label: 'Mac (ZIP)', name: 'ContaEZ-0.4.0-Mac-Apple-Silicon.app.zip', from: 'release', source: 'Mac/ContaEZ-0.4.0-Mac-Apple-Silicon.app.zip' },
      { label: 'Código fuente', name: 'ContaEZ-0.4.0-fuente.zip', from: 'release' },
    ],
  },
  { version: '0.3.0', notes: 'Contexto por práctica, propuestas de fórmulas y revisión explicada.', files: [{ label: 'Windows', name: 'ContaEZ_0.3.0_x64-setup.exe', from: 'release' }] },
  { version: '0.2.0', notes: 'Flujo para revisar una copia del mismo libro de Excel.', files: [
    { label: 'Windows', name: 'ContaEZ_0.2.0_x64-setup.exe', from: 'release' },
    { label: 'Código fuente', name: 'ContaEZ-0.2.0-fuente.zip', from: 'oldSite' },
  ] },
  { version: '0.1.0', notes: 'Primer piloto de escritorio para Windows.', files: [{ label: 'Windows', name: 'ContaEZ_0.1.0_x64-setup.exe', from: 'release' }] },
];
