# Verificación de ContaEZ 0.4.0

- TypeScript y compilación de producción: aprobados.
- 85 pruebas automatizadas JavaScript/TypeScript: aprobadas. Las dos pruebas privadas adicionales de los ocho libros y una copia de RGE también aprobaron; se omiten por defecto sin esos originales.
- Nuevas regresiones: calendario Excel Mac 1904, fórmulas compartidas, funciones con números en su nombre, ciclos con rangos amplios, reemplazo de fórmulas vacías y conservación de texto dentro de fórmulas.
- La balanza distingue apertura, movimientos y cierre. Los bloques de ajustes ambiguos permanecen pendientes; no se rellenan a partir de un diario cuya relación no se puede comprobar.
- Guardado: se comprobaron lecturas interrumpidas, aperturas bloqueadas y acceso restringido a almacenamiento anterior. Los errores no borran ese respaldo ni crean proyectos ficticios.
- Revisión en segundo plano: fallos al iniciar, enviar o recibir el libro y tiempos agotados liberan sus recursos. Los originales y modelos siguen disponibles.
- Interfaz web: carga de práctica y modelo, instrucción Diario!C2, propuesta, confirmación, descarga y conservación tras recarga. Una nota nueva pendiente bloquea la descarga hasta volver a revisar.
- Excel Windows recalculó esa descarga: A2=100, B2=16 y C2=116 con SUM(A2:B2). No se copiaron los importes 999 y 1 del modelo.
- Windows nativo: ejecutable 0.4.0, importación de práctica y modelo, confirmación de fórmula y descarga mediante diálogo vinculado a la app comprobados. El archivo guardado conserva 100, 16 y la fórmula SUM(A2:B2).
- Ocho copias nuevas generadas por el motor de la app: 128 cambios y 351 observaciones pendientes, sin alterar sus originales. Excel Windows abrió y recalculó las ocho: cero errores de fórmula nuevos y cero ciclos nuevos. Los originales tenían tres errores de fórmula; las copias conservan uno previo sin fuente identificable.
- PDF: lector y trabajador de la variante legacy, para las API de Safari correspondientes a macOS 14. ChatGPT separa copiar la consulta de abrir el enlace para evitar ventanas emergentes bloqueadas.

Los informes de las prácticas son privados. El repositorio publica únicamente pruebas sintéticas. Los pendientes pueden ser cuentas, fuentes, datos o instrucciones que no se pueden inferir con seguridad; no se inventan cifras para cuadrar el libro.

El estado exacto de Mac, sus pruebas de arquitectura, arranque y Llavero se documenta en MAC.md y en el flujo público de GitHub. Compilar y arrancar en CI no sustituye la prueba visual de importación, OCR, descarga y autorizaciones en un Mac de uso diario.

Siguen pendientes: firma de editor Windows, Developer ID y notarización Apple, autorización con cuentas reales de ChatGPT y Google, validación del complemento dentro de Excel y perfil comprobado de CONTPAQi. No se afirma cobertura integral de todas las NIF ni certificación fiscal.
