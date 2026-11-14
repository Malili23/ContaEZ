# Escritorio e integraciones

La aplicación nativa guarda los proyectos y credenciales como registros cifrados AES-256-GCM dentro de SQLite. La clave maestra se guarda en Windows Credential Manager o el llavero de macOS. Esto es cifrado del contenido de los registros; no se anuncia como SQLCipher. Los identificadores y fechas de actualización de registros forman parte de los metadatos de la base.

La vista web utiliza IndexedDB del navegador y no ofrece el mismo cifrado. La migración del formato antiguo en localStorage se realiza en una transacción; el original solo se elimina tras confirmar la escritura. Los respaldos `.contaez` son JSON transportable y contienen los datos del proyecto: deben guardarse y compartirse como documentos privados. Ningún token OAuth se guarda en almacenamiento web ni dentro de los respaldos del proyecto.

## ChatGPT

En **Prácticas**, abre un ejercicio y elige **Consultar con ChatGPT**. Escribe tu pregunta y, si te ayuda, elige una observación. Revisa la vista previa. En escritorio puedes elegir **Continuar con ChatGPT**, autorizar en el navegador y volver a ContaEZ para pulsar **Enviar pregunta a ChatGPT**. La opción **Copiar consulta** y el enlace **Abrir ChatGPT** también funcionan sin conectar la app a tu cuenta. El icono del botón de autorización se incluye localmente a partir del [recurso oficial de OpenAI](https://developers.openai.com/assets/siwc/sign-in-buttons/chatgpt-logo-black.svg).

El botón **Continue with ChatGPT** utiliza OAuth de cliente público con PKCE, `state`, `nonce`, retorno HTTP en `127.0.0.1`, validación de firma JWKS, emisor, audiencia y expiración. La instalación conserva un identificador de host opaco. El registro emitido por OpenAI y su identidad se guardan por separado; las credenciales están cifradas.

Las solicitudes utilizan modelos disponibles para la cuenta, `POST /v1/responses`, `store:false`, `stream:true` y solo concluyen cuando llega `response.completed`. Los límites y errores no afectan el motor contable. No se incluye una clave API común ni un cambio automático a una API facturable.

La conexión necesita autorización real del usuario y un plan elegible. No se considera probada una sesión por el simple hecho de que el código compile. Referencias: [registro](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [inferencia](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [limitaciones](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Google Sheets

Se necesita habilitar Google Sheets API en un proyecto de Google Cloud y crear credenciales OAuth de **aplicación de escritorio**. Pega el client ID o, si el cliente requiere su secreto de instalación, el JSON descargado completo (`installed`). No uses credenciales de tipo web. El client ID es configuración pública de la integración; las sesiones y cualquier secreto del archivo se guardan cifrados.

Se pide permiso `drive.file` y acceso a la identidad básica; permite crear archivos autorizados sin solicitar acceso general a toda la unidad. Cada exportación crea un libro nuevo con los valores y fórmulas del mismo generador XLSX. La primera exportación abre el navegador para que la persona autorice su propia cuenta. La elegibilidad y configuración OAuth deben probarse antes de distribuir una identidad de Google Cloud propia de ContaEZ.

## Compilación

En Windows: `powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1`. Requiere Node, Rust MSVC, Windows SDK y herramientas C++ de Visual Studio. El script también reconoce la instalación portable en `work/rust` de este espacio de trabajo.

El flujo de GitHub genera Windows x64 y macOS ARM64. Los artefactos del flujo son **sin firma**. Una publicación de producción requiere certificados Authenticode para Windows y Developer ID, firma y notarización en macOS. Los certificados pertenecen al autor y no se incluyen en el repositorio. Compilar en un ejecutor macOS no reemplaza la comprobación funcional en un Mac M1 real.
