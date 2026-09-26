# spatialengine

Esploratore dell'universo in pixel art: app 2D in TypeScript in cui si naviga con la camera dalla galassia alla superficie di un pianeta. Design completo, roadmap, decisioni e questioni aperte: `docs/DESIGN.md`. Leggilo all'inizio di ogni step.

## Principio

Tutta la grafica è generata da codice. Esistono solo **generatori** (algoritmi in `gen/`) e **ricette** (parametri JSON). Mai sprite, immagini o griglie di pixel scritte a mano o prodotte da un'AI. Il lavoro visivo consiste nello scrivere e tarare generatori guardando i PNG di preview prodotti da `forge`.

## Regole di determinismo

Valgono in `core/`, `toolkit/`, `gen/`, `universe/` (moduli puri), test compresi. ESLint e `tsconfig.pure.json` ne impongono la maggior parte: se il lint si lamenta, correggi il codice, non la regola.

1. Un generatore è una funzione pura: stessi (ricetta, seed, opzioni, frame) → stessi byte, in Node e nel browser.
2. Mai `Math.random`, `Date` o `performance.now`.
3. Seed derivati per hash con un nome: `derive(seed, "clouds")`. Mai un unico RNG consumato in sequenza da sottosistemi diversi: aggiungere una feature non deve cambiare le altre.
4. Il rumore è un hash di coordinate intere del reticolo, senza tabelle mescolate.
5. Niente `Math.sin/cos/tan/asin/acos/atan/atan2/exp/log/pow/hypot/cbrt` (né `**`): usa `core/dmath`, implementato solo con `+ - * /` e `Math.sqrt`.
6. Il tempo è un intero (tick o numero di frame), mai secondi dell'orologio.
7. L'output è indicizzato (`Uint8Array` di indici di palette); RGBA solo alla fine.
8. Ogni generatore ha una versione (`"planet@1"`): un cambio di output richiede di alzarla o di aggiornare consapevolmente i golden.
9. Si itera solo su array o chiavi ordinate.

In più, i moduli puri non hanno dipendenze npm (solo import relativi) e non toccano DOM, Node, timer o I/O. I loro test possono importare `vitest` e usare `Math.*` come riferimento per `dmath`. `derive` e la costruzione di `Rng`, `Fbm`, `Warp` stanno fuori dai cicli sui pixel. API del core: `docs/DESIGN.md` §5; palette e toolkit: §6.

## Workflow

- Dopo ogni modifica visiva a un generatore: guarda il risultato come spiegato in "Come guardare il tuo lavoro", correggi, ripeti.
- Un nuovo generatore si scrive con `defineGenerator` (nome, versione, schema della ricetta, `generate`, validatori, casi golden) e si aggiunge a `gen/index.ts`. I ritentativi li fa il registro, non il generatore.
- La qualità si giudica sulla distribuzione (fogli di 64 seed), non su un seed fortunato.
- Ogni step termina con: `npm run check` verde (typecheck, lint, test); fogli di preview aggiornati in `out/`; `docs/DESIGN.md` aggiornato se sono cambiate decisioni (sezione “Decisioni”); un commit. **Poi fermati e riassumi: non iniziare lo step successivo.**

## Come guardare il tuo lavoro

Dopo ogni modifica visiva:

1. `npm run forge -- sheet <gen> --bg -o out/<gen>-sheet.png`: 64 seed con il numero sotto ogni cella.
2. `npm run forge -- anim <gen> --bg --strip -o out/<gen>-anim.gif`: la GIF e la striscia dei frame.
3. Apri i PNG con lo strumento di lettura dei file (Read). La GIF non si legge come sequenza: leggi `out/<gen>-anim-strip.png`.
4. Descrivi cosa vedi (forma, colori, luce, outline, dither, varietà tra i seed, difetti) e solo dopo decidi il passo successivo.

| Verifica | Comando |
|---|---|
| Distribuzione, seed brutti | `sheet <gen> --bg` (64 seed); poi `lint <gen> --count 256` per i numeri |
| Effetto di un parametro | `params <gen> --param a.b --values v1,v2,v3,v4 --seeds 0..7 --bg` |
| Movimento: rotazione, nuvole, terminatore | `anim <gen> --bg --strip`, poi leggi la striscia |
| Singoli pixel: outline, dither, angoli | `render <gen> --seed n --scale 8 --grid --bg`, oppure `zoom <png> --x --y --w --h` su un PNG esistente |
| Luce da un'altra direzione | `--light <gradi>` (0 = dall'alto, senso orario) e `--elev <gradi>` su render, sheet, anim |
| Aspetto alla scala del gioco | `render <gen> --scale 1 --bg` (nell'app 1 pixel dello sprite = 1 pixel dello schermo) |
| Coerenza tra gradini di zoom | `sizes <gen> --seed n --bg` (stesso oggetto a 16, 32, 64, 128, 256 px) |
| Confronto tra archetipi o varianti | `params <gen> --param archetype --values a,b,c --seeds 0..7 --bg` |
| Cuciture tra chunk di uno sfondo | `chunks background --x 0..2 --y 0..2 --scale 2`, poi `zoom` sugli incroci |
| L'insieme: oggetti e sfondo con la luce del sole | `scene recipes/scenes/<scena>.json` |
| Palette e rampe | `swatches` (fogli in `out/palette.png` e `out/palette-shading.png`) |
| L'output è cambiato? | `golden check`; dopo un cambio voluto: alza la versione del generatore e `golden update <gen>` |
| Generatori e parametri disponibili | `list` |

Usa sempre `--bg` per guardare: su trasparenza le etichette chiare non si leggono. Le immagini grandi vengono rimpicciolite dal lettore: per i dettagli usa `zoom`.

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run check` | typecheck + lint + test |
| `npm test` | Vitest una volta (`npm run test:watch` in watch) |
| `npm test -- -u` | Rigenera il golden del core (`tests/golden/core.json`): solo per cambi voluti, annotati in Decisioni |
| `npm run bench` | Benchmark del core in Node (`forge/bench.ts`) |
| `npm run palette` | Rigenera `style/palette.json` da `style/ramps.json` (mai modificare palette.json a mano) |
| `npm run lint` | ESLint, comprese le regole di determinismo |
| `npm run typecheck` | `tsc -b` su tutti i tsconfig |
| `npm run forge -- <cmd>` | CLI forge: `render`, `sheet`, `params`, `sizes`, `anim`, `chunks`, `scene`, `lint`, `golden`, `list`, `swatches`, `zoom`; `help <cmd>` per le opzioni |
| `npm run dev` / `npm run build` | App Vite (root `app/`, build in `dist/`) |

## Dove sta cosa

```
core/       hash, derive, Rng, dmath, rumore, buffer, impronte                       (puro)
toolkit/    colore, palette e tabelle, luce, dither, shade, outline, pulizia, font   (puro)
gen/        registry, schema, index (elenco), testdisc, planet/, star/, asteroid/,
            background/; poi phenomena, megastructure, ui                            (puro)
universe/   galassia, settori, sistemi, orbite, nomi, indirizzi                      (puro)
style/      ramps.json (parametri) -> palette.json (generata): 63 colori + trasparente
recipes/    preset (planets/*.json), scene di prova (scenes/*.json), oggetti speciali
forge/      CLI (cli.ts, run.ts, commands/), golden dei generatori, script palette e bench
app/        esploratore nel browser
docs/       DESIGN.md
tests/      golden/core.json (core) e golden/<gen>.json (generatori): impronte attese
out/        preview generate (ignorata da git)
```

Dipendenze ammesse (imposte da ESLint): `core` ← `toolkit` ← `gen`; `core` ← `universe`; `gen` può usare `universe`, non il contrario; `app/` e `forge/` usano i moduli puri; `app/` non importa da `forge/`. Dipendenze npm solo in `forge/` e `app/`.

Test: `*.test.ts` accanto al codice.
