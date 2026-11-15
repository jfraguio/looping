# AGENTS.md

## Servidor local

Looping es un sitio estático, sin build. Desde la raíz del repositorio:

```bash
node scripts/serve.mjs 4174
```

o, sin Node:

```bash
python3 -m http.server 4174 --bind 127.0.0.1
```

Abre **<http://127.0.0.1:4174/>**.

El servidor de `scripts/serve.mjs` envía `Cache-Control: no-store`, cómodo al desarrollar módulos ES. No lo uses en producción; GitHub Pages sirve los archivos estáticos directamente.

No abras `index.html` con `file://`: los módulos ES y el audio necesitan un servidor.

## Comprobaciones rápidas

```bash
for f in src/audio/*.js src/app/*.js; do node --check "$f" || exit 1; done
node scripts/render-catalog.mjs 84
node scripts/render-recipes.mjs
```

Los archivos de `tmp/` son de trabajo y no se publican.

## Estructura mental

- `src/audio/`: motor puro, sin DOM. `engine.js` renderiza los sonidos y mezcla el bucle; `player.js` solo reproduce buffers ya renderizados.
- `src/app/main.js`: estado de interfaz, biblioteca, timeline, audio y modales.
- El bucle se mide en tiempos (un tiempo = un cuarto de compás). Un sonido ocupa N tiempos; el bucle dura la capa más larga, redondeado a compases.
- El autoguardado vive en `localStorage` (`looping.v1`). El archivo `.looping.json` es la copia portátil de todos los álbumes.
