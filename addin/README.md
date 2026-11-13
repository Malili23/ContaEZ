# ContaEZ para Excel

Complemento gratuito Office.js que comparte el motor contable de ContaEZ. Su inicio permite subir un .xlsx, conectar y corregir el mismo libro, responder preguntas concretas y descargar o abrir una copia con su informe. Las herramientas para revisar selección o crear registros nuevos están en una sección plegable de uso profesional. Nunca reescribe automáticamente el libro original.

La revisión de selección comprueba errores y referencias locales visibles. Para revisar el archivo completo, usa «Revisar y conectar mi Excel» o la aplicación de escritorio. La revisión completa también conserva las dudas que no pueden resolverse con la información disponible. La ausencia de errores en una selección no certifica la contabilidad completa.

## Práctica y contexto

La app de escritorio y su vista web tienen dos apartados juntos: **Tu práctica de Excel**, a la izquierda, y **Contexto para corregirla**, a la derecha. Elige el archivo que quieres corregir y agrega, opcionalmente, un Excel modelo correcto, fotos, CFDI XML, PDF o texto. Escribe una indicación como `el asiento en Diario!C1 no funciona` y pulsa **Revisar mi práctica con este contexto**. La [guía de uso](../docs/USO.md) explica el recorrido completo.

El contexto pertenece a esa práctica. Un Excel modelo con estructura compatible y destino identificado puede aportar propuestas de fórmulas: se muestran fuente, destino y fórmula antes de confirmar **Aplicar fórmula del modelo**. No se copian importes de otro ejercicio ni se acredita automáticamente la validez fiscal o deducibilidad de un CFDI.

El panel del complemento conserva su recorrido de revisión de archivo y copia. Para el recorrido completo con los dos apartados de contexto, utiliza la app o su vista web; no se afirma que esa interfaz adicional ya esté disponible o validada dentro de un host real de Office.

## Publicación

El sitio HTTPS debe servir `addin/index.html` y los archivos generados por Vite, además de los iconos de `addin/icons/`. Ejecuta `node addin/generate-manifest.mjs https://TU-ORIGEN-REAL` para obtener `addin/manifest.xml`; el origen debe ser el publicado, sin rutas adicionales. El valor predeterminado es solo desarrollo local HTTPS y no debe anunciarse como una instalación pública.

Para probarlo, carga el manifiesto mediante el mecanismo de complementos personalizados de Microsoft 365. La distribución general por Microsoft Marketplace requiere la cuenta y revisión del editor. Debe comprobarse en Excel Microsoft 365 Windows y Mac; compilar los archivos web no prueba su comportamiento dentro de Office.

## Tabla de operaciones

Encabezados requeridos: Fecha, Tipo, Importe, IVA, Medio. Importe es la base antes de IVA. IVA admite `16%`, `16` o `0.16`, así como `0` explícito. Medio admite efectivo, banco o crédito. Tipos admitidos: compra, venta, gasto, cobro, pago, aportación, devolución compra y devolución venta. Encabezados opcionales: Descripción, Producto, Cantidad, Costo unitario. Las operaciones se presentan para confirmación antes de generar reportes; cobros, pagos y devoluciones necesitarán sus relaciones si el revisor las solicita.

ChatGPT se abre por separado con una consulta copiada expresamente por el usuario. La cuenta y sus límites pertenecen a la persona; la contabilidad no depende de esa conexión.
