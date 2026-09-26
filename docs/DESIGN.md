# spatialengine: design

Documento di riferimento per tutte le sessioni. Le scelte fatte strada facendo vanno in [Decisioni](#12-decisioni); i dubbi ancora aperti in [Questioni aperte](#13-questioni-aperte).

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
| Test golden | Stessi byte a parità di input; cambi di output intercettati. Per il core: `tests/golden/core.json` (§5.7); per i generatori dallo step 3. |

Le regole valgono anche per i test dei moduli puri, che in più possono importare `vitest` e usare le funzioni di `Math` come riferimento per `core/dmath`.

## 5. API del core

Tutto in `core/`, senza dipendenze. Ogni funzione è pura e non alloca nei percorsi caldi (rumore, hash, buffer). I seed sono uint32.

### 5.1 Hash e seed (`core/hash.ts`)

| API | Cosa fa |
|---|---|
| `mix32(h)` | Finalizer fmix32 di murmur3: biiezione su uint32 con avalanche completa. |
| `hashString(s)` | FNV-1a a 32 bit sui byte UTF-8 di `s`. |
| `derive(seed, ...parts)` | Seed figlio da un percorso di nomi e interi: `derive(galaxy, "sector", x, y)`. |
| `hashCoords(seed, x, y, z = 0)` | Hash di un punto intero del reticolo, per il rumore. Coordinate modulo 2^32. |
| `hashStageX/Y/Z` | Gli stadi di `hashCoords`, per condividere i prefissi tra gli angoli di una cella: `hashCoords(s, x, y, z) === hashStageZ(hashStageY(hashStageX(s, x), y), z)`. |

`derive`:

- è **gerarchica**: `derive(derive(s, a), b) === derive(s, a, b)`, e `derive(s)` restituisce `s`;
- ogni parte è assorbita da una biiezione: **figli diretti diversi dello stesso genitore non collidono mai**; collisioni solo tra percorsi con prefissi diversi, alla frequenza di valori casuali a 32 bit;
- i numeri devono essere **interi sicuri**, anche negativi, e sono trattati come interi a 64 bit in complemento a due (`-1` e `0xffffffff` sono distinti); altrimenti lancia `RangeError`;
- stringhe e numeri hanno tag diversi: `derive(s, "7") !== derive(s, 7)`;
- usa parametri rest e hash di stringhe: **non va chiamata nei cicli interni**, si precalcolano i seed.

Collisioni misurate su una griglia di 1000×1000 settori (coordinate da −500 a 499): 115 per `derive(s, "sector", x, y)` e 126 per `hashCoords`, contro le 116.4 attese per 10^6 valori casuali a 32 bit.

### 5.2 Generatore pseudo-casuale (`core/rng.ts`)

`new Rng(seed)`: sfc32, stato di 128 bit, solo operazioni a 32 bit. Va creato **sempre da un seed derivato** (`new Rng(derive(seed, "craters"))`) e **mai condiviso tra sottosistemi**.

| Metodo | Risultato |
|---|---|
| `next()` | uint32 |
| `float()` | [0, 1), risoluzione 2^-32 |
| `int(min, max)` | intero in [min, max], **estremi inclusi** |
| `range(a, b)` | float in [a, b) |
| `chance(p)` | `true` con probabilità p |
| `pick(items)` | elemento uniforme; `RangeError` su array vuoto |
| `shuffle(items)` | Fisher-Yates **sul posto**; restituisce lo stesso array |

### 5.3 Matematica deterministica (`core/dmath.ts`)

`sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `log`, `pow`, `hypot` e le costanti `PI`, `TAU`, `HALF_PI`, `E`, `LN2`, `LN10`, `SQRT2`, `SQRT1_2`.

- Solo `+ - * /` e `Math.sqrt`, più operazioni esatte per definizione (`Math.floor`, `Math.round`, `Math.abs`, confronti) e la lettura dei bit di un double con `DataView` (in `log`).
- Algoritmi di fdlibm: riduzione dell'argomento alla Cody-Waite (π/2 in due parti; `ln 2` in due parti), polinomi minimax sull'intervallo ridotto, tabella esatta delle potenze di 2.
- Errore massimo misurato contro `Math.*` (assoluto per |risultato| ≤ 1, relativo sopra): circa 1e-16 per `sin`, `cos`, `atan`, `asin`, `exp`, `log`; 4e-16 per `tan`, `acos`, `atan2`; 4e-15 per `pow`. L'obiettivo era 1e-7.
- `sin`, `cos`, `tan` sono precise per |x| < 1e6; oltre restano deterministiche ma perdono precisione. Le fasi temporali vanno ridotte con il modulo intero prima (§8).
- `pow` con esponente intero fino a 1024 usa quadrati ripetuti (`pow(2, 10) === 1024`); `atan2(0, 0)` è 0 e il segno dello zero non è distinto.

### 5.4 Rumore (`core/noise.ts`)

| API | Intervallo | Note |
|---|---|---|
| `valueNoise2(seed, x, y)`, `valueNoise3(seed, x, y, z)` | [-1, 1] | Valori del reticolo interpolati con fade quintico (C2). Deviazione standard ~0.45 (2D), ~0.40 (3D). |
| `gradientNoise2(seed, x, y)`, `gradientNoise3(seed, x, y, z)` | [-1, 1] | Tipo Perlin, zero sui punti del reticolo. 2D: 8 gradienti unitari; 3D: i 12 spigoli del cubo. Normalizzati con il limite teorico calcolato (1/√2 in 2D, 1.0363538 in 3D). Deviazione standard ~0.31 (2D), ~0.26 (3D). |
| `new Fbm2(noise, seed, opts)`, `new Fbm3(...)`, `.sample(...)` | come il rumore base | Somma di ottave normalizzata per la somma delle ampiezze. `opts`: `octaves` (5), `lacunarity` (2), `gain` (0.5), `frequency` (1). Ogni ottava ha il suo seed `derive(seed, "octave", i)` e uno spostamento del reticolo, così le ottave non si allineano nell'origine. |
| `new Warp2(source, seed, opts)`, `new Warp3(...)`, `.sample(...)` | come `source` | Domain warp: campiona `source` in coordinate spostate da fbm di gradient noise indipendenti per asse (`derive(seed, "warp", "x")`…). `opts.amplitude` (1) è lo spostamento massimo. I warp si compongono. |
| `worley2(seed, x, y, out, jitter = 1)`, `worley3(...)` | F1 ∈ [0, √2] / [0, √3]; F2 ∈ [F1, √5] / [F1, √6] | Rumore cellulare euclideo. Scrive `f1`, `f2` e `cell` (id uint32 della cella più vicina) in un `CellSample` creato una volta con `createCellSample()`. F2−F1 è `out.f2 - out.f1`: vale 0 sui bordi delle celle. Ricerca **esatta**: anelli di celle fino a distanza 3, scartati con limiti inferiori per cella e per anello; il test la confronta con una ricerca esaustiva. |

`Field2`/`Field3` (`{ sample(...) }`) è l'interfaccia comune di fbm e warp; qualunque campo che la implementi può essere deformato. Oggetti come `Fbm3` si costruiscono **una volta per campo**, fuori dai cicli sui pixel.

**Prestazioni** (`npm run bench`, Node 26 su Apple Silicon, campo 256×256):

| Caso | Tempo |
|---|---|
| fbm 5 ottave, gradient 3D | ~29 ms (~440 ns per pixel, ~88 ns per ottava) |
| fbm 5 ottave, value 3D | ~28 ms |
| Worley 2D (F1, F2) | ~12 ms |
| Worley 3D (F1, F2) | ~33 ms |

### 5.5 Buffer (`core/buffer.ts`)

- `IndexedBuffer(w, h, data?)`: `Uint8Array` di indici di palette, **indice 0 = trasparente** (`TRANSPARENT`). `get` fuori dal buffer restituisce 0; `set`, `fill` e `blit` modificano il buffer e tagliano in silenzio ciò che esce dai bordi; `blit` copia solo i pixel non trasparenti. `crop`, `flipX`, `flipY` restituiscono un buffer nuovo; `crop` riempie di trasparente le parti fuori dall'originale.
- `FloatField(w, h, data?)`: `Float32Array` per campi intermedi (altezze, distanze, luce). `get` con coordinate bloccate al bordo; `set` fuori dal campo è ignorato.
- Coordinate intere, origine in alto a sinistra, righe consecutive.

### 5.6 Impronte (`core/fingerprint.ts`)

`fingerprint(buffer)` e `fingerprintBytes(bytes)`: FNV-1a a 32 bit in 8 cifre esadecimali. `fingerprint` include tipo e dimensioni del buffer, e legge i `FloatField` come bit float32 little-endian su ogni piattaforma.

### 5.7 Golden del core

`core/golden.test.ts` confronta con `tests/golden/core.json` le impronte di campi di rumore fissati (64×64: value, gradient, fbm, warp, Worley F1, F2−F1 e id delle celle), di una griglia di `hashCoords`, di percorsi `derive`, di 1024 uscite di `Rng` e di 2560 valori di `dmath`. Se una di queste cambia anche di un bit, il test fallisce. Per un cambio voluto: si rigenera con `npm test -- -u` e si registra il motivo in [Decisioni](#12-decisioni).

## 6. Linee guida visive

- **Risoluzione interna 480×270**, upscale intero. L'upscale è calcolato in pixel del dispositivo (`devicePixelRatio`), così un pixel del gioco è sempre un blocco esatto di pixel dello schermo.
- **Lo zoom non scala mai i pixel.** Lo zoom della camera è continuo, ma a ogni livello gli oggetti vengono generati alla dimensione giusta, a gradini discreti e con cache. Un pixel dell'oggetto è sempre un pixel dello schermo. Chiave di cache: (generatore@versione, ricetta, seed, gradino, frame, luce).
- **La luce di ogni corpo viene dalla sua stella**: 3–4 livelli quantizzati, con dither Bayer ancorato ai pixel dell'oggetto generato (non allo schermo: quando l'oggetto si muove, il dither si muove con lui e non “nuota”).
- **La luce sposta il colore lungo una rampa con hue shift**, non moltiplica l'RGB: le ombre vanno verso toni freddi e saturi, le luci verso toni caldi.
- **Outline con il tono più scuro della rampa del materiale**, non nero.
- **Si genera direttamente alla dimensione finale**, mai grande e poi rimpicciolito.

## 7. Universo

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

## 8. Tempo

- Il tempo è un **tick intero**. L'app fa avanzare il tick di un moltiplicatore per frame (pausa = 0).
- **Lo stato a un tick si calcola direttamente dal tick**, senza simulazione incrementale: posizioni orbitali, rotazioni e nuvole sono funzioni di (seed, tick). Saltare nel tempo costa O(1) e un link con un tick riporta esattamente allo stesso stato.
- Le fasi si calcolano con il modulo intero prima di passare ai float: `phase = (tick % period) / period`. Così la precisione non degrada con tick grandi (fino a 2^53).

## 9. Forge e workflow

`forge/` è la CLI con cui si guarda il lavoro (`npm run forge -- <comando>`):

| Comando | Output |
|---|---|
| `render <gen>` | Un oggetto in `out/render/` |
| `sheet <gen>` | Foglio di varianti (64 seed, griglia 8×8) in `out/sheets/` |
| `anim <gen>` | GIF di rotazione, nuvole e terminatore in `out/anim/` |
| `view <indirizzo>` | Vista dell'app 480×270 renderizzata senza browser in `out/views/` |
| `lint` | Controlli automatici su ricette, palette e output |
| `golden check\|update` | Confronto (o aggiornamento consapevole) con i golden |

Allo step 1 esiste solo l'help; i comandi arrivano allo step 3. Fuori dalla CLI, `npm run bench` esegue `forge/bench.ts`, i benchmark del core (§5.4).

**Ciclo di lavoro visivo**: modifica il generatore → genera un foglio di varianti → apri il PNG e guardalo davvero → descrivi cosa vedi → correggi → ripeti. La qualità si giudica sulla distribuzione (fogli di 64 seed), non su un seed fortunato.

**Fine di ogni step**: `npm run check` verde (typecheck, lint, test); fogli di preview aggiornati in `out/`; questo documento aggiornato se sono cambiate decisioni; un commit. Poi ci si ferma e si riassume, senza iniziare lo step successivo.

## 10. Stack e tooling

- **TypeScript 6.0 strict**, Node ≥ 20.19, npm, un solo package, ESM.
- **Vitest 4** per i test (`*.test.ts` accanto al codice), **tsx** per la CLI, **Vite 8** per l'app (`root: app`, build in `dist/`).
- **ESLint 10 + typescript-eslint** con le restrizioni di determinismo e di dipendenza tra moduli.
- **tsconfig per ambiente**, orchestrati da `tsc -b` tramite `tsconfig.json`:
  - `tsconfig.pure.json`: `core/`, `toolkit/`, `gen/`, `universe/`; solo `lib: ES2023`, nessun tipo DOM o Node;
  - `tsconfig.tools.json`: `forge/` e i file di configurazione; tipi Node;
  - `tsconfig.app.json`: `app/`; DOM e `vite/client`.
- **Dipendenze esterne solo in `forge/` e `app/`** (per esempio `pngjs` e `gifenc` in `forge/`, dallo step 3). `app/` non importa nulla da `forge/`.

## 11. Roadmap

| Step | Contenuto | Stato |
|---|---|---|
| 0 | Setup del repo, tooling, lint di determinismo, documenti di riferimento | fatto |
| 1 | **Core deterministico**: hash e `derive`, `Rng`, `dmath` (trigonometria, `exp`, `log`, `pow`… solo con `+ - * /` e `sqrt`), rumore da hash di reticolo (value, gradient, fbm, domain warp, Worley), buffer indicizzati, impronte e golden del core | fatto |
| 2 | **Stile, palette e toolkit**: `style/` a rampe con hue shift; luce quantizzata, dither Bayer, outline selettivo, pulizia, mappatura su palette, RGBA; SDF e rasterizzazione in `core/` (rinviate dallo step 1) | |
| 3 | **Forge CLI**: render, sheet, anim, lint, golden; `pngjs` e `gifenc` | |
| 4 | **Pianeti**: archetipi, mappa di superficie, rotazione, nuvole, terminatore, lune e anelli; descrittore | |
| 5 | **Stelle, asteroidi e sfondi** | |
| 6 | **Universo**: galassia, settori, sistemi, orbite, nomi, indirizzi | |
| 7 | **Esploratore**: renderer, zoom continuo a gradini con cache, tempo, interfaccia, pannello informativo; `forge view` | |
| 8 | **Fenomeni rari e megastrutture**: buchi neri, pulsar, rovine, megastrutture | |
| 9 | **Catalogo e scoperte**: catalogo personale, link agli indirizzi | |

## 12. Decisioni

Formato: data, step, decisione e motivo. Le voci non si cancellano: se una decisione cambia, se ne aggiunge una nuova che la sostituisce.

- **2026-09-26, step 0: lingua.** Documenti e testi della CLI in italiano; codice, identificatori, commenti nel codice e nomi dei seed derivati in inglese (`derive(seed, "clouds")`).
- **2026-09-26, step 0: TypeScript 6.0 invece di 7.** typescript-eslint supporta solo TypeScript < 6.1. Da rivalutare quando supporterà TS 7.
- **2026-09-26, step 0: Vitest 4 invece di 5.** Vitest 5 richiede Node ≥ 22.12, mentre lo stack prevede Node 20+. Il minimo effettivo è Node 20.19 (richiesto da Vite 8 ed ESLint 10). Node 20 è fuori supporto da aprile 2026: se si alza il minimo a 22, si può passare a Vitest 5.
- **2026-09-26, step 0: tsconfig separati per ambiente.** I moduli puri sono compilati senza tipi DOM e Node, così usarli è un errore di tipo oltre che di lint.
- **2026-09-26, step 0: lint di determinismo più ampio della lista minima.** Oltre alle funzioni elencate nella regola 5 sono vietate anche le varianti iperboliche e logaritmiche di `Math`, gli operatori `**` e `**=`, `for...in`, `Intl` e i metodi dipendenti dalla locale, `globalThis`, `crypto`, timer, DOM e Node.
- **2026-09-26, step 0: dipendenze tra moduli imposte dal lint.** `core` ← `toolkit` ← `gen`, `core` ← `universe`; `universe` non importa da `toolkit` né da `gen`; `app` non importa da `forge`. `gen` può importare da `universe`.
- **2026-09-26, step 0: `noUncheckedIndexedAccess` disattivato.** I generatori leggono typed array in cicli stretti, e il flag trasformerebbe ogni `buf[i]` in `number | undefined`.
- **2026-09-26, step 0: test accanto al codice.** `*.test.ts` nello stesso modulo, soggetti alle stesse regole di lint e typecheck del modulo.
- **2026-09-26, step 0: stato dal tick.** Orbite, rotazioni e nuvole sono funzioni dirette di (seed, tick), senza simulazione incrementale (vedi §8).
- **2026-09-26, step 1: seed a 32 bit.** Seed e hash sono uint32. Su milioni di oggetti qualche coppia avrà lo stesso seed (e quindi lo stesso aspetto, a parità di ricetta): è accettato, perché l'identità di un oggetto è il suo indirizzo, non il suo seed. Nessun codice deve usare il seed come chiave univoca.
- **2026-09-26, step 1: `derive` a più componenti.** `derive(seed, ...parts)` con nomi e interi sicuri (anche negativi, a 64 bit), gerarchica e iniettiva tra figli diretti dello stesso genitore (§5.1). I numeri non interi lanciano un errore invece di essere arrotondati in silenzio.
- **2026-09-26, step 1: `hashCoords` a stadi.** L'hash del reticolo è una catena x → y → z; gli stadi sono esportati così il rumore calcola una volta sola i prefissi comuni agli angoli della cella. Stessi bit di `hashCoords`, fbm 5 ottave da ~46 a ~29 ms su 256×256.
- **2026-09-26, step 1: sfc32 per `Rng`.** Preferito a xoshiro128** perché non ha stati proibiti (lo zero) e usa solo operazioni a 32 bit. `int(min, max)` include entrambi gli estremi; `shuffle` lavora sul posto.
- **2026-09-26, step 1: dmath da fdlibm.** Algoritmi e coefficienti di fdlibm: precisione vicina al double (≤ 4e-15) invece del minimo richiesto di 1e-7, allo stesso costo. Oltre alle funzioni richieste esporta `atan`, `hypot`, `LN10`, `SQRT1_2`. Sono ammessi anche `Math.floor/round/abs` e la lettura dei bit con `DataView`, esatti per definizione.
- **2026-09-26, step 1: rumore anche in 2D.** Oltre al 3D (necessario per le sfere senza cuciture) ci sono value e gradient noise 2D, due volte più economici, per sfondi e mappe piane.
- **2026-09-26, step 1: intervalli garantiti.** Il gradient noise è normalizzato con il suo limite teorico (massimizzazione numerica nella cella: 1/√2 in 2D, 1.0363538 in 3D), quindi resta in [-1, 1] senza clamp; fbm e warp conservano l'intervallo del rumore base.
- **2026-09-26, step 1: fbm e warp come oggetti.** `Fbm2/3` e `Warp2/3` precalcolano seed, frequenze, ampiezze e spostamenti per ottava alla costruzione; `sample` non alloca. Niente closure per campione.
- **2026-09-26, step 1: Worley esatto.** La ricerca copre gli anelli di celle fino a distanza 3 con scarto per limite inferiore, invece del solo 3×3 (che sbaglia F1 e F2 in casi rari e crea discontinuità). Il risultato va in un `CellSample` riutilizzabile, con l'id della cella per colorare cristalli e crateri.
- **2026-09-26, step 1: indice 0 trasparente.** Ogni `IndexedBuffer` riserva l'indice 0 alla trasparenza; la palette ha quindi al massimo 255 colori.
- **2026-09-26, step 1: buffer come classi.** `IndexedBuffer` e `FloatField` hanno i metodi sul prototipo e campi pubblici `{ w, h, data }`. Le operazioni di disegno modificano il buffer, le trasformazioni ne restituiscono uno nuovo.
- **2026-09-26, step 1: golden del core come impronte.** `tests/golden/core.json` contiene impronte FNV-1a, confrontate con `toMatchFileSnapshot` di Vitest: niente accesso al file system nei test dei moduli puri, aggiornamento con `npm test -- -u`. Il formato dei golden dei generatori resta da decidere allo step 3.
- **2026-09-26, step 1: `Math.*` ammesso nei test dei moduli puri.** Serve come riferimento per `dmath`; il lint lo permette solo nei `*.test.ts`. `Math.random`, orologio e il resto delle regole restano vietati anche lì.
- **2026-09-26, step 1: benchmark fuori da Vitest.** `vitest bench` misurava tempi fino a 3 volte più alti di Node sullo stesso codice (87 ms contro 29), e peggiorava proprio dopo un'ottimizzazione che in Node rende il 40% più veloce. La causa probabile, non verificata, è la trasformazione dei moduli di Vitest, che trasforma ogni chiamata a una funzione importata in una lettura di proprietà. `forge/bench.ts` gira con tsx su Node, come il codice reale.
- **2026-09-26, step 1: SDF e rasterizzazione rinviate.** Non facevano parte della richiesta dello step 1; passano allo step 2, dove servono al toolkit.

## 13. Questioni aperte

- **Palette**: unica globale o per scena; numero di rampe e di toni per rampa; limite di 255 colori più trasparenza. Step 2.
- **Formato dei golden dei generatori**: solo impronte, come per il core, o anche PNG di riferimento da guardare. Step 3.
- **Determinismo verificato anche nel browser**: come confrontare gli stessi golden in Node e nel browser. Step 3 o 7.
- **Descrittore senza rasterizzare**: serve per il pannello e per trovare oggetti rari da lontano senza generare pixel. Step 4 o 6.
- **Forma dell'universo**: una galassia finita su un piano infinito di settori, o altro? Step 6.
- **Gradini di dimensione**: quali (potenze di 2, √2…) e budget della cache. Step 7.
- **Persistenza del catalogo**: storage del browser, export, entrambi. Step 9.
- **Prestazioni nel browser**: i tempi del §5.4 sono misurati in Node; vanno verificati nell'app. Step 7.

Risolte allo step 1 (vedi Decisioni): dimensione dei seed, `derive` a più componenti, indice 0 trasparente.
