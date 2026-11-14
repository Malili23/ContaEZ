# Usar ContaEZ

ContaEZ trabaja con contabilidad mexicana. Las funciones básicas, la revisión de prácticas y el chat guiado son gratuitos.

## Corregir una práctica de Excel

### 1. Sube tu archivo

Abre `ContaEZ.exe` desde `Escritorio\ContaEz app`. A la izquierda está **Tu práctica de Excel**: pulsa **Subir mi práctica** o arrastra el `.xlsx` que quieres corregir. Puedes elegir varios archivos, de hasta 50 MB cada uno. Seleccionarlos prepara la revisión; todavía puedes agregar contexto antes de iniciarla.

No tienes que crear una empresa ni volver a capturar las operaciones. La app trabaja sobre una copia de tu mismo libro; el archivo que elegiste permanece intacto.

### 2. Agrega contexto al lado y pulsa Revisar

A la derecha está **Contexto para corregirla**. Es opcional y admite:

- Un Excel `.xlsx` que esté correcto y sirva como modelo.
- Fotos o capturas, por ejemplo del enunciado o de un asiento.
- XML de CFDI, PDF, archivos de texto o CSV.
- Una nota concreta, como `el asiento en Diario!C1 no funciona`.

Pulsa **Agregar archivos de contexto** y elige los documentos, de hasta 20 MB cada uno. Escribe en **O dime qué necesitas corregir** la hoja y celda que quieres revisar. `C1` por sí solo puede ser ambiguo si varias hojas tienen esa celda; `Diario!C1` identifica la ubicación.

Cuando estén listos el archivo principal y sus referencias, pulsa **Revisar mi práctica con este contexto**. Puedes continuar con el contexto vacío. Si seleccionaste varias prácticas, la pantalla indica que se usará el contexto seleccionado en cada una; se guardan y revisan por separado. Para dar contextos diferentes, envía las prácticas en revisiones separadas.

Los archivos de contexto permanecen ligados a la práctica correspondiente. No se importan sus cifras a otra contabilidad. La lectura de un CFDI o PDF no demuestra su validez fiscal, deducibilidad ni que el ejercicio esté completo.

### 3. Entiende qué se revisó y confirma las propuestas

Al terminar aparecen los cambios aplicados, las conexiones creadas y los datos que necesitan confirmación. **Ver qué cambió** muestra la hoja y celda, la fórmula anterior, la nueva y el motivo.

ContaEZ puede corregir fórmulas y construir vínculos entre diario, mayor, balanza y estados cuando reconoce la estructura y puede comprobar el origen de la información. Conserva las hojas, datos y presentación existentes. No cambia una cantidad válida solo para conseguir que una balanza cuadre.

Un archivo sin cambios automáticos no significa que esté terminado o que todo sea correcto. Consulta también las preguntas y observaciones pendientes. Por ejemplo, una balanza vacía puede necesitar nombres de cuentas antes de poder relacionarla con el mayor.

En **Lo que aportó el contexto** aparecen las notas, celdas identificadas y propuestas. Un Excel modelo puede sugerir una fórmula cuando comparte estructura con tu práctica y está identificada la celda que debe corregirse. Revisa su **fuente**, la **celda de destino**, la fórmula actual y la propuesta. **Aplicar fórmula del modelo** confirma ese cambio particular sobre la copia; no copia saldos ni importes del otro ejercicio.

Un modelo con otro diseño, una fotografía incompleta o una nota ambigua pueden aportar únicamente observaciones. La app no afirma haber resuelto lo que no pueda comprobar.

### 4. Responde las preguntas

Cada duda aparece bajo **Estas son las dudas de tu archivo**, con el problema, su ubicación y el dato necesario. Las referencias a las celdas que señalaste ayudan a priorizar la revisión. Escribe la referencia solicitada y pulsa **Aplicar dato**. La app revisará nuevamente el original con tus aclaraciones y preparará otra copia.

Si te pide la celda que debe alimentar una referencia rota, utiliza una referencia de ese mismo libro, por ejemplo:

```text
'Esquemas de mayor'!F18
```

Comprueba que esa celda contiene el saldo que realmente corresponde. No basta con que su cantidad coincida por casualidad. La app evita aplicar referencias que produzcan ciclos o cuya estructura no sea admitida.

### 5. Completa o cambia el contexto después

El chat pertenece únicamente al archivo que tienes abierto. Selecciona **¿Qué dato estás aclarando?** si tu mensaje responde una de las preguntas. También puedes resolverlas directamente en el formulario de cada duda.

El panel de contexto sigue al lado del archivo activo. Agregar un documento vuelve a revisar **solo esa práctica**. Para aplicar una nota nueva, pulsa **Revisar con este contexto**. Quitar un archivo de contexto también reconstruye la revisión desde el original; comprueba los cambios antes de descargar.

El chat puede aportar indicaciones al contexto o responder una pregunta concreta. Los adjuntos y notas no agregan operaciones a otro libro. Si una indicación no basta para aplicar un cambio comprobable, tendrás que precisar el dato o referencia. Adjuntar un documento no significa que se hayan interpretado y aplicado automáticamente todas sus instrucciones.

### 6. Descarga la copia

Pulsa **Descargar Excel revisado**. El nombre termina en `__corregida.xlsx`. Sus hojas originales se conservan y una hoja **Revisión ContaEZ** explica cambios, verificaciones y pendientes.

Abre la copia en Excel para recalcular las fórmulas y revisa sus resultados. La app no certifica que cualquier práctica haya quedado completamente correcta: los datos o juicios que no puedan comprobarse permanecen señalados.

En **Mis prácticas** puedes volver a abrir un archivo guardado en este equipo o subir otro. Si modificas la copia fuera de ContaEZ, súbela de nuevo para que se revise esa nueva versión.

## Empresa comercial o persona física

Abre **Otras modalidades** en el encabezado. Estas modalidades tienen un espacio contable con movimientos y reportes propios. El proceso es diferente de la corrección de una práctica sobre su mismo Excel.

### Configura el proyecto y la apertura

Crea un proyecto o abre un ejemplo con datos ficticios. Confirma nombre, periodo, régimen, RFC y método de inventario en **Configuración**. Los ejemplos no representan una empresa real.

En **Movimientos**, captura la apertura con cuentas, cargos y abonos. En **Inventario y activos**, registra las existencias iniciales; su valor debe corresponder a la cuenta de almacén. Confirma los saldos iniciales, incluso si realmente se comienza sin saldos. La ausencia de datos no se interpreta como cero.

### Importa y confirma documentos

En **Documentos** puedes importar Excel, CFDI XML, CSV bancarios, PDF e imágenes. Revisa los datos extraídos y confirma su origen antes de incorporarlos al cálculo. Un documento leído no se considera automáticamente correcto.

Verifica fechas, base sin impuesto, IVA y total. **Importe significa base sin IVA**: para una factura de base $1,000, IVA $160 y total $1,160, el importe es $1,000. Aplicar IVA sobre el total vuelve a calcular el impuesto.

Los cobros, pagos y devoluciones necesitan la operación original. Un cobro no es una venta nueva. Si la factura es de un periodo anterior, se necesita identificar también el saldo pendiente respaldado por la apertura.

### Revisa inventarios, activos y fiscal

En inventarios perpetuos puedes utilizar PEPS o promedio móvil. Cambiar el método recalcula el proyecto y conserva una revisión. El método analítico necesita inventario final confirmado; dejar el campo vacío no equivale a un inventario de cero.

Los activos utilizan costo, residual, vida útil y fecha de inicio para su cálculo contable lineal. La depreciación contable y la deducción fiscal se revisan por separado. La deducibilidad de un gasto también requiere confirmación fiscal.

En **Reportes** revisa balanza, resultados, balance, diario, papel fiscal y conciliación bancaria. Además de las sumas, verifica que estén todas las operaciones previstas. Una relación bancaria por identificador no oculta una diferencia de importe.

Los papeles fiscales automáticos corresponden al paquete México 2026 para los regímenes indicados. Completa acumulados, pagos anteriores, retenciones y coeficiente cuando corresponda. Un papel incompleto necesita datos; un papel preliminar requiere revisión antes de presentarse.

### Usa el asistente y exporta

El asistente gratuito reconoce instrucciones como `El periodo correcto es enero de 2026`, `Cambiar a PEPS` o `Agrega gasto por $1,000 más IVA 16% pagado por banco`. Revisa la interpretación y pulsa **Confirmar información** para aplicarla. Una instrucción ambigua requiere aclaración.

**Descargar Excel** genera un libro de reportes con fórmulas vinculadas. Para agregar operaciones o cambiar la estructura, actualiza el proyecto y vuelve a exportar.

**Respaldo del proyecto** descarga un archivo `.contaez`; importa ese archivo para restaurarlo como proyecto adicional. El respaldo y los Excel contienen información privada y no heredan el cifrado del almacén de escritorio.

En **Configuración**, el cierre conserva las reglas utilizadas y evita cambios hasta reabrir con un motivo. El historial permite restaurar revisiones, pero no sustituye respaldos externos.

## Guardado e integraciones

La app de escritorio guarda los datos localmente con contenido cifrado y una clave protegida por el sistema operativo. La vista web los guarda en el navegador. Borrar esos datos puede eliminar las prácticas y proyectos guardados; conserva tus copias descargadas.

### Generar una práctica completa

Desde el inicio de Prácticas, abre **Generar una práctica completa**. Descarga la plantilla en blanco o el ejemplo. Completa el diario con los asientos y el catálogo con las cuentas, sus grupos y los saldos de apertura. Sube el Excel para obtener una copia con mayor, cuentas T, balanza de comprobación, estado de resultados, balance general y controles vinculados. Si faltan datos o un asiento está descuadrado, la app indica qué revisar.

### Consultar con ChatGPT

Abre una práctica revisada y elige **Consultar con ChatGPT**. Escribe tu pregunta y revisa el texto que se compartirá. En Windows y Mac, pulsa **Continuar con ChatGPT**, autoriza la conexión en el navegador y vuelve a ContaEZ. Cuando aparezca **Cuenta conectada**, pulsa **Enviar pregunta a ChatGPT**. La autorización requiere una cuenta elegible para usar su plan en la app. [Guía de OpenAI](https://developers.openai.com/siwc/token-sharing-open-source).

En la vista web o si prefieres usar tu cuenta por separado, pulsa **Copiar consulta** y **Abrir ChatGPT**, pega la consulta y envíala. La revisión y los cálculos contables funcionan sin conexión a ChatGPT.

Google Sheets necesita un cliente OAuth de escritorio configurado y autorización de la cuenta. No es necesario configurarlo para descargar un Excel. La exportación a CONTPAQi requiere un perfil validado para el producto y versión de destino.

La versión de Windows es un piloto sin firma de editor. La ejecución y distribución de Mac M1 o posterior siguen pendientes de verificación en un equipo real. Consulta [ALCANCE.md](ALCANCE.md) para la cobertura y los límites.

## Contacto

Creada por [@betcover_ii](https://www.instagram.com/betcover_ii/).

Correo: [gallardoquirozd4@gmail.com](mailto:gallardoquirozd4@gmail.com).
