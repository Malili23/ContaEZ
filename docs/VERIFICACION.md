# ContaEZ 0.4.1 · Verificación

- 102 pruebas JavaScript/TypeScript aprobadas, incluidas las ocho prácticas privadas y una copia de la plantilla RGE.
- 9 pruebas nativas de Windows aprobadas. GitHub Actions compiló Windows y Mac con el mismo código.
- Cloudflare Pages: comprobación de la página, la app web, el panel de Excel y el manifiesto de la versión.
- En la app web se aplicó una fórmula de un Excel modelo, se descargó, se guardó el respaldo y se restauró la práctica. Excel Windows recalculó la copia: 100 + 16 = 116.
- Recálculo en Excel Windows de las ocho copias privadas: 128 cambios, 351 observaciones pendientes, cero errores de fórmula o ciclos nuevos. Permanece un error de referencia que ya existía.
- Instalador Mac ARM64 y ZIP comprobados contra sus huellas publicadas, con macOS mínimo 14. La prueba de arranque en macOS 15 pasó. Quedan pendientes la notarización y una prueba manual en un Mac de uso diario.

Descargas y versiones: https://contaez-mexico.pages.dev/#versiones
Compilación: https://github.com/Malili23/ContaEZ/actions/runs/43626694599
