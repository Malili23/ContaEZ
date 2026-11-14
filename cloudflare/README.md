# Publicar ContaEZ en Cloudflare Pages

El proyecto de producción se llama `contaez-mexico`. La página muestra la app web y el historial de instaladores. Los paquetes y sus sumas se preparan a partir de archivos locales de distribución.

1. Compila la app web con `npm ci` y `npm run build` en la carpeta de ContaEZ.
2. Coloca los instaladores y ZIP de código indicados por `cloudflare/releases.mjs` en la carpeta de distribución. Conserva los nombres y archivos de las versiones anteriores.
3. Ejecuta `node cloudflare/prepare.mjs https://contaez-mexico.pages.dev`. El comando devuelve `output`, la ruta de una carpeta nueva que contiene la página, la app y los instaladores.
4. Desde una sesión autorizada de Cloudflare, ejecuta `npx wrangler@4 pages deploy "RUTA_OUTPUT" --project-name contaez-mexico --branch main`.
5. Comprueba `https://contaez-mexico.pages.dev/version.json` y descarga un archivo para comparar su SHA-256 con el listado de la página.

Pages admite los instaladores actuales como archivos estáticos. Un archivo superior a 25 MiB se rechaza al preparar el sitio. Si una futura versión supera el límite, puede servirse como objeto de R2. [Límite de archivos de Pages](https://developers.cloudflare.com/pages/platform/limits/).

La preparación toma los paquetes publicados por nombre. Las prácticas, respaldos, comprobantes, catálogos privados y credenciales se guardan fuera de la carpeta pública.
