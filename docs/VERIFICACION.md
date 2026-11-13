# Verificación de ContaEZ 0.3.0

- Compilación TypeScript y Vite: aprobada.
- 58 pruebas automatizadas JavaScript/TypeScript: aprobadas.
- 6 pruebas nativas Rust: aprobadas, incluyendo cifrado autenticado y almacén seguro real de Windows.
- Prácticas sobre el libro original: siete pruebas nuevas comprueban vínculos entre hojas, conservación de datos, estilos y partes del archivo; rechazan referencias circulares y parciales con signo ambiguo. Las dos comprobaciones privadas adicionales con los ocho libros y una copia de RGE también aprobaron; se omiten por defecto cuando esos originales no están disponibles.
- Interfaz: se comprobaron las tres modalidades con datos ficticios, captura de un gasto, confirmación de una propuesta de chat, cambio PEPS a promedio y recálculo de resultados.
- Persistencia: proyectos y documento de prueba conservados después de recargar la vista web.
- OCR local: recibo sintético leído con subtotal, IVA y total correctos usando los recursos incluidos.
- Excel Windows: una edición de gasto actualizó resultado y balance; 292 valores numéricos de fórmulas coincidieron con la exportación independiente esperada.
- Ocho prácticas con el nuevo motor sobre el mismo libro: originales intactos, conservación de estilos/componentes y revisión repetida sin cambios innecesarios. Las ocho copias actuales abren y recalculan en Excel Windows sin añadir errores de fórmula. Las cuentas, fuentes y reportes no identificables quedan pendientes. Una corrupción detectada al insertar referencias con $ en celdas vacías se corrigió y tiene prueba de regresión.
- Dependencias JavaScript: auditoría sin vulnerabilidades conocidas en el informe ejecutado.

La interfaz de prácticas se comprobó además con carga real, aclaración de ejercicio, guardado, recarga y descarga de una copia del mismo Excel. La revisión se ejecuta aparte de la interfaz para mantener la pantalla disponible. El libro completo descargado abrió y recalculó en Excel Windows sin errores de fórmula; conserva pendientes sobre cuentas y reportes cuya fuente no se puede determinar.

El flujo con contexto se comprobó desde la interfaz: carga de práctica y modelo, indicación Diario!C2, propuesta sin cambios automáticos, confirmación y descarga. Excel Windows recalculó el archivo descargado: base 100, IVA 16 y total 116, conservando las cifras de la práctica aunque el modelo tenía otras cantidades. Se añadieron pruebas para diseño incompatible, ciclos, vínculos externos, datos capturados, propuestas obsoletas y reutilización del original al enviarlo a un trabajador.

El guardado nativo se comprobó con una descarga real. Abre Descargas y mantiene una sola ventana de guardado vinculada a la app.

Estos resultados cubren los escenarios comprobados. No equivalen a una auditoría contable integral, cobertura de todas las NIF o verificación universal de cualquier archivo.

Pendientes externos: pruebas de autorización con cuentas reales de ChatGPT/Google, validación del complemento en Excel, perfil CONTPAQi, ejecución en Mac M1 y firma/notarización de distribución. El código y configuración de compilación para macOS ARM64 están incluidos.
