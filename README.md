<div align="center">

# MineHost

**Crea y gestiona servidores de Minecraft con mods en tu propio PC, sin tocar el router.**

Una alternativa local a Aternos: tú tienes el control, tu hardware, tus mundos.
Lo único que necesitas es pegar tu authtoken de ngrok y pulsar un botón.

</div>

---

## Qué hace

MineHost automatiza todo lo tedioso de montar un servidor de Minecraft con mods:

- **Instala el servidor por ti.** Elige la versión de Minecraft y MineHost descarga NeoForge, lo instala y acepta el EULA. Si no tienes Java 21, también lo descarga.
- **Gestiona los mods visualmente.** Arrastra archivos `.jar` a la ventana. Activa, desactiva o borra mods sin tocar carpetas.
- **Configura el mundo sin editar archivos.** Dificultad, modo de juego, PvP, lista blanca, MOTD, semilla… todo con formularios.
- **Abre el servidor a tus amigos.** Integración con ngrok: genera una dirección pública sin abrir puertos ni tener acceso al router.
- **Consola en vivo.** Ve el registro del servidor en tiempo real y escribe comandos (`op`, `whitelist add`, `say`…) desde la propia app.

## Por qué existe

Servicios como Aternos son cómodos, pero tienen colas, límites de RAM y tu mundo vive en un servidor ajeno. Montarlo en casa da mejor rendimiento y control total, pero implica pelearse con instaladores, argumentos de Java, `server.properties` y port forwarding, que muchas veces ni siquiera es posible (routers de terceros, CGNAT del operador).

MineHost cubre justo ese hueco: la potencia de un servidor local con la sencillez de un panel web.

## Instalación

1. Descarga el instalador desde la sección [Releases](../../releases).
2. Ejecuta `MineHost-Setup-1.0.0.exe` y sigue el asistente.
3. Abre MineHost desde el menú de inicio o el acceso directo del escritorio.

> **Nota sobre el antivirus:** MineHost descarga `ngrok.exe`, una herramienta legítima de túneles que algunos antivirus marcan como sospechosa por precaución (también la usan programas maliciosos). Si Windows Defender la bloquea, añade una excepción para la carpeta `%USERPROFILE%\.minehost`.

## Primeros pasos

### 1. Instala un servidor

En **Ajustes**, elige una carpeta vacía donde vivirá el servidor, selecciona la versión de Minecraft y pulsa **Instalar**. MineHost se encarga del resto (puede tardar unos minutos la primera vez).

### 2. Configura el acceso desde fuera

Para que tus amigos entren desde otra red, necesitas una cuenta gratuita de ngrok:

1. Regístrate en [ngrok.com](https://dashboard.ngrok.com/signup).
2. Copia tu authtoken desde [esta página](https://dashboard.ngrok.com/get-started/your-authtoken).
3. Pégalo en **Ajustes → Acceso desde fuera** y pulsa **Guardar authtoken**.

> ngrok exige verificar una tarjeta (sin cargo) para habilitar túneles TCP en el plan gratuito. Es un requisito suyo contra el abuso, no de MineHost.

### 3. Enciende y comparte

Pulsa **Encender servidor** en el Panel. Cuando esté listo:

- **Tú**, desde el mismo PC, te conectas a `localhost`.
- **Tus amigos** usan la dirección que aparece en el Panel (botón **Copiar**).

## Preguntas frecuentes

**¿Mi PC hace de servidor o lo hace ngrok?**
Tu PC. Ngrok solo actúa de puente de red para que el tráfico entre desde internet. Si apagas el PC, el servidor se cae.

**¿La dirección cambia?**
Sí, en el plan gratuito de ngrok cambia cada vez que reinicias el túnel. Los planes de pago permiten dominios fijos.

**¿Puedo usar mi mundo actual?**
Sí. Copia tu carpeta `world` dentro de la carpeta del servidor, sustituyendo la existente.

**¿Funcionan todos los mods?**
Los mods solo de cliente (Sodium, Iris, minimapas de render…) no funcionan en un servidor dedicado y algunos impiden que arranque. Desactívalos desde la pestaña **Mods** si el servidor falla al iniciar.

**¿Necesito Java instalado?**
No. Si no encuentra Java 21, MineHost descarga una copia privada en `%USERPROFILE%\.minehost\java`.

## Requisitos

- Windows 10 o superior (64 bits)
- 4 GB de RAM libres como mínimo (8 GB recomendado con muchos mods)
- Conexión a internet para la instalación inicial

## Desarrollo

```bash
git clone https://github.com/<usuario>/MineHost.git
cd MineHost
npm install
npm start          # ejecuta la app en modo desarrollo
npm run dist       # genera el instalador en release/
```

### Estructura

```
src/
  main/            proceso principal de Electron
    main.js          arranque, ventana y canales IPC
    installer.js     descarga de Java y NeoForge
    serverManager.js ciclo de vida del servidor y consola
    ngrokManager.js  túnel y authtoken
    settings.js      configuración persistente
    preload.js       puente seguro con la interfaz
  renderer/        interfaz (HTML, CSS y JS sin frameworks)
assets/            icono de la aplicación
```

## Licencia

MIT. Consulta [LICENSE](LICENSE).

MineHost no está afiliado a Mojang, Microsoft, NeoForged ni ngrok. Minecraft es una marca registrada de Mojang AB.
