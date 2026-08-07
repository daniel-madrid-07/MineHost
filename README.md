<div align="center">

# MineHost

**Un panel tipo Aternos, pero el servidor corre en tu propio PC.**

Instala, configura y comparte un servidor de Minecraft sin tocar el router,
sin consolas y sin editar archivos de configuración a mano.

</div>

---

## Por qué existe

Aternos es cómodo, pero hay colas, la RAM está limitada y tu mundo vive en un servidor ajeno. Montarlo en casa da mejor rendimiento y control total, pero implica pelearse con instaladores, argumentos de la JVM, `server.properties` y port forwarding, que muchas veces ni siquiera es posible: routers a los que no tienes acceso, o CGNAT del operador.

MineHost cubre ese hueco. Tu hardware y tus mundos, con la comodidad de un panel web.

## Qué hace

**Instalación automática.** Elige plataforma y versión; MineHost descarga el servidor, lo instala y acepta el EULA. Si no tienes la versión de Java correcta, también la descarga (una copia privada, sin tocar tu Java del sistema).

**Seis plataformas.** NeoForge, Forge, Fabric, Paper, Purpur y Vanilla. La app te explica en cada caso si tus amigos necesitarán instalar mods o no.

**Mods y plugins.** Buscador de Modrinth integrado con resolución automática de dependencias y verificación SHA-1, o arrastra tus propios `.jar`. Activa y desactiva sin borrar nada.

**Mundos.** Varios mundos en la misma carpeta, cambiar el activo, importar y exportar en `.zip`, y reiniciar el Nether o el End por separado.

**Jugadores.** Operadores, lista blanca, expulsados e IPs bloqueadas. Con el servidor encendido se aplican por comando; apagado, editando los JSON. Los nombres se resuelven contra Mojang.

**Copias de seguridad.** Manuales, automáticas al apagar o cada X horas, con rotación. Se hacen con `save-off` / `save-all flush` para que nunca salga un mundo corrupto, y al restaurar el mundo actual se aparta en vez de borrarse.

**Ajustes visuales.** Las 43 opciones de `server.properties` y 28 reglas de juego, agrupadas por lo que hacen y explicadas en español.

**Consola en vivo.** Registro con filtro y colores por nivel, y envío de comandos.

**Acceso desde fuera.** Túnel de ngrok integrado: descarga el binario, guarda tu authtoken y publica la dirección con un botón para copiarla.

**Vigilancia.** Uso de RAM y CPU en directo, reinicio automático si el servidor se cae y reinicios programados con aviso previo por el chat.

## Instalación

1. Descarga el instalador desde [Releases](../../releases).
2. Ejecuta `MineHost Setup 1.1.0.exe`.
3. Ábrelo desde el menú de inicio.

Windows mostrará un aviso de editor desconocido: el ejecutable no está firmado porque un certificado cuesta dinero. Pulsa **Más información › Ejecutar de todas formas**.

> **Antivirus:** MineHost descarga `ngrok.exe` para el túnel. Algunos antivirus lo marcan por precaución, porque también lo usa software malicioso. Si Windows Defender lo bloquea, añade una excepción para `%USERPROFILE%\.minehost`.

## Primeros pasos

La primera vez, un asistente de tres pasos te pregunta dónde guardar el servidor, qué plataforma quieres y qué versión. Al terminar, un tutorial guiado señala las cuatro cosas que importan.

Para que entren desde fuera de tu red hace falta una cuenta gratuita de ngrok: la app te lleva a la página, guardas el authtoken y ya está. Ngrok pide verificar una tarjeta para habilitar túneles TCP en el plan gratuito; es un requisito suyo contra el abuso, no cobra nada.

Cuando el servidor esté en marcha:
- **Tú**, desde este mismo PC, entras con `localhost`.
- **Tus amigos** usan la dirección del panel.

## Preguntas frecuentes

**¿Mi PC hace de servidor, o lo hace ngrok?**
Tu PC. Ngrok solo hace de puente para que el tráfico entre desde internet. Si apagas el PC, el servidor se cae.

**¿La dirección cambia?**
Sí, en el plan gratuito de ngrok cambia cada vez que se reinicia el túnel.

**¿Puedo usar mi mundo actual?**
Sí. Exporta la carpeta `world` a un `.zip` e impórtalo desde la pestaña Mundo.

**¿Por qué no arranca con ciertos mods?**
Los mods solo de cliente (Sodium, Iris, minimapas) no funcionan en un servidor dedicado y algunos impiden el arranque. El buscador los marca como «Solo cliente»; desactívalos desde la pestaña Mods.

**¿Cuánta RAM le pongo?**
Con 40 mods, entre 6 y 8 GB va sobrado. Deja siempre 2 GB libres para Windows.

**¿Necesito Java?**
No. Si falta, MineHost instala la versión correcta en `%USERPROFILE%\.minehost\java`.

## Requisitos

- Windows 10 o superior (64 bits)
- 4 GB de RAM libres como mínimo, 8 GB recomendado con mods
- Conexión a internet para la instalación inicial

## Desarrollo

```bash
git clone https://github.com/<usuario>/MineHost.git
cd MineHost
npm install
npm start        # modo desarrollo
npm run dist     # genera el instalador en release/
```

### Estructura

```
src/
  main/                  proceso principal
    main.js                ventana y canales IPC
    platforms.js           las seis plataformas y sus APIs
    installer.js           descarga de Java y del servidor
    serverManager.js       ciclo de vida, consola, RAM/CPU, flags de Aikar
    ngrokManager.js        túnel y authtoken
    playerManager.js       ops, whitelist y baneos
    backupManager.js       copias con volcado seguro y rotación
    worldManager.js        mundos: importar, exportar, reiniciar dimensiones
    modrinth.js            búsqueda e instalación con dependencias
    scheduler.js           reinicios y copias programadas
    catalog.js             propiedades y gamerules en español
    settings.js            configuración persistente
    preload.js             puente aislado con la interfaz
  renderer/              interfaz, sin frameworks
    tokens.css             sistema de diseño
    styles.css             componentes
    app.js                 lógica, asistente y tutorial
assets/
  fonts/                 Inter y JetBrains Mono (SIL OFL)
  make-icon.js           genera el icono sin dependencias
```

### Notas de diseño

La profundidad se construye con una escalera de superficies y filetes de 1 px; no hay una sola sombra. El verde queda reservado para el estado del servidor, así que el botón primario es claro sobre oscuro. Los números usan cifras tabulares para que no bailen al actualizarse, y todo respeta `prefers-reduced-motion`.

## Licencia

MIT, en [LICENSE](LICENSE). Las tipografías incluidas se distribuyen bajo SIL Open Font License.

MineHost no está afiliado a Mojang, Microsoft, NeoForged, PaperMC, Modrinth ni ngrok. Minecraft es una marca registrada de Mojang AB.
