# Alcance de ContaEZ 0.1

Esta versión es un piloto funcional. El documento distingue sus cálculos implementados, verificaciones realizadas e integraciones que necesitan autorización o validación externa.

## México y modalidades

ContaEZ está diseñada exclusivamente para contabilidad y obligaciones fiscales de México, dentro de los regímenes, ejercicios y módulos indicados. La cobertura es normativa; no implica que todos los regímenes, sectores o impuestos locales estén implementados.

| Modalidad | Cobertura inicial |
|---|---|
| Prácticas universitarias | Analítico, perpetuos, PEPS/promedio móvil, apertura, diario, mayor, balanza, resultados, balance y revisión |
| Empresa comercial | Régimen general de personas morales, movimientos, inventarios, bancos y papeles preliminares de IVA/ISR |
| Persona física | Actividad empresarial/profesional, cobros, pagos, gastos y papeles preliminares de IVA/ISR |

RESICO, nómina, regímenes sectoriales, entidades financieras, contabilidad gubernamental e impuestos estatales o municipales requieren módulos específicos. La versión no debe presentarse como compatible con ellos.

## Contabilidad y fiscal

El motor utiliza aritmética decimal, valida partida doble y separa base, IVA y total. Reconoce compras y ventas, liquidaciones y devoluciones relacionadas. Las operaciones no confirmadas o incompletas quedan fuera de los asientos calculados y se muestran como pendientes.

Las devoluciones de mercancía conservan el costo de origen cuando se identifica; no se reutilizan unidades que ya fueron devueltas. El inventario insuficiente, una referencia ambigua o un costo sin respaldo bloquean el registro automático de esa operación.

La depreciación/amortización implementada es contable, en línea recta por mes completo según los datos capturados. La app pide revisar la política; no iguala esa cifra con la deducción fiscal. La capitalización de fletes, tratamientos especiales y decisiones sobre provisiones/contingencias pueden necesitar un asiento manual respaldado.

El papel de IVA muestra importes de cobros y pagos registrados y retenciones confirmadas. Sus requisitos de acreditamiento y demás ajustes deben revisarse. El ISR 2026 implementado usa coeficiente e ingresos acumulados para el régimen general PM, y utilidad fiscal acumulada con la tarifa correspondiente del Anexo 8 para actividad empresarial/profesional PF. Requiere confirmar acumulados, pagos, retenciones y deducibilidad. Ajustes especiales, pérdidas, PTU, estímulos u otras condiciones necesitan revisión del caso.

**El paquete fiscal automático es 2026.** Un periodo de 2025 no usa la tarifa 2026 para producir un ISR aparente. Los proyectos históricos pueden conservar registros contables, pero los cálculos fiscales no soportados aparecen pendientes.

## Fuentes normativas

El registro de reglas conserva fuentes, referencias, estado y vigencia. Las NIF y las disposiciones fiscales cumplen funciones diferentes. La existencia de una referencia no significa que se haya implementado íntegramente toda esa norma.

- [NIF 2026, acceso oficial CINIF](https://cinif.org.mx/normatividad_NIF2026.php).
- [Aclaración editorial NIF 2025](https://cinif.org.mx/uploads/Libro_NIF_2025-Aclaracion_editorial.pdf).
- [Carta de promulgación: Mejoras 2026 y nuevas B-1/B-3](https://www.cinif.org.mx/uploads/NIF_2026_Carta_PROMULGACION.pdf).
- [Código Fiscal de la Federación](https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf) y [reglamento](https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_CFF.pdf).
- [LISR](https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf), [LIVA](https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo22.html) y disposiciones aplicables del ejercicio.
- [Anexo 8 RMF 2026, tarifas ISR](https://sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-8-RMF-2026_DOF-28122025.pdf).
- [Anexo 24 RMF 2026, contabilidad electrónica](https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo_24_RMF2026-13012026.pdf).

Los libros íntegros NIF se consultan con acceso autorizado y no se redistribuyen en el software. No se afirma certificación o cumplimiento integral de todas las NIF, ni autorización del SAT por generar un archivo compatible.

## Verificación realizada y pendiente

| Componente | Estado |
|---|---|
| Motor contable | 26 pruebas automatizadas del conjunto actual: inventarios, devoluciones, liquidaciones, fiscal, chat, importación de proyectos y cierres |
| Importadores, auditor y almacenamiento | Pruebas automatizadas específicas; consultar la ejecución del conjunto de pruebas |
| Recálculo real en Excel Windows | 292 comparaciones numéricas aprobadas en los casos comprobados |
| Aplicación Windows | Ejecutable piloto sin firma de editor |
| macOS Apple Silicon | Compilación CI preparada; ejecución y validación en M1 real pendientes |
| Google Sheets y ChatGPT | Flujos implementados; requieren credenciales/autorización real y pruebas con la cuenta correspondiente |
| Complemento Office.js | Fuente y manifiesto preparados; necesita publicación HTTPS y verificación dentro de las versiones de Excel objetivo |
| CONTPAQi | Perfil por producto/versión y validación con una empresa de prueba pendientes |

Guardar fórmulas, compilar o pasar pruebas sintéticas no acredita por sí solo el comportamiento de todo libro externo. Los archivos reales pueden contener funciones, objetos o estructuras adicionales que deben revisarse.

## Originales, privacidad y almacenamiento

La aplicación de escritorio guarda el contenido de proyectos y credenciales en SQLite con cifrado AES-256-GCM y clave protegida por el sistema. No es una implementación SQLCipher: el contenido de los registros se cifra antes de guardarse. Si falta una clave de una base existente, la app informa del problema en vez de generar otra y descartar los datos.

La vista web utiliza IndexedDB del navegador y necesita respaldos antes de borrar sus datos. Los archivos `.contaez` y Excel exportados son portables, contienen información del usuario y deben mantenerse privados.

Las prácticas originales, datos escolares, recibos, RFC, UUID y datos de terceros no se publicarán con el código. Los ejemplos del repositorio son sintéticos o deben anonimizarse antes de compartirlos.

## Autoría y licencia

Creada por [@betcover_ii](https://www.instagram.com/betcover_ii/) · [gallardoquirozd4@gmail.com](mailto:gallardoquirozd4@gmail.com).

Código propio bajo GNU GPL versión 3. Las dependencias y materiales de terceros mantienen sus respectivas condiciones.
