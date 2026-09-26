# spatialengine: design

Documento di riferimento per tutte le sessioni. Le scelte fatte strada facendo vanno in [Decisioni](#11-decisioni); i dubbi ancora aperti in [Questioni aperte](#12-questioni-aperte).

## 1. Visione

Un esploratore dell'universo in pixel art: un'app 2D in cui si naviga direttamente nello spazio con la camera, dalla scala della galassia fino al singolo pianeta, facendo scorrere il tempo e scoprendo oggetti rari. Non ci sono navi né un giocatore da muovere: il protagonista è l'universo generato.

### L'esperienza

- **Zoom continuo tra le scale**: galassia → regione stellare → sistema → corpo celeste con lune e anelli → mappa di superficie del pianeta.
- **Ispezione**: clic su un oggetto → pannello con nome generato, classificazione e dati (tipo di stella, archetipo del pianeta, periodo orbitale, lune…).
- **Tempo**: pausa e accelerazione; orbite, rotazioni, nuvole e terminatori si muovono.
- **Scoperta**: fenomeni rari (buchi neri, pulsar, rovine e megastrutture di civiltà scomparse) da trovare esplorando; un catalogo personale delle scoperte; link che riportano esattamente in un punto dell'universo.
- **Universo infinito e deterministico**, generato da un seed di galassia e diviso in settori.

## 2. Principio fondamentale

**Tutta la grafica è generata da codice.** Nessuno sprite, immagine o griglia di pixel viene scritto a mano o prodotto da un'AI: esistono solo

- **generatori**: algoritmi in `gen/`, costruiti con i mattoni di `core/` e `toolkit/`;
- **ricette**: parametri JSON che un generatore interpreta (`recipes/` per gli oggetti speciali con seed fissato, `style/` per la palette).

Conseguenze:

- Nel repo non ci sono asset grafici. I PNG in `out/` sono preview locali (ignorate da git); gli eventuali golden sono dati di test, non asset.
- Lo sviluppo visivo consiste nello scrivere e tarare generatori guardando i PNG di preview prodotti dalla CLI `forge`.
- Se un oggetto “sembra sbagliato”, si corregge il generatore o la ricetta, mai il singolo output.

## 3. Architettura

Un solo package npm. Le cartelle sono moduli con confini netti:

| Modulo | Ruolo | Ambiente |
|---|---|---|
| `core/` | Funzioni pure e deterministiche: hash e derivazione dei seed, matematica deterministica (`dmath`), rumore, SDF, rasterizzazione, buffer indicizzati. | puro |
| `toolkit/` | Passaggi pixel art condivisi da tutti i generatori: luce quantizzata, dither Bayer, outline selettivo, pulizia, mappatura su palette, conversione finale in RGBA. | puro |
| `gen/` | Generatori: `planet`, `star`, `asteroid`, `background`, `phenomena`, `megastructure`, `ui`. Una sottocartella per generatore. | puro |
| `universe/` | Struttura della galassia, settori, sistemi, orbite, nomi, indirizzi. Logica pura, senza grafica. | puro |
| `style/` | Palette globale organizzata in rampe (JSON). | dati |
| `recipes/` | Oggetti speciali con seed fissato (JSON). | dati |
| `forge/` | CLI: render, fogli di varianti, animazioni, lint, test golden, viste dell'app renderizzate senza browser. | Node |
| `app/` | L'esploratore nel browser: renderer, camera, tempo, interfaccia. | browser |

**Moduli puri** (`core/`, `toolkit/`, `gen/`, `universe/`): nessuna dipendenza npm, solo import relativi (compresi i JSON di `style/` e `recipes/`), nessun accesso a DOM, Node, orologio, timer, I/O o `Math.random`. Girano identici in Node (forge, test) e nel browser (app).

### Dipendenze tra moduli

```
core ◄── toolkit ◄── gen
  ▲                   │
  └──── universe ◄────┘      (gen può usare universe; universe non usa gen né toolkit)

forge ──► tutti i moduli puri, style/, recipes/
app   ──► tutti i moduli puri, style/, recipes/      (app non importa nulla da forge)
```

- `core/` non importa da nessun altro modulo.
- `toolkit/` importa solo da `core/`.
- `universe/` importa solo da `core/`: decide *che cosa* esiste (tipo, seed, parametri fisici), non *come appare*.
- `gen/` importa da `core/`, `toolkit/` ed eventualmente da `universe/` (vocabolario condiviso, tipi).
- Chi unisce universo e grafica sono `app/` e `forge/`.

Queste regole sono imposte da ESLint (`no-restricted-imports` in `eslint.config.js`).

### Contratto dei generatori

```ts
generate(recipe, seed, opts) -> { buffer, descriptor }
```

- `recipe`: parametri JSON del generatore (archetipo, rampe, soglie…).
- `seed`: intero; ogni sottosistema ne deriva il proprio con `derive(seed, "nome")`.
- `opts`: ciò che non è identità dell'oggetto: dimensione in pixel (un gradino di zoom), frame o tick, direzione della luce dalla stella, eventuali flag.
- `buffer`: buffer indicizzato (`width`, `height`, `Uint8Array` di indici di palette). La conversione in RGBA avviene solo alla fine, in `app/` o `forge/`.
- `descriptor`: dati derivati dalla stessa generazione, serializzabili in JSON: raggio, classificazione, mappa di superficie, punti notevoli.
- **Versione**: ogni generatore dichiara un id versionato (`"planet@1"`). Se l'output cambia, si alza la versione o si aggiornano consapevolmente i golden.

**Coerenza tra gradini**: lo stesso oggetto, generato a dimensioni diverse, deve essere riconoscibilmente lo stesso. Identità, classificazione, mappa di superficie logica e punti notevoli (in coordinate normalizzate) dipendono solo da ricetta e seed, non dalla dimensione; la dimensione influenza solo la rasterizzazione.

### Pipeline tipica di un generatore

Ordine indicativo, da confermare allo step 2:

1. **Forma**: SDF e campi di rumore in coordinate normalizzate dell'oggetto (così la stessa forma vale a ogni gradino).
2. **Materiali**: ogni pixel riceve un materiale, cioè una rampa della palette.
3. **Luce**: livello quantizzato (3–4 livelli) dalla direzione della stella, con dither Bayer ancorato ai pixel dell'oggetto.
4. **Colore**: il livello di luce sposta l'indice lungo la rampa del materiale.
5. **Outline selettivo** con il tono più scuro della rampa del materiale.
6. **Pulizia**: pixel orfani, scalini irregolari, cluster indesiderati.
7. **Output indicizzato**; RGBA solo alla fine.

## 4. Determinismo

Le regole valgono per tutti i moduli puri. Sono riportate anche in `CLAUDE.md`.

1. **Un generatore è una funzione pura**: stessi (ricetta, seed, opzioni, frame) → stessi byte, in Node e nel browser.
2. **Mai `Math.random`, `Date` o `performance.now`** in `core/`, `toolkit/`, `gen/`, `universe/`.
3. **Seed derivati per hash con un nome**: `derive(seed, "clouds")`. Mai un unico RNG consumato in sequenza da sottosistemi diversi: aggiungere una feature non deve cambiare le altre.
4. **Il rumore è un hash di coordinate intere del reticolo**, senza tabelle di permutazione mescolate: nessuno stato di inizializzazione, qualsiasi punto è calcolabile da solo, dominio illimitato.
5. **Niente `Math.sin/cos/tan/asin/acos/atan/atan2/exp/log/pow/hypot/cbrt`**: si usa `core/dmath`, implementato solo con `+ - * /` e `Math.sqrt`.
6. **Il tempo è un intero** (tick o numero di frame), mai secondi dell'orologio.
7. **L'output è indicizzato** (`Uint8Array` di indici di palette); RGBA solo alla fine.
8. **Ogni generatore ha una versione** (`"planet@1"`): un cambio di output richiede di alzarla o di aggiornare consapevolmente i golden.
9. **Si itera solo su array o chiavi ordinate.**

### Perché

- ECMAScript lascia la precisione delle funzioni trascendenti “approssimata dall'implementazione”: V8, SpiderMonkey e JavaScriptCore possono differire nell'ultimo bit, e un bit di differenza vicino a una soglia cambia un pixel. Le operazioni `+ - * /` e `Math.sqrt` invece sono arrotondate correttamente per IEEE 754 e JavaScript non contrae in FMA, quindi danno gli stessi bit ovunque. `core/platform.test.ts` documenta questi presupposti.
- L'operatore `**` equivale a `Math.pow` ed è vietato per lo stesso motivo; così anche le varianti iperboliche e logaritmiche (`sinh`, `log2`, `expm1`…).
- I seed con nome rendono le feature indipendenti: aggiungere gli anelli a un pianeta non sposta le nuvole.
- Il rumore da hash di reticolo non ha tabelle né stato, quindi funziona su un universo senza bordi.

### Come sono imposte

| Meccanismo | Cosa copre |
|---|---|
| ESLint `no-restricted-properties` | `Math.random`, le funzioni di `Math` non portabili (anche destrutturate o con accesso `Math['sin']`), i metodi dipendenti dalla locale (`toLocaleString`, `localeCompare`…). |
| ESLint `no-restricted-globals` | `Date`, `performance`, `crypto`, `Intl`, `globalThis`, DOM, Node, timer, `fetch`, storage. |
| ESLint `no-restricted-syntax` | `**`, `**=`, `for...in`. |
| ESLint `no-restricted-imports` | Pacchetti npm nei moduli puri; dipendenze tra moduli non ammesse. |
| `tsconfig.pure.json` | Solo `lib: ES2023`, nessun tipo DOM o Node: usarli è un errore di tipo. |
| Test golden (step 3) | Stessi byte a parità di input; cambi di output intercettati. |

Le regole valgono anche per i test dei moduli puri, che in più possono importare `vitest`.

## 5. Linee guida visive

- **Risoluzione interna 480×270**, upscale intero. L'upscale è calcolato in pixel del dispositivo (`devicePixelRatio`), così un pixel del gioco è sempre un blocco esatto di pixel dello schermo.
- **Lo zoom non scala mai i pixel.** Lo zoom della camera è continuo, ma a ogni livello gli oggetti vengono generati alla dimensione giusta, a gradini discreti e con cache. Un pixel dell'oggetto è sempre un pixel dello schermo. Chiave di cache: (generatore@versione, ricetta, seed, gradino, frame, luce).
- **La luce di ogni corpo viene dalla sua stella**: 3–4 livelli quantizzati, con dither Bayer ancorato ai pixel dell'oggetto generato (non allo schermo: quando l'oggetto si muove, il dither si muove con lui e non “nuota”).
- **La luce sposta il colore lungo una rampa con hue shift**, non moltiplica l'RGB: le ombre vanno verso toni freddi e saturi, le luci verso toni caldi.
- **Outline con il tono più scuro della rampa del materiale**, non nero.
- **Si genera direttamente alla dimensione finale**, mai grande e poi rimpicciolito.

## 6. Universo

- **Gerarchia**: seed di galassia → struttura della galassia (bracci, densità) → settori su griglia intera → sistemi → stelle, pianeti, lune, anelli, fasce di asteroidi → superfici.
- **Settori**: ogni settore si genera da solo a partire dal seed di galassia e dalle sue coordinate intere, senza dipendere dai vicini né dall'ordine di esplorazione.
- **Scale di zoom**:

| Livello | Cosa si vede | Cosa si genera |
|---|---|---|
| Galassia | Struttura a bracci, densità, fenomeni visibili da lontano | `background`, punti stella |
| Regione stellare | Stelle di più settori | `star` a gradini piccoli |
| Sistema | Stella, orbite, pianeti, fasce | `star`, `planet`, `asteroid` |
| Corpo celeste | Pianeta con lune e anelli, nuvole, terminatore | `planet` a gradini grandi |
| Superficie | Mappa di superficie del pianeta | dalla mappa nel descrittore di `planet` |

- **Nomi e classificazioni**: generati in modo deterministico dal seed dell'oggetto.
- **Indirizzi**: una stringa che identifica esattamente un punto dell'universo (seed di galassia, settore, sistema, percorso del corpo, zoom, tick). Serve per i link e per il catalogo. Formato da definire allo step 6.
- **Rarità**: i fenomeni rari hanno una distribuzione controllata e devono essere trovabili esplorando. Da progettare allo step 8.

## 7. Tempo

- Il tempo è un **tick intero**. L'app fa avanzare il tick di un moltiplicatore per frame (pausa = 0).
- **Lo stato a un tick si calcola direttamente dal tick**, senza simulazione incrementale: posizioni orbitali, rotazioni e nuvole sono funzioni di (seed, tick). Saltare nel tempo costa O(1) e un link con un tick riporta esattamente allo stesso stato.
- Le fasi si calcolano con il modulo intero prima di passare ai float: `phase = (tick % period) / period`. Così la precisione non degrada con tick grandi (fino a 2^53).

## 8. Forge e workflow

`forge/` è la CLI con cui si guarda il lavoro (`npm run forge -- <comando>`):

| Comando | Output |
|---|---|
| `render <gen>` | Un oggetto in `out/render/` |
| `sheet <gen>` | Foglio di varianti (64 seed, griglia 8×8) in `out/sheets/` |
| `anim <gen>` | GIF di rotazione, nuvole e terminatore in `out/anim/` |
| `view <indirizzo>` | Vista dell'app 480×270 renderizzata senza browser in `out/views/` |
| `lint` | Controlli automatici su ricette, palette e output |
| `golden check\|update` | Confronto (o aggiornamento consapevole) con i golden |

Allo step 0 esiste solo l'help; i comandi arrivano allo step 3.

**Ciclo di lavoro visivo**: modifica il generatore → genera un foglio di varianti → apri il PNG e guardalo davvero → descrivi cosa vedi → correggi → ripeti. La qualità si giudica sulla distribuzione (fogli di 64 seed), non su un seed fortunato.

**Fine di ogni step**: `npm run check` verde (typecheck, lint, test); fogli di preview aggiornati in `out/`; questo documento aggiornato se sono cambiate decisioni; un commit. Poi ci si ferma e si riassume, senza iniziare lo step successivo.

## 9. Stack e tooling

- **TypeScript 6.0 strict**, Node ≥ 20.19, npm, un solo package, ESM.
- **Vitest 4** per i test (`*.test.ts` accanto al codice), **tsx** per la CLI, **Vite 8** per l'app (`root: app`, build in `dist/`).
- **ESLint 10 + typescript-eslint** con le restrizioni di determinismo e di dipendenza tra moduli.
- **tsconfig per ambiente**, orchestrati da `tsc -b` tramite `tsconfig.json`:
  - `tsconfig.pure.json`: `core/`, `toolkit/`, `gen/`, `universe/`; solo `lib: ES2023`, nessun tipo DOM o Node;
  - `tsconfig.tools.json`: `forge/` e i file di configurazione; tipi Node;
  - `tsconfig.app.json`: `app/`; DOM e `vite/client`.
- **Dipendenze esterne solo in `forge/` e `app/`** (per esempio `pngjs` e `gifenc` in `forge/`, dallo step 3). `app/` non importa nulla da `forge/`.

## 10. Roadmap

| Step | Contenuto | Stato |
|---|---|---|
| 0 | Setup del repo, tooling, lint di determinismo, documenti di riferimento | fatto |
| 1 | **Core deterministico**: hash e `derive`, `dmath` (trigonometria, `exp`, `log`, `pow`… solo con `+ - * /` e `sqrt`), rumore da hash di reticolo, SDF, rasterizzazione, buffer indicizzati | |
| 2 | **Stile, palette e toolkit**: `style/` a rampe con hue shift; luce quantizzata, dither Bayer, outline selettivo, pulizia, mappatura su palette, RGBA | |
| 3 | **Forge CLI**: render, sheet, anim, lint, golden; `pngjs` e `gifenc` | |
| 4 | **Pianeti**: archetipi, mappa di superficie, rotazione, nuvole, terminatore, lune e anelli; descrittore | |
| 5 | **Stelle, asteroidi e sfondi** | |
| 6 | **Universo**: galassia, settori, sistemi, orbite, nomi, indirizzi | |
| 7 | **Esploratore**: renderer, zoom continuo a gradini con cache, tempo, interfaccia, pannello informativo; `forge view` | |
| 8 | **Fenomeni rari e megastrutture**: buchi neri, pulsar, rovine, megastrutture | |
| 9 | **Catalogo e scoperte**: catalogo personale, link agli indirizzi | |

## 11. Decisioni

Formato: data, step, decisione e motivo. Le voci non si cancellano: se una decisione cambia, se ne aggiunge una nuova che la sostituisce.

- **2026-09-26, step 0: lingua.** Documenti e testi della CLI in italiano; codice, identificatori, commenti nel codice e nomi dei seed derivati in inglese (`derive(seed, "clouds")`).
- **2026-09-26, step 0: TypeScript 6.0 invece di 7.** typescript-eslint supporta solo TypeScript < 6.1. Da rivalutare quando supporterà TS 7.
- **2026-09-26, step 0: Vitest 4 invece di 5.** Vitest 5 richiede Node ≥ 22.12, mentre lo stack prevede Node 20+. Il minimo effettivo è Node 20.19 (richiesto da Vite 8 ed ESLint 10). Node 20 è fuori supporto da aprile 2026: se si alza il minimo a 22, si può passare a Vitest 5.
- **2026-09-26, step 0: tsconfig separati per ambiente.** I moduli puri sono compilati senza tipi DOM e Node, così usarli è un errore di tipo oltre che di lint.
- **2026-09-26, step 0: lint di determinismo più ampio della lista minima.** Oltre alle funzioni elencate nella regola 5 sono vietate anche le varianti iperboliche e logaritmiche di `Math`, gli operatori `**` e `**=`, `for...in`, `Intl` e i metodi dipendenti dalla locale, `globalThis`, `crypto`, timer, DOM e Node.
- **2026-09-26, step 0: dipendenze tra moduli imposte dal lint.** `core` ← `toolkit` ← `gen`, `core` ← `universe`; `universe` non importa da `toolkit` né da `gen`; `app` non importa da `forge`. `gen` può importare da `universe`.
- **2026-09-26, step 0: `noUncheckedIndexedAccess` disattivato.** I generatori leggono typed array in cicli stretti, e il flag trasformerebbe ogni `buf[i]` in `number | undefined`.
- **2026-09-26, step 0: test accanto al codice.** `*.test.ts` nello stesso modulo, soggetti alle stesse regole di lint e typecheck del modulo.
- **2026-09-26, step 0: stato dal tick.** Orbite, rotazioni e nuvole sono funzioni dirette di (seed, tick), senza simulazione incrementale (vedi §7).

## 12. Questioni aperte

- **Seed**: uint32 o 64 bit (due uint32)? Con milioni di oggetti, 32 bit producono collisioni. Da decidere allo step 1.
- **`derive` con più componenti**: per esempio `derive(seed, "sector", x, y)` per coordinate intere. Step 1.
- **Indice 0 del buffer riservato alla trasparenza?** Step 1–2.
- **Palette**: unica globale o per scena; numero di rampe e di toni per rampa; limite di 255 colori più trasparenza. Step 2.
- **Formato dei golden**: hash dei byte o PNG di riferimento. Step 3.
- **Determinismo verificato anche nel browser**: come confrontare gli stessi golden in Node e nel browser. Step 3 o 7.
- **Descrittore senza rasterizzare**: serve per il pannello e per trovare oggetti rari da lontano senza generare pixel. Step 4 o 6.
- **Forma dell'universo**: una galassia finita su un piano infinito di settori, o altro? Step 6.
- **Gradini di dimensione**: quali (potenze di 2, √2…) e budget della cache. Step 7.
- **Persistenza del catalogo**: storage del browser, export, entrambi. Step 9.
