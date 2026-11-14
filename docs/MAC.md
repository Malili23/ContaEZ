# ContaEZ para Mac con Apple Silicon

**Paquete piloto para M1 o posterior, macOS 14 o posterior, ARM64 nativo.** La versión 0.4.0 se compiló en el runner M1 con macOS 15 de GitHub Actions: aprobaron las pruebas automatizadas, la comprobación de arquitectura, el mínimo declarado, la firma ad-hoc, la estructura del DMG y un arranque nativo mínimo. [Ejecución de compilación](https://github.com/Malili23/ContaEZ/actions/runs/43560290720).

El paquete todavía no tiene Developer ID ni notarización de Apple. El arranque de cinco segundos no sustituye las pruebas visuales y de uso en macOS 14 y versiones actuales indicadas al final de esta guía.

## Obtener el paquete desde GitHub

La entrega local incluye el DMG, el ZIP de la app y las sumas de comprobación en la carpeta Mac de ContaEz app. Puedes obtener el artefacto completo desde la ejecución de GitHub enlazada arriba. Para compilar otra copia:

1. En el repositorio que contenga este código, abre **Actions → Compilar ContaEZ → Run workflow**.
2. Espera a que termine el trabajo **macos-arm64**. Una compilación fallida no produce un paquete aprobado.
3. Descarga el artefacto **ContaEZ-macos-arm64-adhoc-no-notarizada**. Contiene el DMG, una copia ZIP de `ContaEZ.app`, `SHA256SUMS.txt` y `BUILD-INFO.txt`.
4. Compara las sumas con `shasum -a 256 -c SHA256SUMS.txt`, manteniendo la carpeta `dmg/` indicada en el archivo.
5. Abre el DMG y arrastra ContaEZ a Aplicaciones. El ZIP alternativo conserva los permisos y enlaces internos de la app.

El flujo usa el runner `macos-15`, que GitHub documenta actualmente como M1/ARM64, y comprueba la arquitectura con `lipo`. No publica una release ni necesita credenciales de Apple para la firma ad-hoc. [Referencia de runners de GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Compilar en tu Mac

Necesitas Node.js 24 LTS, Rust mediante rustup y las herramientas de línea de comandos de Xcode. Para instalar estas últimas, ejecuta `xcode-select --install` y termina su instalación antes de continuar. [Requisitos oficiales de Tauri](https://v2.tauri.app/start/prerequisites/), [Node.js](https://nodejs.org/), [Rust](https://www.rust-lang.org/tools/install).

Desde la carpeta de ContaEZ:

```bash
bash scripts/build-macos.command
```

También puedes conceder permiso de ejecución una vez con `chmod +x scripts/build-macos.command scripts/build-macos.sh` y abrir el archivo `.command` con doble clic. Ejecuta Terminal de forma nativa, sin Rosetta.

El proceso instala el compilador Rust 1.100.0 y el destino ARM64, usa los archivos de dependencias bloqueadas, ejecuta las pruebas y genera `.app` y `.dmg` en `src-tauri/target/aarch64-apple-darwin/release/bundle/`. La compilación utiliza `MACOSX_DEPLOYMENT_TARGET=14.0` y comprueba el mínimo del `Info.plist` generado. Esto hace repetible el proceso; no promete archivos idénticos byte por byte. [Destino ARM64 y variable de despliegue de Rust](https://doc.rust-lang.org/rustc/platform-support/apple-darwin.html), [paquete macOS de Tauri](https://v2.tauri.app/distribute/macos-application-bundle/).

## Firma y primera apertura

Esta edición utiliza `signingIdentity: "-"`: una firma **ad-hoc**, sin identidad Developer ID y sin notarización de Apple. macOS puede impedir su primera apertura. La verificación de `codesign` solo confirma la integridad de esa firma; no equivale a aprobación de Apple. [Firma ad-hoc de Tauri](https://v2.tauri.app/distribute/sign/macos/).

Para una distribución pública verificada hacen falta Developer ID, notarización y pruebas de instalación. El flujo actual no pretende completar esos pasos ni almacena certificados privados. Si decides probar el paquete ad-hoc de una fuente que conoces, sigue el procedimiento de Apple en Privacidad y seguridad; no desactives Gatekeeper globalmente. [Apertura de apps en macOS](https://support.apple.com/en-us/102445), [notarización de Apple](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Datos, Llavero y conexiones

La edición nativa guarda los registros con AES-256-GCM en SQLite y mantiene su clave en el Llavero de macOS mediante `keyring/apple-native`. SQLite se compila con el programa: no requiere instalar una base de datos aparte. Son registros cifrados, no un archivo SQLite cifrado íntegramente; identificadores y metadatos de la tabla permanecen visibles. La clave no se guarda en el navegador ni se copia dentro de la base. Copiar únicamente el archivo SQLite a otro equipo no transfiere su clave.

Si el Llavero rechaza el acceso, no borres la base ni la clave para intentar recuperarlo: conserva ambas y revisa el acceso de ContaEZ. La app se detiene si falta la clave de una base existente. [Backend nativo de keyring 3](https://docs.rs/keyring/3.6.3/keyring/).

La autorización abre el navegador del sistema y recibe el retorno en un puerto efímero de `127.0.0.1`; el listener no se expone a la red local. Requiere Internet y permisos del proveedor. Las pruebas locales no certifican la autorización real de ChatGPT o Google.

## Qué comprueba el flujo y qué falta probar

CI ejecuta pruebas TypeScript y Rust, incluida una escritura/lectura/borrado de un secreto temporal en un Llavero exclusivo del runner. Comprueba arquitectura ARM64, configuración mínima de macOS, firma y estructura del DMG. En CI también inicia el programa nativo, verifica que su proceso permanezca activo cinco segundos y cierra únicamente ese proceso con tiempo limitado. El resultado se adjunta en `STARTUP-TEST.txt`; no comprueba botones ni lectura visual de la pantalla. En una compilación local se omite el test interactivo del Llavero por defecto; puedes activarlo con `CONTAEZ_TEST_KEYCHAIN=1 bash scripts/build-macos.sh`.

Antes de declarar una versión probada en Mac, verifica manualmente en macOS 14 y en una versión actual:

- Abrir desde Aplicaciones, crear un proyecto, cerrar, reiniciar y recuperar sus datos.
- Subir un Excel propio, revisar la copia y guardarla mediante el diálogo nativo; cancelar el diálogo no debe crear un archivo.
- Confirmar que una exportación fallida conserva el destino anterior y que abrir la copia en Excel mantiene fórmulas, estilos e imágenes.
- Probar PDF, OCR de una imagen y los workers en WKWebView. La política actual permite workers locales/blob y WebAssembly; esa configuración no sustituye una prueba real de OCR en Mac.
- Autorizar y desconectar cuentas desde el navegador, comprobar cancelación y volver a intentarlo.

La edición del navegador tiene almacenamiento y permisos distintos a la edición nativa. No utiliza este Llavero ni este almacén SQLite.
