# Looping

**Máquina de bases de hip hop en el navegador.** Elige sonidos, colócalos en capas, escucha el bucle cambiar en directo y expórtalo en MP3 o WAV. Sin cuentas, sin servidor y sin samples: cada sonido se sintetiza en tu equipo.

![Looping](assets/preview.png)

> Una vuelta de tuerca a la idea de [sen](https://github.com/jfraguio/sen): misma obsesión por el sonido y el detalle, otra piel y otro propósito.

## Arrancar

No hay que compilar. Desde la raíz del repositorio:

```bash
python3 -m http.server 4174 --bind 127.0.0.1
```

o, si tienes Node:

```bash
npm start
```

Abre **<http://127.0.0.1:4174/>**. No abras `index.html` con `file://`: los módulos ES y el audio necesitan un servidor.

Para publicar en GitHub Pages: **Settings → Pages → Deploy from a branch → `main` → `/ (root)`**. El proyecto ya incluye `.nojekyll` y todas las rutas son relativas, así que funciona en la raíz de un dominio o en `usuario.github.io/repositorio/`.

## Cómo se usa

1. **Elige un sonido** en la biblioteca. Al tocarlo se escucha y queda seleccionado.
2. **Toca una capa** de la línea de tiempo en el tiempo donde quieras colocarlo. La barra naranja te recuerda que estás colocando; pulsa **Listo** para salir.
3. **Añade capas** y combina ritmo, bajo, armonía y textura. Cada capa tiene volumen, mute y solo.
4. **Arrastra un bloque** para moverlo. Selecciónalo para **duplicarlo** (útil cuando el sonido dura menos que el bucle) o quitarlo.
5. **Play**. El cabezal recorre la línea y vuelve al principio. La línea dura lo que la capa más larga, redondeado al compás.
6. **Exporta** en MP3 320 kbps o WAV 16 bits, con la duración que quieras (15 s – 5 min) y fundido final opcional.

**Sorpréndeme** crea una base completa y equilibrada al azar. Es la manera más rápida de escuchar el catálogo y luego desmontarlo.

## Lo que incluye

- **32 sonidos originales** en cuatro familias: 8 ritmos, 8 bajos, 10 armonías y 6 texturas. Todos comparten la tonalidad de Re menor y están nivelados para combinarse.
- **Línea de tiempo por capas** con bloques de 1, 2, 4 u 8 tiempos, duración dinámica, extensión del bucle, arrastre con imán, duplicado y deshacer.
- **Escucha en directo**: renderiza el bucle en el navegador y hace crossfades de 45 ms al cambiar cualquier cosa. Puedes editar mientras suena.
- **Exportación** MP3 320 kbps con etiquetas ID3 (título, álbum, artista, género) o WAV 44,1 kHz / 16 bits. Se repite el bucle hasta llenar la duración elegida y se aplica un fundido final.
- **Álbumes y temas** con autoguardado en `localStorage`, proyecto exportable/importable en `.looping.json` y gestión de varios álbumes.
- **Interfaz para ratón, teclado y tablet**. La biblioteca se convierte en una hoja inferior en pantallas estrechas.
- **Sin dependencias de interfaz**. Solo JavaScript, CSS y HTML; los módulos de audio se cargan como módulos ES.

## Atajos

| Acción | Tecla |
| --- | --- |
| Reproducir / pausar | `espacio` |
| Borrar el bloque seleccionado | `supr` / `backspace` |
| Duplicar el bloque | `⌘/Ctrl D` |
| Mover el bloque un tiempo | `←` `→` |
| Cambiar el bloque de capa | `↑` `↓` |
| Deshacer / rehacer | `⌘/Ctrl Z` / `⇧⌘/Ctrl Z` |
| Exportar | `⌘/Ctrl E` |
| Guardar proyecto | `⌘/Ctrl S` |
| Ayuda | `?` |

## El motor de sonido

No hay samples ni descargas: el catálogo se sintetiza muestra a muestra a **44,1 kHz estéreo**, de forma determinista (misma semilla, mismo resultado). El mismo código que suena en directo genera el archivo exportado.

- **Batería**: bombos con caída de tono, membranas y saturación; cajas con cuerpo modal, ruido de bordón y aire estéreo; charles metálicos con banco de parciales y filtros; congas, shakers, claps, escobillas y platos.
- **Bajos**: cuerdas pulsadas Karplus-Strong con cuerpo de madera, subgraves 808 con saturación, bajos sustractivos con filtro y drive.
- **Armonías**: FM para Rhodes y Wurli; piano de fieltro aditivo con ruido de martillo; guitarra de nailon Karplus; cuerdas y coro por formantes; vibráfono, caja de música, flauta y pads analógicos.
- **Texturas**: vinilo con crujidos deterministas, lluvia, ciudad, scratch por resampleo de un stab, voz cortada por formantes y campanas modales.
- **Espacio**: reverb FDN de ocho líneas por familia, wow/flutter de cinta, saturación suave, limitador de pico y normalización de mezcla por RMS.
- **Catálogo compuesto en Re menor** para que cualquier combinación razonable funcione sin saber armonía.

La mezcla se normaliza a un nivel de escucha consistente y se limita el pico para que la exportación no sature. Los archivos finales quedan alrededor de −14 LUFS.

## Estructura

```
index.html
src/
  audio/
    catalog.js        los 32 sonidos y sus patrones
    instruments.js    batería, bajos, teclados, texturas
    dsp.js            filtros, ruido, reverb, cinta, medidas
    rng.js            azar determinista
    engine.js         render de sonidos y mezcla del bucle
    player.js         reproducción en directo y crossfades
    export.js         exportación MP3/WAV
    export-worker.js  codificador MP3 en worker
    wav.js            codificador WAV
  app/
    main.js           interfaz, estado y eventos
    storage.js        álbumes, proyectos y localStorage
    recipes.js        bases de arranque y Sorpréndeme
    dom.js            utilidades y toasts
    modals.js         diálogos y foco
  styles/main.css
assets/fonts/         Archivo, Archivo Black y Space Mono (OFL)
vendor/lame.min.js    codificador MP3 (LGPL)
scripts/              render de pruebas y servidor local
```

## Pruebas y herramientas

El motor funciona igual en Node, sin DOM. Esto permite revisar el catálogo sin abrir el navegador:

```bash
node scripts/render-catalog.mjs 84      # todos los sonidos + demo en tmp/catalog
node scripts/render-recipes.mjs          # las ocho bases de arranque en tmp/recipes
node scripts/test-drums.mjs              # voces de batería aisladas
```

Los WAV se pueden analizar con `ffmpeg`, `ffprobe` o `sox` (nivel, pico, LUFS, espectro). La app se sirve sin caché con `node scripts/serve.mjs 4174`.

## Navegadores

Chrome/Edge 98+, Firefox 114+ y Safari 15.4+ (módulos ES, Web Audio y `localStorage`). En móvil y tablet, el audio necesita un primer toque; la app lo desbloquea con el primer gesto.

## Créditos y licencias

- Motor, catálogo, interfaz y textos originales de este proyecto.
- Tipografías **Archivo** y **Space Mono** bajo SIL Open Font License; las licencias están en `assets/fonts/`.
- **lamejs** (LGPL) se incluye en `vendor/` para codificar MP3 en el navegador; su licencia está en `vendor/lamejs.LICENSE.txt`.
- Inspirado en la arquitectura y las ideas de [sen](https://github.com/jfraguio/sen), de fraguio.
