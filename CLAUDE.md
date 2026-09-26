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

In più, i moduli puri non hanno dipendenze npm (solo import relativi; i test possono importare `vitest`) e non toccano DOM, Node, timer o I/O.

## Workflow

- Dopo ogni modifica visiva a un generatore: genera un foglio di varianti (`npm run forge -- sheet <gen>`), apri il PNG in `out/`, guardalo davvero, descrivi cosa vedi, correggi, ripeti.
- La qualità si giudica sulla distribuzione (fogli di 64 seed), non su un seed fortunato.
- Ogni step termina con: `npm run check` verde (typecheck, lint, test); fogli di preview aggiornati in `out/`; `docs/DESIGN.md` aggiornato se sono cambiate decisioni (sezione “Decisioni”); un commit. **Poi fermati e riassumi: non iniziare lo step successivo.**

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run check` | typecheck + lint + test |
| `npm test` | Vitest una volta (`npm run test:watch` in watch) |
| `npm run lint` | ESLint, comprese le regole di determinismo |
| `npm run typecheck` | `tsc -b` su tutti i tsconfig |
| `npm run forge -- <cmd>` | CLI forge (`tsx forge/cli.ts`); senza argomenti stampa l'help |
| `npm run dev` / `npm run build` | App Vite (root `app/`, build in `dist/`) |

## Dove sta cosa

```
core/       hash, derive, dmath, rumore, SDF, rasterizzazione, buffer indicizzati   (puro)
toolkit/    luce quantizzata, dither Bayer, outline, pulizia, palette, RGBA          (puro)
gen/        un generatore per sottocartella: planet, star, asteroid, background,
            phenomena, megastructure, ui                                             (puro)
universe/   galassia, settori, sistemi, orbite, nomi, indirizzi                      (puro)
style/      palette globale a rampe (JSON)
recipes/    oggetti speciali con seed fissato (JSON)
forge/      CLI Node: render, sheet, anim, view, lint, golden
app/        esploratore nel browser
docs/       DESIGN.md
out/        preview generate (ignorata da git)
```

Dipendenze ammesse (imposte da ESLint): `core` ← `toolkit` ← `gen`; `core` ← `universe`; `gen` può usare `universe`, non il contrario; `app/` e `forge/` usano i moduli puri; `app/` non importa da `forge/`. Dipendenze npm solo in `forge/` e `app/`.

Test: `*.test.ts` accanto al codice.
