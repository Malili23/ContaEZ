# Componentes de terceros

ContaEZ contiene código propio bajo GPL-3.0. Sus dependencias conservan sus licencias y avisos. Las versiones exactas de JavaScript están fijadas en `package-lock.json`; las de Rust, en `src-tauri/Cargo.lock`.

- React, React DOM, Decimal.js, ExcelJS, fflate y fast-xml-parser: MIT, según los paquetes incluidos.
- Tauri: licencias MIT/Apache-2.0; sus complementos conservan sus avisos.
- PDF.js y Tesseract.js/Tesseract.js-core: Apache-2.0.
- Lucide: ISC.
- DM Sans y Manrope: SIL Open Font License 1.1.
- El modelo de español Tesseract se distribuye para reconocimiento local; su procedencia y huella están en `public/ocr/modelo.json`.

Los avisos de los componentes principales se conservan también en `public/third-party/` y los de OCR en `public/ocr/`. El código fuente completo y las dependencias se pueden obtener a través de sus registros y repositorios oficiales usando los archivos de bloqueo.

Los libros NIF, las prácticas originales, recibos y datos privados de usuarios no forman parte de la distribución.
