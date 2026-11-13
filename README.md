# ContaEZ

Contabilidad mexicana gratuita para prácticas universitarias, empresas comerciales y personas físicas. En prácticas, subes tu Excel y recibes una copia de ese mismo libro con correcciones y vínculos comprobables, sin volver a capturar sus operaciones. Las modalidades profesionales ofrecen un motor contable y reportes vinculados.

**Creada por [@betcover_ii](https://www.instagram.com/betcover_ii/)** · [gallardoquirozd4@gmail.com](mailto:gallardoquirozd4@gmail.com)

> ContaEZ está diseñada exclusivamente para contabilidad y obligaciones fiscales de México, dentro de los regímenes, ejercicios y módulos indicados.

## Empezar

La entrega local se encuentra en `Escritorio\ContaEz app`. Abre `ContaEZ.exe` para utilizar la versión de escritorio. Es una **versión piloto de Windows sin firma de editor**; la firma de distribución sigue pendiente.

La compilación de macOS para Apple Silicon está preparada en GitHub Actions. **No se ha verificado todavía en un Mac M1 real y no se anuncia como una descarga Mac terminada.**

El inicio tiene dos apartados: **Tu práctica de Excel** a la izquierda y **Contexto para corregirla** a la derecha. Elige el `.xlsx` que quieres corregir y, si lo necesitas, agrega un Excel correcto, fotos, CFDI XML, PDF o una nota como `el asiento en Diario!C1 no funciona`. Pulsa **Revisar mi práctica con este contexto**, revisa las propuestas y descarga la copia. No es necesario crear una empresa ni un catálogo. **Otras modalidades** abre Empresa comercial o Persona física. La guía está en [docs/USO.md](docs/USO.md) y el detalle de cobertura en [docs/ALCANCE.md](docs/ALCANCE.md).

## Qué contiene esta versión

- Prácticas universitarias: revisión sobre el libro original, conservación de sus hojas, datos y presentación; vínculos entre diario, mayor, balanza y estados cuando la estructura y el origen permiten comprobarlos.
- Contexto por práctica: archivos y notas junto al Excel principal, antes o después de revisarlo. Un Excel de referencia con la misma estructura puede aportar propuestas de fórmulas para las celdas indicadas; se muestran origen, destino y fórmula antes de confirmar su aplicación.
- Empresa comercial: apertura, movimientos, inventarios, activos, revisión, bancos y papeles de trabajo del régimen general de personas morales.
- Persona física: cobros, pagos, gastos y papeles de trabajo de actividad empresarial o profesional.
- Importación de Excel, CFDI XML, CSV bancarios, PDF e imágenes. La extracción ambigua requiere confirmación.
- Detección de referencias rotas, ciclos, errores guardados como texto, duplicados e inconsistencias de periodos e importes.
- Copias revisadas de libros con explicación de cambios y pendientes; el original permanece intacto.
- Chat gratuito de cada práctica para aclarar referencias y aportar instrucciones al contexto. Los adjuntos permanecen asociados al archivo correspondiente; no generan operaciones en una contabilidad nueva ni convierten instrucciones ambiguas en datos inventados.
- En las modalidades profesionales, chat guiado para completar datos, proponer movimientos y cambiar el método o periodo después de confirmar; inventarios analíticos, perpetuos, PEPS y promedio móvil.
- Excel vinculado, respaldos de proyectos e historial de revisiones.

Los cálculos básicos no necesitan una cuenta de IA. ChatGPT es opcional, con autorización de la cuenta y plan elegible del usuario. Google Sheets necesita un cliente OAuth de escritorio configurado y autorización del usuario. El perfil de exportación a CONTPAQi todavía requiere validación con el producto y versión de destino.

Los documentos de contexto no aportan automáticamente saldos ni importes a la práctica. Las fotos, PDF y CFDI pueden requerir aclaraciones; su lectura no acredita deducibilidad, validez fiscal ni la corrección completa del ejercicio. Las propuestas de un Excel modelo necesitan una estructura compatible, una celda de destino identificada y confirmación del usuario.

## Validación y límites

Se probaron el motor contable, los importadores y el almacenamiento nativo. El conjunto incluye pruebas automatizadas de JavaScript/TypeScript y **6 pruebas nativas de Rust**. La verificación de recálculo real en Excel para Windows pasó **292 comparaciones numéricas** de los casos comprobados. Estos resultados describen esas pruebas; no constituyen una auditoría integral de cualquier archivo que se importe.

Los papeles fiscales automáticos corresponden al paquete **México 2026**, en los regímenes indicados. Un proyecto de 2025 no reutiliza silenciosamente la tarifa de 2026. Las retenciones, acumulados, deducibilidad y otros datos necesarios deben confirmarse. Las reglas incorporadas son implementaciones propias y acotadas: **no se afirma cobertura integral ni certificación de todas las NIF**.

Las pruebas reales de autorización de ChatGPT y Google requieren sus cuentas y permisos. La compilación de un complemento Office.js o de un instalador Mac no demuestra que funcione dentro de Excel Mac o en un M1: esas verificaciones se mantienen pendientes hasta ejecutarlas.

## Desarrollo reproducible

Requisitos: Node.js 24 o posterior y npm. La aplicación de escritorio requiere Rust estable y las herramientas nativas de la plataforma; en Windows, Visual Studio Build Tools con C++ y Windows SDK.

```powershell
npm ci
npm test
npm run build
npm run dev
```

El servidor de desarrollo usa `http://127.0.0.1:1420`. La vista web guarda los proyectos en IndexedDB del navegador; la versión de escritorio usa SQLite local con contenido cifrado AES-256-GCM y una clave protegida por el sistema operativo.

Para compilar Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
```

Para compilar únicamente el ejecutable, sin instalador:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1 -NoBundle
```

El flujo [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) prepara los objetivos `x86_64-pc-windows-msvc` y `aarch64-apple-darwin`. Los artefactos salen sin firma; la firma Windows y la firma/notarización Apple requieren las credenciales del editor.

Pruebas nativas:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

La prueba del almacén seguro utiliza una entrada temporal y necesita una sesión del sistema con ese servicio disponible. El flujo CI omite específicamente esa prueba de integración con el almacén del sistema y ejecuta las restantes.

Para revisar un conjunto privado de prácticas con el mismo revisor de la app:

```powershell
npm run test:practices -- --source "C:\ruta\privada\pruebas" --output "C:\ruta\privada\revisadas" --report "C:\ruta\privada\revision.json"
```

El comando escribe copias versionadas, verifica la conservación de originales y comprueba que una segunda reparación no proponga cambios adicionales. El archivo de resumen muestra qué sigue pendiente. No certifica por sí mismo el recálculo en Excel.

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/core` | Catálogo, reglas, contabilidad, inventarios, fiscal, chat e historial |
| `src/io` | Importación, auditoría, reparaciones y exportación de libros |
| `src/desktop` | Conexiones autorizadas de ChatGPT y Google |
| `src-tauri` | Aplicación nativa, almacenamiento cifrado y autorización |
| `addin` | Complemento Office.js y su guía de instalación |
| `site` | Página de descarga y acceso a la vista web |
| `tests` | Pruebas sintéticas; no contiene el conjunto privado original |

## Información privada

Los originales de ejercicios, recibos, RFC, UUID y datos de terceros **no deben publicarse en el repositorio ni incluirse en el ZIP de código**. Mantén el conjunto real de pruebas fuera del proyecto público. Los respaldos `.contaez` y las exportaciones Excel contienen información del usuario: guárdalos en un lugar privado. El respaldo descargado es un archivo portable y no hereda el cifrado del almacén nativo.

No borres el almacén de credenciales del sistema sin conservar respaldos: su clave permite abrir los datos cifrados de escritorio. La vista web depende del almacenamiento del navegador y puede perder sus datos al borrarlo.

## Licencia

El código propio se distribuye bajo [GNU GPL versión 3](LICENSE), identificador `GPL-3.0-only`. Las dependencias conservan sus respectivas licencias. Los libros NIF y otros materiales de terceros no se incluyen ni se relicencian por formar parte de una referencia contable.

## OCR local

Los recursos de reconocimiento de español se incluyen en el programa. `npm run build` prepara el trabajador y modelo local; el primer desarrollo descarga el modelo oficial si aún no está en `public/ocr`. El uso de reconocimiento de imágenes no necesita enviar los recibos a un servicio de IA.

El revisor de prácticas se ejecuta con `npm run test:practices -- --source "CARPETA_DE_ORIGINALES" --output "CARPETA_DE_COPIAS"`; por defecto utiliza las carpetas privadas del proyecto, excluidas de la distribución.
