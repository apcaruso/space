# spatialengine: design

Documento di riferimento per tutte le sessioni. Le scelte fatte strada facendo vanno in [Decisioni](#14-decisioni); i dubbi ancora aperti in [Questioni aperte](#15-questioni-aperte).

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
| `view/` | L'esploratore senza browser: camera, geometria schematica dei sistemi, catalogo della galassia, bagliore, sprite a gradini con cache, composizione nel framebuffer, interfaccia disegnata a codice, voli, ricerca. Lo usano `app/` e `forge view`. | puro |
| `style/` | Palette globale organizzata in rampe (JSON). | dati |
| `recipes/` | Oggetti speciali con seed fissato (JSON). | dati |
| `forge/` | CLI: render, fogli di varianti, animazioni, lint, test golden, viste dell'app renderizzate senza browser. | Node |
| `app/` | L'esploratore nel browser: canvas, presentazione, input, orologio reale, URL e Web Worker attorno a `view/`. | browser |

**Moduli puri** (`core/`, `toolkit/`, `gen/`, `universe/`, `view/`): nessuna dipendenza npm, solo import relativi (compresi i JSON di `style/` e `recipes/`), nessun accesso a DOM, Node, orologio, timer, I/O o `Math.random`. Girano identici in Node (forge, test) e nel browser (app).

### Dipendenze tra moduli

```
core ◄── toolkit ◄── gen ◄── view
  ▲                   │       │
  └──── universe ◄────┴───────┘   (gen e view usano universe; universe non usa nessuno dei tre)

forge ──► tutti i moduli puri, style/, recipes/
app   ──► tutti i moduli puri, style/, recipes/      (app non importa nulla da forge)
```

- `core/` non importa da nessun altro modulo.
- `toolkit/` importa solo da `core/`.
- `universe/` importa solo da `core/`: decide *che cosa* esiste (tipo, seed, parametri fisici), non *come appare*.
- `gen/` importa da `core/`, `toolkit/` ed eventualmente da `universe/` (vocabolario condiviso, tipi).
- `view/` importa da tutti i moduli puri; nessun modulo puro importa da `view/`.
- Chi unisce universo e grafica sono `app/` e `forge/`; le mappe di `gen/maps/` disegnano oggetti dell'universo, ma solo in lettura.

Queste regole sono imposte da ESLint (`no-restricted-imports` in `eslint.config.js`).

### Contratto dei generatori

```ts
generate(recipe, seed, opts) -> { buffer, descriptor }
```

- `recipe`: parametri JSON del generatore (archetipo, rampe, soglie…), già validati e completati con i default dallo schema (§3, "Ricette").
- `seed`: uint32; ogni sottosistema ne deriva il proprio con `derive(seed, "nome")`.
- `opts`: ciò che non è identità dell'oggetto: `size` (dimensione dell'oggetto in pixel a quel gradino di zoom, per un pianeta il diametro; il buffer può essere più grande per outline, bagliore e anelli, e il descrittore dice dove sta l'oggetto), `frame` (tick intero), `lightDir` (versore verso la stella, coordinate dello schermo).
- `buffer`: `IndexedBuffer` di indici di palette. La conversione in RGBA avviene solo alla fine, in `app/` o `forge/`.
- `descriptor`: dati derivati dalla stessa generazione, solo JSON: raggio, classificazione, mappa di superficie, punti notevoli.
- **Versione**: ogni generatore dichiara un id versionato (`"planet@1"`). Se l'output cambia, si alza la versione o si aggiornano consapevolmente i golden.

Ogni generatore è un oggetto `defineGenerator({ name, version, description, recipe, sizes, loop, generate, validators, maxAttempts, goldens })` in `gen/`, elencato in `gen/index.ts`:

- `recipe`: schema dichiarativo della ricetta;
- `resolve` (facoltativo): trasforma l'input grezzo prima della validazione (preset, archetipo scelto dal seed); riceve il seed richiesto, mai quello di un ritentativo, così i ritentativi conservano ciò che ha scelto;
- `sizes`: lato minimo, massimo e di default;
- `light` (facoltativo): luce di default del generatore (azimut ed elevazione), usata anche per la resa canonica;
- `loop`: frame di un giro dell'animazione;
- `validators`: funzioni `check(result, recipe)` che restituiscono un motivo di scarto o `null`; leggono solo il descrittore;
- `describe` (facoltativo, dallo step 7): i campi del descrittore che non dipendono da lato, frame e luce, **senza rasterizzare**; se c'è, i validatori giudicano quello invece di una resa canonica;
- `maxAttempts`: tentativi massimi, default 8;
- `goldens`: casi fissati (seed, ricetta, lato, frame, luce) per `forge golden`.

**Registro** (`gen/registry.ts`, `registry` in `gen/index.ts`):

- `run(nome, ricetta, seed, opts)` risolve la ricetta, sceglie il tentativo e genera; `runMany` rende più frame, lati o luci dello stesso oggetto validandolo una volta sola; `select` sceglie solo il tentativo.
- **Ritentativi deterministici**: il tentativo n usa `derive(seed, "retry", n)` (il tentativo 0 usa il seed stesso), finché i validatori passano. Se nessun tentativo passa, si usa il tentativo 0 e il risultato è marcato `accepted: false`.
- **I validatori giudicano una resa canonica** (lato di default, frame 0, luce di default), o il `describe` del generatore quando c'è: la scelta del tentativo dipende solo da ricetta e seed, e lo stesso oggetto resta lo stesso a ogni gradino di zoom, frame e luce. Il registro ricorda le ultime 4096 scelte.

**Ricette** (`gen/schema.ts`, senza dipendenze, usato anche dall'app): campi `num`, `int`, `bool`, `choice`, `obj` con default, intervalli e documentazione. `parseRecipe` completa i default, ordina le chiavi (stessa ricetta, stesso JSON) e in caso di errore lancia `RecipeError` con **tutti** i problemi, uno per riga, ordinati per percorso: `ricetta.noise.octaves: atteso un intero tra 1 e 8, ricevuto 12`, `ricetta.seaLevl: campo sconosciuto (forse intendevi "seaLevel"?)`.

**Coerenza tra gradini**: lo stesso oggetto, generato a dimensioni diverse, deve essere riconoscibilmente lo stesso. Identità, classificazione, mappa di superficie logica e punti notevoli (in coordinate normalizzate) dipendono solo da ricetta e seed, non dalla dimensione; la dimensione influenza solo la rasterizzazione. Il generatore di prova `testdisc` ne è l'esempio: la sua copertura di terra è misurata su punti della sfera, non sui pixel, ed è identica a ogni lato e frame.

### Pipeline tipica di un generatore

Confermata allo step 2 (API in §6):

1. **Forma**: SDF e campi di rumore in coordinate normalizzate dell'oggetto (così la stessa forma vale a ogni gradino). Ne escono un campo di altezze (`FloatField`) e una mappa dei materiali (`IndexedBuffer`: 0 = vuoto, k = materiale k).
2. **Pulizia dei materiali**: `removeOrphans` e `fillHoles` sulla mappa dei materiali, *prima* dello shading (dopo cancellerebbero il dither).
3. **Shading** (`shade`): normali dalle altezze, livello di luce quantizzato dalla direzione della stella, dither Bayer ancorato ai pixel dell'oggetto solo sulle sfumature continue, livello → tono della rampa del materiale.
4. **Outline selettivo** (`outline`) con il tono più scuro della rampa adiacente; opzionale la linea interna tra materiali.
5. **Linee pixel-perfect** (`fixCorners` sui colori dell'outline).
6. **Output indicizzato**; effetti per tabella (swap, cycling, luce) e RGBA solo alla fine, in `app/` o `forge/`.

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
| Test golden | Stessi byte a parità di input; cambi di output intercettati. Core: `tests/golden/core.json` (§5.7); generatori: `tests/golden/<gen>.json`, verificati da `forge golden check` e da `npm test` (§12). |

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

`sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `log`, `pow`, `cbrt` (dallo step 2, per OKLab), `hypot` e le costanti `PI`, `TAU`, `HALF_PI`, `E`, `LN2`, `LN10`, `SQRT2`, `SQRT1_2`.

- Solo `+ - * /` e `Math.sqrt`, più operazioni esatte per definizione (`Math.floor`, `Math.round`, `Math.abs`, confronti) e la lettura dei bit di un double con `DataView` (in `log`).
- Algoritmi di fdlibm: riduzione dell'argomento alla Cody-Waite (π/2 in due parti; `ln 2` in due parti), polinomi minimax sull'intervallo ridotto, tabella esatta delle potenze di 2.
- Errore massimo misurato contro `Math.*` (assoluto per |risultato| ≤ 1, relativo sopra): circa 1e-16 per `sin`, `cos`, `atan`, `asin`, `exp`, `log`; 4e-16 per `tan`, `acos`, `atan2`; 4e-15 per `pow`. L'obiettivo era 1e-7.
- `sin`, `cos`, `tan` sono precise per |x| < 1e6; oltre restano deterministiche ma perdono precisione. Le fasi temporali vanno ridotte con il modulo intero prima (§10).
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

`core/golden.test.ts` confronta con `tests/golden/core.json` le impronte di campi di rumore fissati (64×64: value, gradient, fbm, warp, Worley F1, F2−F1 e id delle celle), di una griglia di `hashCoords`, di percorsi `derive`, di 1024 uscite di `Rng` e di 2560 valori di `dmath`. Se una di queste cambia anche di un bit, il test fallisce. Per un cambio voluto: si rigenera con `npm test -- -u` e si registra il motivo in [Decisioni](#14-decisioni).

## 6. Palette e toolkit

### 6.1 Regole della palette

- **Una sola palette master** per tutto l'universo: `style/palette.json`, al massimo 63 colori più l'indice 0 **trasparente**. Ogni buffer indicizzato usa questi indici.
- **Non si modifica a mano.** È generata da `style/ramps.json` con `npm run palette` (`forge/make-palette.ts`); un test (`forge/palette.test.ts`) fallisce se i due file non corrispondono. Per cambiarla: modifica i parametri, rigenera, guarda `out/step2-palette.png` e `out/step2-shading.png`, committa entrambi i JSON. Cambiare la palette cambia l'output di ogni generatore: vanno aggiornati i golden.
- **Rampe**: sequenze di 4–6 indici dal più scuro al più chiaro. Ogni rampa è generata in **OKLCH** (spazio percettivo):
  - luminosità da `lightness[0]` a `lightness[1]` lungo una curva (`curve`);
  - croma massima a metà rampa e ridotta agli estremi (`chromaFalloff`);
  - **hue shift**: le ombre ruotano verso una tinta fredda (`coolHue`, default 285, blu-viola), le luci verso una calda (`warmHue`, default 90, giallo), al massimo di `hueShift` gradi; ogni rampa può avere i suoi target (`metal-ancient`: ombre verso il verde della patina);
  - i colori fuori gamut sRGB perdono croma, mai luminosità o tinta.
- **Colori condivisi.** 23 rampe da 4–6 toni sono 100 toni, che non stanno in 63 colori: il builder unisce i toni vicini di rampe diverse, cominciando dalla coppia più vicina, finché la palette entra. Un'unione è rifiutata se:
  - unisce due toni della stessa rampa, o rompe l'ordine di luminosità di una rampa (passo minimo `minStep` = 0.05 in L);
  - sposta un tono di più di `mergeDistance` (0.065 in OKLab; lo spostamento massimo effettivo è 0.042);
  - ruota la tinta di un tono saturo di più di `maxHueMove` (25°), gli toglie più di `maxChromaLoss` (50%) della croma, o dà una tinta a un grigio;
  - coinvolge il **tono chiave** di una rampa (quello centrale, indice ⌊n/2⌋): ogni rampa ha almeno un colore tutto suo;
  - fa condividere a due rampe più di `maxShared` (2) colori.
- **Conseguenza**: un indice può appartenere a più rampe. Le operazioni che partono da un indice usano la sua **rampa di casa** (la prima che lo elenca); `related(a, b)` dice se due indici compaiono insieme in almeno una rampa, cioè appartengono alla stessa famiglia di materiali.

Rampe attuali (100 toni → 63 colori, 37 toni condivisi):

| Rampa | Toni | Uso |
|---|---|---|
| `space` | 4 | sfondo, nebulose scure |
| `ocean`, `coast` | 5, 4 | acqua profonda, bassi fondali |
| `vegetation` | 5 | vegetazione |
| `rock`, `sand`, `basalt`, `ash` | 5, 4, 4, 4 | superfici rocciose, deserti, lava fredda, cenere |
| `ice`, `cloud` | 4, 4 | ghiaccio, nuvole |
| `magma` | 5 | lava, superfici incandescenti (emissiva) |
| `gas-warm`, `gas-cold`, `gas-violet` | 5, 5, 5 | bande dei giganti gassosi |
| `metal-light`, `metal-dark`, `metal-ancient` | 4, 4, 5 | strutture artificiali; bronzo con patina per le rovine |
| `energy`, `aurora` | 4, 4 | bagliori, scudi, aurore (emissive) |
| `crystal-magenta`, `crystal-teal` | 4, 4 | cristalli alieni |
| `ui-cool`, `ui-warm` | 4, 4 | interfaccia |

Le coppie più vicine sono `rock`/`ash` e `basalt`/`metal-dark`, che condividono i due toni scuri e restano distinte nei toni centrali.

### 6.2 API del toolkit (`toolkit/`)

| Modulo | API |
|---|---|
| `color.ts` | Conversioni sRGB ↔ sRGB lineare ↔ OKLab ↔ OKLCH, `clipChroma`, `inGamut`, esadecimale, `labDistance`. Tutte su `core/dmath`. |
| `palette.ts` | `masterPalette()` (caricata da `style/palette.json` al primo uso), `Palette.fromData(data)` con validazione. Metodi: `ramp(name)`, `index(ramp, tone)` con tono limitato alla rampa, `darkest(ramp)`, `darkestIndices()`, `homeRamp(i)`, `toneOf(i)`, `related(a, b)`, `lightnessOf(i)`, `toRGBA(buf)` (trasparente con alpha 0, indici inesistenti in magenta). |
| | **Tabelle** (`IndexTable`, 256 voci indice → indice): `swapTable(from, to)` (palette swap, per posizione, scalata se le lunghezze differiscono), `cycleTable(ramp, frame, { period, from, to })` (palette cycling su tick intero), `lightTable(delta)` (sposta ogni indice di `delta` toni lungo la rampa di casa, per schiarire o scurire senza alpha; 0 resta 0 e nulla diventa 0). `applyTable(buf, table)` e `composeTables(a, b)`. |
| `light.ts` | `direction(x, y, z)`; `lightFromAngle(azimut, elevazione)` (gradi; azimut 0 = luce dall'alto, senso orario); `lightValue(normale, luce, opts)` → livello continuo; `quantizeLevel(v, opts, soglia, larghezza)`; `lightLevel(...)`. Opzioni: `levels`, `terminator` (n·l sotto cui è ombra, default 0), `ambient` (livello del lato in ombra, default 0), `minLevel` (materiali emissivi). Il lato illuminato divide n·l in bande di uguale ampiezza; il lato in ombra non viene mai sfumato. |
| `dither.ts` | `BAYER2`, `BAYER4`, `BAYER8` (costruite per raddoppio ricorsivo), `bayerThreshold(m, x, y)` con coordinate locali dell'oggetto (anche negative), `ditherQuantize(v, soglia, larghezza)`: i confini tra livelli cadono sugli interi, `larghezza` è l'ampiezza della fascia sfumata attorno a ciascun confine (1 = tutta, 0 = bande nette). |
| `shade.ts` | `shade(altezze, materiali, tabellaMateriali, palette, opts)`: normali con limitatore **minmod** (gli spigoli restano netti), livello di luce, dither **solo dove la luce varia in modo monotono per 2 pixel per lato** (facce piatte e spigoli restano pieni), livello → tono. Il tono più scuro è riservato all'outline (`reserveDarkest`, default sì); i livelli sono al massimo i toni disponibili. Default: 4 livelli, `BAYER4`, fascia 0.3. Per materiale: `emissive` (livello minimo), `albedo` (livelli in più o in meno sul lato illuminato: bande, bordi e fondi di cratere), `shadowTone`. Opzioni dallo step 4: `shadow` (rampa del lato in ombra: i materiali non emissivi vi prendono un tono scuro, così la notte di un pianeta è buia anche per nuvole e ghiaccio) e `shape` (altezze della forma di base: il lato in ombra si decide su quelle, così il rilievo non sparge pixel illuminati nella notte). |
| `outline.ts` | `outline(buf, palette, { diagonal, inner, skip })`: outline esterno di 1 px, ortogonale di default, con il tono più scuro della rampa del pixel adiacente (vince il più scuro dove si toccano più materiali); `inner` traccia linee interne dove si toccano rampe non imparentate, sul lato più chiaro; `skip` esclude rampe (emissive); `ceiling` sostituisce i colori di outline troppo chiari (il tono più scuro di nuvole e ghiaccio è un grigio) con un indice scuro. Non allarga il buffer: serve un margine trasparente. |
| `cleanup.ts` | `removeOrphans` (pixel senza vicini dello stesso indice → il valore più comune attorno; da usare sulle mappe dei materiali, non sull'output sfumato), `fillHoles` (buchi trasparenti di 1 px), `fixCorners(buf, lineIndices?)` (linee pixel-perfect: toglie gli angoli a L dei gradini da 1 px, conserva gli angoli veri e i blocchi). |
| `font.ts` | Due font bitmap: `SMALL` 3×5 (dallo step 7 con minuscole di x-height 4 e discendenti di una riga) e `LARGE` 5×7 (titoli); entrambi con cifre, punteggiatura, `· × ° ›` e lettere accentate italiane, generate dal codice come lettera base più segno d'accento. `SMALL_CAPS` disegna le minuscole come maiuscole (etichette dei fogli). `drawText(buf, testo, x, y, indice, font?)`, `textWidth(testo, font?)`, `fitText`, `charset(font)`. Caratteri sconosciuti come `?`. Unico elemento grafico definito a mano; un test verifica che ogni glifo sia diverso dagli altri in ogni font. |

## 7. Generatori

### 7.1 Pianeti (`gen/planet/`)

`planet@2`, diametro da 8 a 256 px (default 64), giro di 96 frame, luce di default radente (azimut 290°, elevazione 25°) per un terminatore leggibile.

**Pipeline**

1. **Mappe equirettangolari** 2H × H di superficie e nuvole, campionando campi 3D sulla sfera unitaria (nessuna cucitura). H è la potenza di 2 pari o superiore al diametro (dallo step 7; prima 1,6 × diametro): circa una cella per pixel al centro del disco, e una mappa serve tutti i gradini fino alla potenza di 2 successiva. I campi si normalizzano in [0, 1] con minimo e massimo misurati su 1024 punti di Fibonacci della sfera, sempre con tutte le ottave: le soglie significano la stessa cosa a ogni dimensione. La copertura delle nuvole è un quantile su quegli stessi punti, quindi `clouds.coverage` è davvero la frazione di cielo coperta.
2. **Classificazione** in materiali: liquido, liquido basso, pianura, altopiano (soglie `levels`), crepe (rete di rumore "ridged", sottile), calotte (in funzione di |latitudine| e altezza). Tre forme di superficie: `terrain` (fbm con domain warp), `bands` (latitudine deformata da un flusso zonale, 3 tinte con albedo −1/0/+1, tempeste ovali: una grande e qualche minore) e `craters` (due strati di Worley: fondo scuro e basso, bordo chiaro e rilevato).
3. **Pulizia in spazio mappa**: filtro di maggioranza (2 passaggi, wrap in longitudine) su superficie e nuvole; le crepe sono escluse. Stabile durante la rotazione, a differenza di una pulizia sullo schermo.
4. **Proiezione**: per ogni pixel del disco, normale della sfera → latitudine e longitudine rispetto all'asse del pianeta (inclinato sullo schermo e verso chi guarda) → cella della mappa (al più vicino). La longitudine ruota con il frame; le nuvole hanno un periodo loro (default 48, un divisore di 96, così la GIF gira in loop).
5. **Shading** con `shade`: altezze = sfera + rilievo, forma di base = sfera, rampa d'ombra `space`. I materiali emissivi (magma) tengono un livello minimo e brillano sul lato notte.
6. **Outline** selettivo con tetto di luminosità, **bordo d'atmosfera** sul lato illuminato (l'anello esterno, e da 48 px anche il bordo interno).
7. **Anelli** nel piano equatoriale: metà posteriore, poi il pianeta, poi metà anteriore. Divisioni e anelli più chiari o più scuri da rumore radiale; l'ombra del pianeta sugli anelli prende il colore della notte.

**Ricetta e archetipi.** Una sola ricetta per tutti (superficie, livelli, rampe, emissività, calotte, rilievo, bande, crateri, nuvole, atmosfera, anelli, asse, periodo, limiti dei validatori). I preset in `recipes/planets/*.json` sovrascrivono parti della ricetta; `resolve` sceglie l'archetipo (dall'input o, con `auto`, dal seed richiesto con pesi), poi una variante del preset dal seed, poi applica l'input sopra.

| Archetipo | Preset | Tratti |
|---|---|---|
| `terran` | terran | oceani, bassi fondali, continenti verdi, altopiani, calotte, nuvole, atmosfera azzurra |
| `ocean` | ocean | mare quasi ovunque, isole di sabbia e verde, bassi fondali turchesi, nuvole a strisce |
| `desert` | desert, desert-red | sabbia (chiara o ruggine) e rocce, piccole calotte, poche nuvole |
| `ice` | ice | ghiaccio e neve, pozze turchesi, crepe blu, calotte ampie |
| `lava` | lava | crosta di basalto e cenere, magma emissivo (nuclei gialli, bordi rossi), crepe incandescenti, fumo |
| `toxic` | toxic | mari acidi turchesi, terre color bronzo, nuvole verdi dense, atmosfera verde |
| `gas` | gas-warm, gas-cold, gas-violet | bande zonali, tempeste ovali, anelli nel 45% dei casi |
| `cratered` | cratered, cratered-ice | lune grigie o ghiacciate coperte di crateri, senza atmosfera |
| `dead` | dead, dead-basalt | rocce e basalti senza liquidi né atmosfera |

**Livello di dettaglio** (mai generare grande e rimpicciolire):

| Righe della mappa (diametro) | Ottave | Crateri | Crepe | Bande | Dither |
|---|---|---|---|---|---|
| 16–32 (8–32 px) | −2 | 1 strato | no | metà | Bayer 2×2 sotto 32 px, fascia 0,15 |
| 64 (33–64 px) | −1 | 1 strato | sì | tutte | Bayer 4×4, fascia 0,3 |
| 128 (65–128 px) | tutte | 1 strato | sì | tutte | Bayer 4×4, fascia 0,3 |
| 256 (129–256 px) | tutte | 2 strati | sì | tutte | Bayer 4×4, fascia 0,3 |

Le ottave in meno non cambiano la normalizzazione (si somma un prefisso della stessa serie), quindi coste e bande restano dove sono.

**Descrittore**: archetipo, raggio, centro nel buffer, quota di terra, composizione per materiale, asse (roll e lean in gradi), anelli (raggi interno ed esterno o `null`), mappa di superficie 64 × 32 (materiali e altezze codificati un simbolo per cella, legenda inclusa, senza filtro di maggioranza) e `features: []` (punti notevoli per le rovine dello step 8 e il catalogo dello step 9). Tutto dipende solo da ricetta e seed: identico a ogni diametro, frame e luce.

**Validatori** (soglie tarate con `forge lint` su 128 seed): `land` (quota di terra entro i limiti del preset, per esempio terrestre 15–90%), `bands` (una tinta di banda sopra il 62% = bande troppo uniformi), `craters` (crateri su meno del 18% o più del 60%).

**Prestazioni** (Node, dallo step 7). La scelta del tentativo usa `describe` (mappa del descrittore 32 righe), non una resa a 64 px: 4–24 ms invece di 40–100. Un pianeta nuovo: 10–14 ms a 24 px (prima 11–15), 55–90 ms a 128 px (prima 115–207), circa 300 ms a 256 px; con le mappe in cache (altri frame, altre luci, gradini della stessa potenza di 2) 1–2 ms a 24 px. Le mappe stanno in una cache del modulo limitata a 32 MB; la normalizzazione (1024 punti di Fibonacci) è condivisa tra i livelli di dettaglio. Una hit restituisce esattamente ciò che una ricostruzione produrrebbe.

**Punti deboli noti** (dalle ultime revisioni dei fogli):

- Le nuvole dei terrestri sono macchie bianche dai bordi a gradini, senza vortici né ombre sulla superficie.
- Il tossico deve la sua identità soprattutto alle nuvole verdi: i mari acidi si vedono poco.
- Il roccioso morto è un motivo "mimetico" generico, senza canyon o altipiani riconoscibili; il deserto varia poco oltre i due colori.
- Nei giganti le tempeste sono spesso piccole o sul lato notte, e dentro le bande non c'è dettaglio longitudinale a 128 px e oltre.
- Gli anelli quasi di taglio hanno bordi a scalini; il pianeta non riceve l'ombra degli anelli.
- Il lato notte è una tinta piatta; la parte illuminata, con luce da 25°, è una "lente" che a 16 px sembra un limone.
- Vicino al bordo il campionamento al più vicino comprime molte celle in un pixel e lascia qualche scalino.
- Asse e anelli si decidono dal seed del tentativo accettato: un ritentativo può cambiarli (l'archetipo invece resta).

### 7.1.1 Mappa di superficie (`gen/planet/surface.ts`)

`surface@1`: la mappa equirettangolare di un pianeta, larga da 64 a 512 px (alta la metà), per il livello "superficie" dell'esploratore. Stessa ricetta, `resolve`, validatori e `describe` di `planet`: il registro sceglie lo stesso tentativo, quindi è la superficie di *quel* pianeta. Materiali dalla mappa a pieno dettaglio (almeno 64 righe), rilievo ombreggiato con `shade` da un sole a nord-ovest (elevazione 30°), niente nuvole. Il descrittore aggiunge la legenda: materiali presenti, rampa e quota **pesata per area** (con la sola conta dei pixel le calotte polari risultavano più del doppio).

### 7.2 Stelle (`gen/star/`)

`star@1`. `size` è il diametro di una stella tipo Sole a quel gradino di zoom; la classe lo scala. Le stelle fanno luce propria: nessun terminatore, la direzione della luce non cambia nulla.

| Classe | Scala | Superficie → corona | Aspetto |
|---|---|---|---|
| O | 1,5 | `energy` → `ocean` | ciano-bianca, grande alone blu |
| B | 1,3 | `ice` → `gas-cold` | azzurra |
| A | 1,15 | `cloud` → `metal-light` | bianca, alone grigio |
| F | 1,05 | `sand` → `sand` | crema |
| G | 1 | `ui-warm` → `ui-warm` | oro |
| K | 0,88 | `magma` (toni chiari) → `magma` | arancio |
| M | 0,72 | `magma` (toni medi) → `magma` scuro | rossa, piccola |
| nana bianca | 0,4 | `cloud` → `energy` | puntino bianco con bagliore a croce |
| gigante rossa | 2,2 | `magma` → `magma` scuro | enorme, celle di convezione grandi |
| stella di neutroni | 0,22 | `energy` → `crystal-magenta` | puntino con bagliore a croce magenta |

- **Toni**: la palette è piena, quindi le classi riusano rampe esistenti con intervalli di toni diversi (K e M condividono `magma`: toni chiari contro toni medi). La superficie usa i toni più chiari della rampa e il tono più interno della corona coincide con quello del bordo: la luce scende senza salti dal nucleo allo spazio.
- **Superficie**: oscuramento al bordo come `dz^p` (nucleo, anello, bordo leggibili); granulazione = celle di Worley sulla sfera in rotazione, ognuna con una sua fase che pulsa (`sin`), più corsie scure tra le celle. Loop perfetto: rotazione 96 frame, battito 48.
- **Alone**: gradiente statico dal tono del bordo verso l'esterno, con dither e bordo irregolare (rumore sull'angolo). **Palette cycling** solo sui filamenti di corona: raggi sottili dal bordo i cui pixel ripetono i toni della corona in sequenza, così ruotare la tabella fa scorrere il plasma verso l'esterno. Ruotare i toni del gradiente, invece, lo capovolgeva (anello scuro attorno al disco).
- **Stelle minuscole** (disco ≤ 8 px): bagliore a croce, perché si leggano come stelle e non come punti.
- **Descrittore**: classe, etichetta spettrale (per esempio `G8 V`, `D3`, `NS`), temperatura, luminosità in soli, intensità 0..1 (per l'illuminazione dei pianeti), raggio, raggio dell'alone, centro. Dipende solo da ricetta e seed.

### 7.3 Asteroidi (`gen/asteroid/`)

`asteroid@1`, diametro medio da 6 a 48 px, materiali roccioso (`rock`/`ash`), metallico (`metal-dark` con venature `metal-light`), ghiacciato (`ice`/`cloud`) e cristallino (basalto con faccette `crystal-magenta` o `crystal-teal`); con `auto` il materiale viene dal seed.

- **Silhouette**: raggio in coordinate polari = 1 + bozze (fbm campionato su un cerchio, quindi senza cucitura, al più 2 ottave: patate, non stelle) + allungamento (`cos 2θ`), normalizzato a media 1.
- **Altezze**: cupola normalizzata sul contorno + rumore + crateri Worley (fondo basso, bordo rilevato); le faccette dei cristalli sono piani inclinati per cella di Worley. Shading con `shade`, forma di base e rampa d'ombra come i pianeti; pulizia dei pixel isolati sulla mappa dei materiali.
- **Rotazione** nel piano dello schermo in funzione del frame (verso dal seed): forma e superficie girano insieme, la luce resta ferma.
- **Descrittore**: materiale, raggio medio, centro, contorno (32 raggi normalizzati nel riferimento dell'oggetto, per la selezione con il clic: l'app li ruota del giro corrente), periodo e verso di rotazione.
- **Validatore** `shape`: rapporto tra raggio massimo e minimo tra 1,15 (non troppo tondo) e 2,6 (non troppo sottile).

### 7.4 Sfondi (`gen/background/`)

`background@1`: sfondo infinito diviso in chunk (`size` = lato, default 256) indirizzati da `chunk.x`, `chunk.y` interi.

- **Senza cuciture per costruzione**: tutto si calcola in coordinate globali (chunk × lato + pixel), anche il dither di Bayer; ciò che sta vicino a un bordo (stelle, galassie) viene disegnato da ogni chunk che tocca. Un test verifica che quattro chunk da 64 px accostati siano identici byte per byte a un chunk da 128.
- **Strati** (`layer`): `nebula`, `far`, `mid`, `near`, che l'app farà scorrere a velocità diverse (parallasse); `all` li sovrappone su fondo `space` per le preview.
- **Stelle**: una al più per cella di griglia (9, 22 e 54 px per strato), colori tenui (toni scuri di `space`, `ash`, `ice`, `sand`...), qualche croce luminosa solo nello strato vicino. **Scintillio** con palette cycling sui toni 0–2 di `metal-light`, rampa che nello sfondo usano solo le stelle che scintillano: ogni stella parte da un tono diverso, quindi non lampeggiano insieme.
- **Nebulose**: fbm con domain warp; sotto la soglia trasparente, poi un velo neutro (`space` tono 2) e nei nuclei i toni 0–1 della rampa di regione, con una rampa d'accento in zone proprie; dither su ogni bordo. Toni scuri apposta: lo sfondo non compete con gli oggetti.
- **Galassie lontane**: rare (una cella di 192 px su quattro circa, per `galaxies` = 1), 5–13 px, a spirale o ellittiche, tenui.
- **Parametri di regione** dall'esterno (`region`): densità delle stelle, quantità di nebulose, rampa dominante e d'accento, frequenza delle galassie.
- **Descrittore**: chunk, origine globale, numero di stelle per strato, galassie con posizione globale, copertura della nebulosa.

**Prestazioni** (Node): stella 40 px ~4 ms (gigante rossa a 128 px ~75 ms), asteroide ~3 ms, chunk di sfondo 256 px ~38 ms con la nebulosa e ~0,2 ms per uno strato di stelle. Nell'app la nebulosa, statica, va messa in cache; lo scintillio ridisegna solo gli strati di stelle.

**Punti deboli noti**:

- I filamenti di corona sono discreti fino a sembrare poco visibili sotto i 32 px; la granulazione delle stelle piccole è solo un dither sul nucleo.
- F e G, entrambe calde e chiare, si distinguono più per sfumatura che per colore.
- Gli asteroidi ruotano nel piano: a 6–10 px la rotazione fa "saltare" qualche pixel del contorno.
- Le nebulose sono nuvole morbide, senza filamenti né stelle giovani al loro interno; le galassie lontane sono quasi sempre macchie ellittiche.
- Il dither di Bayer dei veli nebulari, in certe zone, forma righe verticali regolari.

## 8. Linee guida visive

- **Risoluzione interna 480×270**, upscale intero. L'upscale è calcolato in pixel del dispositivo (`devicePixelRatio`), così un pixel del gioco è sempre un blocco esatto di pixel dello schermo.
- **Lo zoom non scala mai i pixel.** Lo zoom della camera è continuo, ma a ogni livello gli oggetti vengono generati alla dimensione giusta, a gradini discreti e con cache. Un pixel dell'oggetto è sempre un pixel dello schermo. Chiave di cache: (generatore@versione, ricetta, seed, gradino, frame, luce).
- **La luce di ogni corpo viene dalla sua stella**: 3–4 livelli quantizzati, con dither Bayer ancorato ai pixel dell'oggetto generato (non allo schermo: quando l'oggetto si muove, il dither si muove con lui e non “nuota”).
- **La luce sposta il colore lungo una rampa con hue shift**, non moltiplica l'RGB: le ombre vanno verso toni freddi e saturi, le luci verso toni caldi.
- **Outline con il tono più scuro della rampa del materiale**, non nero.
- **Si genera direttamente alla dimensione finale**, mai grande e poi rimpicciolito.

## 9. Universo

Tutto in `universe/`, logica pura e deterministica che importa solo da `core/`: l'universo decide *che cosa* esiste e dove, i generatori *come appare*. Il modello dati completo (unità, seed, formati, tabelle) è in `docs/plans/step-06.md`.

- **Forma**: una galassia finita su una griglia infinita di settori interi (anche negativi); il centro è nel settore (0, 0). Fuori dal disco la griglia continua, vuota.
- **Gerarchia dei seed**: galassia `G` → forma `derive(G, "shape")` → settore `S = derive(G, "sector", sx, sy)` → sistema `Y = derive(S, "system", i)` → stelle, pianeti `P = derive(Y, "planet", n)`, lune `derive(P, "moon", m)`, fasce, comete → aspetto `derive(P, "look")`, il seed dato al generatore. Nessun livello legge i fratelli: un sistema si genera da galassia, settore e indice, senza generare altro (accesso casuale).
- **Densità** (`Galaxy.sample`): disco esponenziale che si spegne oltre il raggio (180–240 settori), nucleo gaussiano, barra nel 55% delle galassie, 2–4 bracci a spirale logaritmica con un domain warp che li rende irregolari, grumi (fbm), vuoti (rumore a bassa frequenza sotto soglia), ammassi rari anche fuori dal disco (globulari), un alone debolissimo.
- **Settore** (`Galaxy.sector`): numero di sistemi 0–16 (binomiale su 16 celle con media 12 × densità), posizione del sistema i in una cella distinta di una griglia 4 × 4, e **carattere**: età della popolazione (giovane nei bracci, vecchia nel nucleo), quantità e colori delle nebulose, densità delle stelle di sfondo, stile dei nomi. `backgroundRegion` lo traduce nei parametri `region` del generatore `background`. `Galaxy.character(gx, gy)` dà lo stesso carattere in qualsiasi punto, per le mappe.
- **Stelle** (`universe/stars.ts`, dati fisici condivisi con `gen/star`): classe da due popolazioni (giovane e vecchia) pesate con l'età del settore; sottotipo, massa, luminosità, temperatura e raggio dal seed. Binarie 12% (coppia stretta attorno al baricentro, pianeti circumbinari), triple 2% (terza stella lontana, oltre i pianeti).
- **Pianeti**: numero dalla classe della stella; orbite a distanze crescenti (primo semiasse 0,15–0,5 √L UA, poi × 1,5–2,2); archetipo dalla zona (calda, abitabile, fredda, oltre la linea della neve) e dalla stella (meno giganti attorno alle nane rosse, solo mondi morti o craterizzati attorno ai resti); raggio, anelli, rotazione (bloccata per i pianeti caldi delle nane M e K). **Lune** con rotazione sincrona, **fasce** di asteroidi al posto di un'orbita (spesso alla linea della neve), **comete** su orbite eccentriche, le sole che incrociano le altre.
- **Aspetto**: ogni corpo porta `recipe` (archetipo, anelli sì o no, periodo di rotazione, periodo delle nuvole) e `look`; il preset e la variante li sceglie il generatore.
- **Nomi** (`universe/names.ts`): cinque grammatiche di sillabe (liquida, aspra, vocalica, sibilante, composta) assegnate a regioni della galassia con celle di Worley; nome proprio unico nel settore, sigla da catalogo `XX-NNNN` (lettere del settore senza I e O, numeri distinti nel settore); stelle `A`, `B`, `C`, pianeti `b`, `c`… ("KX-4471 b"), lune in numeri romani ("KX-4471 b II"), nome proprio anche per i pianeti della zona abitabile, comete `P/KX-4471-1`. Filtri: nessun nome reale (confronto esatto) e nessuna radice offensiva italiana o inglese (sottostringa senza accenti e maiuscole); un nome scartato si rigenera.
- **Indirizzi** (`universe/address.ts`): `<galassia>[.<sx>.<sy>[.<sistema>[.<corpo>]]]`, galassia, settore e sistema in base 36, corpo `s<k>` stella, `p<n>` pianeta, `p<n>m<k>` luna, `a<k>` fascia, `c<k>` cometa con indici decimali; solo `[0-9a-z.-]`. Esempio: `51u7i0.-c.14.3.p2m1`. `parseAddress` spiega gli errori in italiano, `resolve` verifica che l'oggetto esista. Zoom e tick non fanno parte dell'indirizzo.
- **Versione**: `UNIVERSE_VERSION` (ora 2: allo step 7 è cambiato il periodo delle nuvole nelle ricette) cambia quando lo stesso indirizzo porterebbe a un oggetto diverso; `tests/golden/universe.json` se ne accorge.
- **Censimento** (`universe/census.ts`): sistemi scelti uniformemente tra tutti quelli della galassia e intervalli attesi (classi, molteplicità, archetipi, lune, anelli, fasce, comete); `forge census` li stampa e i test li verificano su 10 000 sistemi.
- **Scale di zoom**:

| Livello | Cosa si vede | Nell'esploratore (§11) | Nelle mappe di forge |
|---|---|---|---|
| Galassia | Struttura a bracci, densità, fenomeni visibili da lontano | catalogo sommato per pixel e bagliore | `galaxyMap` |
| Regione stellare | Stelle di più settori | catalogo punto per punto e bagliore | `regionMap` |
| Sistema | Stella, orbite, pianeti, fasce, comete | geometria schematica, `star`, `planet`, `asteroid`, `background` | `systemView` |
| Corpo celeste | Pianeta con lune e anelli, nuvole, terminatore | `planet` a gradini grandi | |
| Superficie | Mappa di superficie del pianeta | `surface` | |

- **Mappe** (`gen/maps/`): funzioni di disegno, non generatori registrati, perché leggono oggetti dell'universo invece di una ricetta. `galaxyMap` disegna un pixel per settore (colore della stella più luminosa, tono dal numero di sistemi, bagliore della densità con i colori delle nebulose dove i sistemi sono pochi); `regionMap` un blocco per settore con ogni sistema come punto colorato per classe; `systemView` la vista dall'alto di un sistema a un tick, con scala logaritmica delle distanze.
- **Rarità**: i fenomeni rari hanno una distribuzione controllata e devono essere trovabili esplorando. Da progettare allo step 8.

## 10. Tempo

- Il tempo è un **tick intero**: un tick è un'ora di gioco, un anno 8766 tick. L'app fa avanzare il tick di un moltiplicatore per frame (pausa = 0).
- **Lo stato a un tick si calcola direttamente dal tick**, senza simulazione incrementale: posizioni orbitali, rotazioni e nuvole sono funzioni di (seed, tick). Saltare nel tempo costa O(1) e un link con un tick riporta esattamente allo stesso stato.
- Le fasi si calcolano con il modulo intero prima di passare ai float: `phase = (tick % period) / period`. Così la precisione non degrada con tick grandi (fino a 2^53).
- **Orbite su binari** (`universe/orbit.ts`): `Orbit { a, e, omega, period, phase }` con periodo e fase interi in tick; la posizione risolve l'equazione di Keplero con 12 passi di Newton fissi (partenza da π per e ≥ 0,8), tutto con `core/dmath`. Periodo `8766 · a^1.5 / √M` tick attorno alle stelle; le lune `k · a^1.5` tick con `a` in raggi del pianeta (k = 1,4 per i pianeti rocciosi, 3 per i giganti, meno densi).
- **Rotazioni**: `Rotation { period, phase }` in tick; il generatore riceve `period` nella ricetta e `rotationFrame(rotation, tick)` come frame. Dall'universo 2 (step 7) il periodo delle nuvole è il doppio del giorno, quindi superficie e nuvole si ripetono ogni 2 × periodo tick e i frame si possono mettere in cache. Nelle animazioni a passo lungo (`forge system --frames`) le rotazioni avanzano di un frame per fotogramma, altrimenti il campionamento le farebbe saltare.
- **Animazioni decorative** (granuli e corona delle stelle, rotazione degli asteroidi, scintillio): un contatore a 12 fotogrammi al secondo di tempo reale, indipendente dalla velocità della simulazione. Le stelle usano un ciclo che si ripete (96 frame fino a 64 px, meno e più lenti per le grandi), così restano in cache.

## 11. Esploratore

Il piano di dettaglio (camera, scale, cache) è in `docs/plans/step-07.md`. Il codice sta in `view/` (puro) e `app/` (browser).

**Renderer.** Framebuffer indicizzato 480 × 270 (`IndexedBuffer`): mondo, sprite e interfaccia vi finiscono con blit 1:1. La presentazione (`view/present.ts`) converte gli indici in parole RGBA con una tabella di 256 voci e fa un solo `putImageData` per frame: a questa risoluzione la conversione costa circa 0,2 ms, e lo stesso codice gira in Node. Effetti globali di colore (lo scintillio delle stelle di sfondo, cycling sui toni 0–2 di `metal-light`) cambiano la tabella, non i pixel. Il canvas resta 480 × 270; CSS lo ingrandisce del massimo fattore intero in pixel del dispositivo, con `image-rendering: pixelated` e bande nere.

**Un mondo continuo.** Tutto ha una posizione in unità di settore (`GalacticPoint`); i sistemi hanno una **geometria schematica** (`view/geometry.ts`): raggio di disposizione 0,03 settori (i sistemi distano almeno 0,075, quindi non si sovrappongono), orbite sulla scala radiale logaritmica, pianeti larghi al più il 70% dello spazio tra le orbite vicine, lune su orbite circolari fuori da pianeta e anelli. Così lo zoom va dalla galassia a una luna senza cambi di riferimento.

**Camera** (`view/camera.ts`): centro e `z = log2(pixel per settore)`, da −1,6 a 21. I pixel sono **ancorati al mondo** (`floor(p·s) − floor(c·s)`): in un pan tutto si sposta dello stesso numero intero di pixel. Pan con trascinamento, frecce e WASD; zoom con rotella, pinch, `+`/`−` e Q/E, centrato sul cursore. Voli (breadcrumb, doppio clic, ricerca) sul percorso di van Wijk e Nuij (`view/flight.ts`): allontana, sposta, avvicina. Un corpo selezionato viene seguito dove si trova sullo schermo; un pan lo sgancia.

**Livelli**, decisi dalle dimensioni a schermo, non da un interruttore:

| Livello | Scala | Cosa si vede |
|---|---|---|
| Galassia | < 3 px/settore | bagliore della densità con i colori delle nebulose; sistemi sommati per pixel (colore dal più luminoso, tono dal numero) con un **limite di magnitudine** che scende con lo zoom; le giganti rosse non fanno da faro |
| Regione | 3 – 300 | sistemi uno per uno; le stelle deboli compaiono avvicinandosi, poi tutte come croci; binarie come coppie |
| Sistema | 300 – ~60 000 | sistemi vicini dai dati completi: stelle come sprite animati, orbite (dissolvenza a dither tra 40 e 90 px di raggio), pianeti da 8 px in su, fasce, comete; sfondo stellato del settore (generatore `background`) |
| Corpo | pianeta ≥ 20 px | lune e loro orbite, anelli nello sprite |
| Superficie | pianeta ≥ 280 px | mappa `surface` con legenda; oltre i 420 px lo zoom si ferma |

**Bagliore** (`view/haze.ts`): campioni del carattere della galassia su una griglia del mondo, una per ottava di zoom, circa uno ogni 8 px; un punto condiviso da più griglie si calcola una volta. Interpolazione bilineare per pixel e dither Bayer ancorato al mondo: niente da scalare. Budget di campioni per frame (i mancanti si interpolano dalla griglia più grossa) e copia dell'ultimo risultato quando la camera è ferma.

**Gradini e sprite** (`view/steps.ts`, `view/sprites.ts`): ogni sprite è generato al gradino più vicino (circa +20% l'uno dall'altro) e disegnato 1:1 a posizioni continue. Chiave di cache: `generatore@versione | ricetta canonica | seed | gradino | frame | luce`. La luce di ogni corpo viene dal centro del suo sistema, quantizzata a 32 direzioni con elevazione 20°. Cache LRU limitata a 48 MB; gli sprite del frame corrente non si eliminano. Finché uno sprite non c'è si disegna il gradino più vicino già pronto dello stesso oggetto, altrimenti un dischetto del suo colore. Durante lo zoom si chiede anche il gradino successivo, a priorità bassa. I corpi fuori schermo non si generano.

**Worker** (`app/sprites.ts`, `app/worker.ts`): un pool di 1–4 worker genera sprite, bande del catalogo e ricerche; lo stesso oggetto va sempre allo stesso worker (le cache delle mappe servono davvero), al più 3 lavori in volo per worker, e le richieste non più visibili vengono scartate prima di partire. Il main thread non genera mai. Il **catalogo** (posizione, classe e luminosità dei ~145 000 sistemi, `view/catalogue.ts`) arriva a bande di 16 righe di settori, prima quelle vicine alla camera.

**Interfaccia** (`view/ui/`): pannelli 9-slice procedurali (i nove pezzi generati da funzioni, il centro è una tabella di indici che scurisce ciò che sta dietro), icone a 8 e 12 px da primitive, font 3×5 e 5×7. Breadcrumb galassia › settore › sistema › pianeta › luna con clic per risalire; scheda dell'oggetto selezionato (classe, zona, raggio, orbita, anno, giorno, lune...); etichetta al passaggio del mouse; orologio con data, velocità e pausa; ricerca (`/`) per indirizzo, nome o sigla; riga d'aiuto; overlay di debug (F3: fps, tempo di render, sprite e segnaposto, campioni del bagliore, cache, coda, tempi di generazione per generatore). L'URL (`?a=<indirizzo>&z=<zoom>&t=<tick>`) segue la vista e la ripristina all'avvio.

**Tempo** (§10): ×1 = 1 tick al secondo, poi ×10, ×100, ×1000, ×10 000 (tasti 1–5, spazio per la pausa).

**Prestazioni misurate** (Chromium headless su Apple Silicon, 4 worker): un'immersione continua dalla galassia alla superficie con la rotella tiene 60 fps (mediana 16,7 ms, 99° percentile 17,6 ms, massimo 17,8 ms, nessun frame oltre 33 ms); composizione e interfaccia 2–4 ms per frame; un gigante gassoso di 100 px con sei lune a ×1000 resta a 60 fps. Tempi medi di generazione nei worker: pianeti 1–12 ms (fino a ~300 ms al primo 256 px), stelle 5–15 ms, asteroidi 0,5–2 ms, chunk di sfondo ~45 ms, mappe di superficie ~100–190 ms.

## 12. Forge e workflow

`forge/` è la CLI con cui si guarda il lavoro: `npm run forge -- <comando>`, `help <comando>` per tutte le opzioni.

| Comando | Cosa fa |
|---|---|
| `render <gen>` | Un oggetto in PNG (`--seed --size --frame --light --elev --recipe --scale --grid --bg -o`); stampa il descrittore |
| `sheet <gen>` | Griglia di varianti di seed consecutivi (`--count 64 --from --cols 8`) con il seed sotto ogni cella; `12r2` = scelto al tentativo 2, `12!` = nessun tentativo valido |
| `params <gen>` | Un parametro della ricetta nelle colonne (`--param a.b --values 1,2,3`), i seed nelle righe (`--seeds 0..7`) |
| `sizes <gen>` | Lo stesso oggetto a più dimensioni affiancate (`--sizes 16,32,64,128,256`), per la coerenza tra gradini |
| `chunks <gen>` | Griglia di chunk accostati senza spazi (`--x 0..2 --y 0..2`), per controllare le cuciture degli sfondi |
| `scene <scena.json>` | Sfondo e oggetti composti da un file JSON (esempio: `recipes/scenes/step5.json`), con la luce di ogni oggetto che viene dal sole della scena |
| `galaxy` | Mappa della galassia intera, un pixel per settore (`--galaxy n`), o di una regione ingrandita (`--center sx,sy --radius 12 --cell 12`) |
| `system <indirizzo>` | Vista di un sistema al tick dato (`--tick`, `--size 384`) e descrizione di tutti i corpi; con `--frames n` (e `--step t`, default un giro del pianeta più interno) una GIF con il tempo che scorre |
| `systems` | Foglio di viste di sistemi scelti a caso tra quelli della galassia (`--count 16 --seed`), con gli indirizzi |
| `census` | Statistiche su molti sistemi (`--count 10000`) confrontate con gli intervalli attesi; esce con errore se qualcuna è fuori |
| `view <indirizzo>` | Una vista dell'esploratore resa in Node con lo stesso renderer dell'app (`--zoom` numero o livello, `--tick`); con `--frames` una GIF (zoom fino a `--zoom-to`, tempo con `--step`, `--transition cut\|dither`, `--strip`); stampa il tempo per frame e i tempi di generazione per generatore |
| `anim <gen>` | GIF in loop (`--frames`, default un giro del generatore, `--fps 24`); `--strip` scrive anche la striscia dei frame in PNG |
| `lint <gen>` | Esegue i validatori su molti seed (`--count 256`): quanti passano al primo tentativo, quanti dopo i ritentativi, quanti mai, e perché |
| `golden check\|update [gen]` | Confronta con `tests/golden/<gen>.json`, o lo riscrive consapevolmente |
| `list` | Generatori con versione, lati, validatori e parametri della ricetta |
| `swatches` | Foglio della palette e foglio di shading (§6) |
| `zoom <png>` | Ritaglia e ingrandisce una zona di un PNG qualsiasi |

- **Uscite sempre in `out/`** (la CLI rifiuta altri percorsi), a scala intera senza interpolazione; `--bg` mette lo sfondo spazio al posto della trasparenza; `--grid` disegna la griglia dei pixel.
- **Le GIF usano direttamente la palette** (nessuna quantizzazione): indice 0 trasparente, frame cancellati tra uno e l'altro (niente scie). Il ritardo delle GIF è in centesimi di secondo, quindi 24 fps diventano 25.
- **Golden dei generatori**: per ogni caso fissato in `goldens`, l'impronta dei pixel, il descrittore e il seed accettato, in `tests/golden/<gen>.json` con l'id versionato. `golden check` distingue un cambio di versione (il file è di un'altra versione) da un cambio di output a versione invariata; `npm test` esegue lo stesso controllo.
- **Stessi byte ovunque**: lo stesso comando produce file identici byte per byte, anche tra processo reale (tsx) e test (Vitest).
- `runCli` (`forge/run.ts`) esegue una riga di comando nello stesso processo: i test la usano end to end.

Fuori dalla CLI: `npm run bench` (benchmark del core, §5.4) e `npm run palette` (rigenera la palette, §6.1).

**Ciclo di lavoro visivo** (dettagli e comando per ogni verifica in `CLAUDE.md`, "Come guardare il tuo lavoro"): modifica il generatore → foglio di varianti e animazione → apri i PNG e guardali davvero → descrivi cosa vedi → correggi → ripeti. La qualità si giudica sulla distribuzione (fogli di 64 seed), non su un seed fortunato.

**Fine di ogni step**: `npm run check` verde (typecheck, lint, test); fogli di preview aggiornati in `out/`; questo documento aggiornato se sono cambiate decisioni; un commit. Poi ci si ferma e si riassume, senza iniziare lo step successivo.

## 13. Stack e tooling

- **TypeScript 6.0 strict**, Node ≥ 20.19, npm, un solo package, ESM.
- **Vitest 4** per i test (`*.test.ts` accanto al codice), **tsx** per la CLI, **Vite 8** per l'app (`root: app`, build in `dist/`).
- **ESLint 10 + typescript-eslint** con le restrizioni di determinismo e di dipendenza tra moduli.
- **tsconfig per ambiente**, orchestrati da `tsc -b` tramite `tsconfig.json`:
  - `tsconfig.pure.json`: `core/`, `toolkit/`, `gen/`, `universe/`, `view/`; solo `lib: ES2023`, nessun tipo DOM o Node;
  - `tsconfig.tools.json`: `forge/` e i file di configurazione; tipi Node;
  - `tsconfig.app.json`: `app/`; DOM e `vite/client`.
- **Dipendenze esterne solo in `forge/` e `app/`**: `pngjs` (dallo step 2) e `gifenc` (dallo step 3) in `forge/`. `app/` non importa nulla da `forge/` e non ha dipendenze npm.
- **Verifica nel browser** (step 7): Chromium headless guidato da Playwright, presi dalla cache locale di npx e non installati nel progetto; l'app espone `window.explorer` e `window.pool` per i controlli automatici, e `?debug` apre l'overlay F3.

## 14. Roadmap

| Step | Contenuto | Stato |
|---|---|---|
| 0 | Setup del repo, tooling, lint di determinismo, documenti di riferimento | fatto |
| 1 | **Core deterministico**: hash e `derive`, `Rng`, `dmath` (trigonometria, `exp`, `log`, `pow`… solo con `+ - * /` e `sqrt`), rumore da hash di reticolo (value, gradient, fbm, domain warp, Worley), buffer indicizzati, impronte e golden del core | fatto |
| 2 | **Stile, palette e toolkit**: palette master generata a rampe con hue shift; luce quantizzata, dither Bayer, shading, outline selettivo, pulizia, tabelle di swap/cycling/luce, RGBA, font 3×5 | fatto |
| 3 | **Forge CLI**: registro dei generatori, schema delle ricette, ritentativi, generatore di prova; render, sheet, params, anim, lint, golden, list, swatches, zoom | fatto |
| 4 | **Pianeti**: 9 archetipi con preset, mappe di superficie e nuvole, rotazione, terminatore, atmosfera, anelli, livello di dettaglio, descrittore, validatori; `forge sizes` | fatto |
| 5 | **Stelle, asteroidi e sfondi**: 10 classi spettrali, 4 materiali di asteroide, sfondo a chunk con parallasse, nebulose e galassie; `forge chunks` e `forge scene` | fatto |
| 6 | **Universo**: galassia con bracci, nucleo, vuoti e ammassi; settori e carattere; sistemi con stelle multiple, pianeti per zona, lune, anelli, fasce, comete; orbite su binari; nomi e sigle; indirizzi; mappe e `forge galaxy`, `system`, `systems`, `census` | fatto |
| 7 | **Esploratore**: framebuffer indicizzato, mondo continuo con geometria schematica, cinque livelli di scala, sprite a gradini con cache e worker, bagliore interpolato, voli, tempo, interfaccia disegnata a codice (font 3×5 e 5×7, pannelli, icone, scheda, breadcrumb, ricerca, URL, debug), mappa di superficie; generazione dei pianeti 2–5 volte più rapida; `forge view` | fatto |
| 8 | **Fenomeni rari e megastrutture**: buchi neri, pulsar, rovine, megastrutture | |
| 9 | **Catalogo e scoperte**: catalogo personale, link agli indirizzi | |

## 15. Decisioni

Formato: data, step, decisione e motivo. Le voci non si cancellano: se una decisione cambia, se ne aggiunge una nuova che la sostituisce.

- **2026-09-26, step 0: lingua.** Documenti e testi della CLI in italiano; codice, identificatori, commenti nel codice e nomi dei seed derivati in inglese (`derive(seed, "clouds")`).
- **2026-09-26, step 0: TypeScript 6.0 invece di 7.** typescript-eslint supporta solo TypeScript < 6.1. Da rivalutare quando supporterà TS 7.
- **2026-09-26, step 0: Vitest 4 invece di 5.** Vitest 5 richiede Node ≥ 22.12, mentre lo stack prevede Node 20+. Il minimo effettivo è Node 20.19 (richiesto da Vite 8 ed ESLint 10). Node 20 è fuori supporto da aprile 2026: se si alza il minimo a 22, si può passare a Vitest 5.
- **2026-09-26, step 0: tsconfig separati per ambiente.** I moduli puri sono compilati senza tipi DOM e Node, così usarli è un errore di tipo oltre che di lint.
- **2026-09-26, step 0: lint di determinismo più ampio della lista minima.** Oltre alle funzioni elencate nella regola 5 sono vietate anche le varianti iperboliche e logaritmiche di `Math`, gli operatori `**` e `**=`, `for...in`, `Intl` e i metodi dipendenti dalla locale, `globalThis`, `crypto`, timer, DOM e Node.
- **2026-09-26, step 0: dipendenze tra moduli imposte dal lint.** `core` ← `toolkit` ← `gen`, `core` ← `universe`; `universe` non importa da `toolkit` né da `gen`; `app` non importa da `forge`. `gen` può importare da `universe`.
- **2026-09-26, step 0: `noUncheckedIndexedAccess` disattivato.** I generatori leggono typed array in cicli stretti, e il flag trasformerebbe ogni `buf[i]` in `number | undefined`.
- **2026-09-26, step 0: test accanto al codice.** `*.test.ts` nello stesso modulo, soggetti alle stesse regole di lint e typecheck del modulo.
- **2026-09-26, step 0: stato dal tick.** Orbite, rotazioni e nuvole sono funzioni dirette di (seed, tick), senza simulazione incrementale (vedi §10).
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
- **2026-09-26, step 2: SDF e rasterizzazione rinviate di nuovo, allo step 4.** Nemmeno la richiesta dello step 2 le comprendeva; le forme della preview (sfera, rettangolo smussato) sono calcolate nello script. Arriveranno con il primo generatore che le usa.
- **2026-09-26, step 2: palette master unica con colori condivisi.** Le 23 rampe richieste da 4–6 toni sono 100 toni, contro un limite di 63 colori: l'unico modo di rispettare entrambi i vincoli è che le rampe condividano colori, come nelle palette pixel art classiche. Il builder li unisce automaticamente con i vincoli del §6.1, tarati guardando le preview. Senza il tono chiave proprio alcune rampe (`metal-ancient`, `ui-cool`) finivano fatte solo di colori altrui; senza i limiti di tinta e croma `vegetation` prendeva un beige e `gas-warm` una banda grigia.
- **2026-09-26, step 2: palette generata in OKLCH da parametri.** `style/ramps.json` è la fonte, `style/palette.json` il risultato committato; il builder usa `core/dmath`, quindi rigenera gli stessi byte su ogni macchina. Per OKLab `core/dmath` guadagna `cbrt`.
- **2026-09-26, step 2: cristalli a 4 toni.** Con tutte le rampe a 5 toni la palette non entrava nei vincoli; i cristalli sono oggetti piccoli e 4 toni bastano.
- **2026-09-26, step 2: rampa di casa e parentela.** Con i colori condivisi un indice non identifica una sola rampa: le tabelle e l'outline esterno usano la prima rampa che lo elenca; l'outline interno usa `related`, così i colori condivisi non creano false linee dentro un materiale.
- **2026-09-26, step 2: bande di luce di uguale ampiezza, ombra piena.** Il lato illuminato divide n·l in parti uguali tra i livelli; il lato in ombra è un livello costante (`ambient`) e non viene mai sfumato.
- **2026-09-26, step 2: dither solo sulle sfumature continue.** Dalle preview: con il dither ovunque le facce piatte vicine a un confine tra livelli prendevano una trama uniforme, e gli spigoli una fila di puntini. Ora le normali usano un limitatore minmod e il dither si applica solo dove la luce è monotona per 2 pixel per lato; la fascia sfumata di default è 0.3 livelli attorno a ogni confine.
- **2026-09-26, step 2: il tono più scuro è dell'outline.** Di default `shade` usa i toni 1..n-1 per la luce e lascia il tono 0 all'outline, così il bordo si vede anche sul lato in ombra.
- **2026-09-26, step 2: outline ortogonale e selettivo.** Di default l'outline esterno segue i 4 vicini (angoli più morbidi, diagonali già pixel-perfect); dove si toccano più materiali vince il più scuro; la linea interna va sul lato più chiaro. L'outline non allarga il buffer.
- **2026-09-26, step 2: pulizia prima dello shading.** `removeOrphans` cancellerebbe il dither sparso, che è fatto di pixel isolati: si usa sulle mappe dei materiali. `fixCorners` toglie solo gli angoli dei gradini da 1 px; gli angoli veri (bracci di almeno 2 px) restano.
- **2026-09-26, step 2: font come stringhe di bit.** Ogni glifo è scritto come cinque righe di tre bit (`'010 101 111 101 101'`), leggibili e modificabili; M e N sono state ridisegnate dopo averle viste confondersi nella preview.
- **2026-09-26, step 2: preview temporanee in forge.** `forge/step2-preview.ts` e `forge/crop.ts` servono finché la CLI dello step 3 non le sostituisce; `forge/png.ts` resta.
- **2026-09-26, step 3: schema delle ricette scritto in casa.** Niente zod: la validazione serve anche all'app e i moduli puri non hanno dipendenze. Lo schema copre ciò che serve (numeri con intervallo, interi, booleani, scelte, oggetti annidati) ed elenca tutti gli errori insieme, ordinati, con suggerimenti per i refusi.
- **2026-09-26, step 3: registro esplicito.** I generatori sono elencati in `gen/index.ts` invece di registrarsi con un effetto collaterale all'import: niente stato globale nei moduli puri, ordine sempre lo stesso.
- **2026-09-26, step 3: validazione sulla resa canonica.** Se i validatori guardassero la resa richiesta, un oggetto potrebbe cambiare seed (e aspetto) tra un gradino di zoom e l'altro o tra due frame. Validando sempre lato di default, frame 0 e luce di default, la scelta del tentativo dipende solo da ricetta e seed. Il costo è una resa in più quando le opzioni differiscono; l'app dovrà mettere in cache la scelta.
- **2026-09-26, step 3: luce come versore, `--light` come azimut.** `opts.lightDir` è un versore; la CLI lo costruisce da azimut (0 = dall'alto, senso orario, default 315) ed elevazione (default 40°) con `lightFromAngle` in `toolkit/light.ts`.
- **2026-09-26, step 3: golden dei generatori come impronte più descrittori.** Niente PNG di riferimento: i PNG si rigenerano in `out/` quando servono. Il file contiene anche il descrittore e il seed accettato, così un cambio nei validatori o nei dati derivati si vede anche a pixel invariati.
- **2026-09-26, step 3: GIF con gifenc caricato come CommonJS.** gifenc ha build diverse per Node e per i bundler; `forge/` lo carica sempre con `createRequire`, così tsx e Vitest eseguono lo stesso codice e scrivono gli stessi byte.
- **2026-09-26, step 3: testi della CLI in italiano.** Riepiloghi, opzioni, messaggi ed errori delle ricette sono in italiano, come stabilito allo step 0; gli errori interni per chi scrive un generatore restano in inglese come il codice.
- **2026-09-26, step 3: etichette del foglio attive di default.** `sheet` scrive sempre il seed sotto le celle; `--labels` è accettato, `--no-labels` le toglie. Il foglio senza etichette è raramente utile.
- **2026-09-26, step 3: `swatches` e `zoom` al posto degli script dello step 2.** Il foglio della palette e quello di shading ora si rigenerano con `forge swatches`; `forge zoom` ritaglia e ingrandisce qualsiasi PNG. Il font 3×5 guadagna `@` per gli id dei generatori.
- **2026-09-26, step 4: SDF e rasterizzazione rinviate ancora.** Disco e anelli dei pianeti si calcolano analiticamente per pixel; un modulo SDF senza un utilizzatore reale sarebbe speculativo. Arriverà con il primo generatore di forme irregolari (asteroidi, megastrutture).
- **2026-09-26, step 4: `size` è la dimensione dell'oggetto, il buffer può essere più grande.** Per un pianeta `size` è il diametro, così la scala resta la stessa con o senza anelli; il descrittore riporta il centro nel buffer.
- **2026-09-26, step 4: una ricetta per tutti gli archetipi, preset come sovrapposizioni.** I preset sono ricette parziali in `recipes/planets/`; il nuovo hook `resolve` del registro sceglie archetipo e variante dal seed richiesto, così un ritentativo non trasforma un deserto in un gigante gassoso.
- **2026-09-26, step 4: normalizzazione e soglie sulla sfera, non sulla mappa.** Minimo, massimo e quantili si misurano su punti di Fibonacci con tutte le ottave: coste e coperture restano le stesse a ogni diametro, e le ottave tolte ai piccoli diametri non spostano nulla.
- **2026-09-26, step 4: lato notte buio con la rampa d'ombra.** Dalle prime preview: il tono 1 di nuvole e ghiaccio è un grigio chiaro, quindi la notte sembrava illuminata. Ora il lato in ombra prende i toni scuri di `space` (un po' meno scuri per nuvole e calotte), e si decide sulla sfera liscia: il rilievo aveva sparso pixel chiari oltre il terminatore.
- **2026-09-26, step 4: luce di default per generatore.** I pianeti usano azimut 290° ed elevazione 25°: con 40° il terminatore quasi non si vedeva, con 12° metà disco era buia e la superficie si leggeva poco.
- **2026-09-26, step 4: filtro di maggioranza in spazio mappa.** Compatta le regioni e liscia le coste senza sfarfallare durante la rotazione; non si applica alla mappa del descrittore, dove eroderebbe i crateri (il validatore scartava il 90% delle lune).
- **2026-09-26, step 4: outline con tetto di luminosità.** Il tono più scuro delle rampe chiare (nuvole, ghiaccio) lasciava pixel grigi sul contorno.
- **2026-09-26, step 4: magma a due livelli di emissione, tossico senza emissione.** Magma profondo più luminoso del liquido basso (nuclei gialli, bordi rossi); il mare acido emissivo di livello 1 finiva sul verde chiaro e di notte sembrava illuminato.
- **2026-09-26, step 4: periodo delle nuvole 48.** Con 64 la GIF da 96 frame saltava al ritorno; un divisore del giro della superficie tiene il loop.
- **2026-09-26, step 4: cache delle mappe nel generatore.** Otto voci, chiave = seed, ricetta, risoluzione e livello di dettaglio. Stato nel modulo che non cambia l'output: un'animazione da 96 frame costa una generazione di mappe invece di 96.
- **2026-09-26, step 4: mappe del descrittore compatte nei golden.** Il descrittore porta la mappa 64 × 32 come stringhe (un simbolo per cella); nei golden le stringhe lunghe diventano la loro impronta, così i file restano leggibili (8 KB per 7 casi).
- **2026-09-26, step 4: comando `forge sizes`.** Serve a `out/step4-sizes.png` e in generale alla verifica di coerenza tra gradini di zoom.
- **2026-09-26, step 5: stelle con rampe esistenti.** La palette resta a 63 colori: ogni classe usa un intervallo di toni di una rampa già presente (K e M condividono `magma`). A 16 px le dieci classi si distinguono per colore, dimensione e forma dell'alone; non è servito alzare il limite.
- **2026-09-26, step 5: la superficie di una stella continua nell'alone.** Dalle preview: con il bordo più scuro dell'alone interno la stella era una "cipolla" di anelli e non sembrava luminosa. Ora il tono più interno della corona coincide con quello del bordo del disco.
- **2026-09-26, step 5: palette cycling sui filamenti, non sul gradiente.** Ruotare i toni di un gradiente radiale lo capovolge a ogni giro. Il cycling funziona dove i toni si ripetono in sequenza nello spazio: i filamenti di corona per le stelle, stelle che partono da toni diversi per lo scintillio.
- **2026-09-26, step 5: granulazione come celle che pulsano.** Il rumore 3D non ha una dimensione libera per un tempo ciclico; celle di Worley con una fase propria che segue `sin` danno l'effetto "ribollire" e un loop esatto.
- **2026-09-26, step 5: asteroidi che ruotano nel piano.** Come chiesto: silhouette polare e altezze nel riferimento dell'oggetto, girate con il frame. Più semplice di un corpo 3D irregolare con ray marching, e coerente con la luce fissa della stella.
- **2026-09-26, step 5: sfondo in coordinate globali.** Le cuciture non vanno nascoste ma evitate: ogni elemento dipende solo dalla sua posizione globale (celle, rumore, dither), e gli elementi vicini ai bordi si disegnano da tutti i chunk che toccano.
- **2026-09-26, step 5: nebulose scure.** Le prime avevano toni pieni di `gas-violet` e un blu saturo che competevano con i pianeti; ora sono un velo neutro con toni di colore solo nei nuclei.
- **2026-09-26, step 5: SDF e rasterizzazione non servono ancora.** Anche le silhouette degli asteroidi si calcolano per pixel in coordinate polari; resta da valutare per le megastrutture (step 8).
- **2026-09-26, step 5: `forge chunks` e `forge scene`.** Il primo serve per le cuciture, il secondo compone sfondo e oggetti a 480×270 con la luce che viene dal sole della scena: una prima versione di ciò che farà `forge view` allo step 7.
- **2026-09-26, step 5: timeout dei test a 30 s.** Golden e test end to end rendono tutti i generatori; in parallelo, con cinque generatori, superavano i 5 s di default di Vitest.
- **2026-09-27, step 6: una galassia finita su una griglia infinita.** Risolve la questione aperta sulla forma dell'universo: la densità si spegne oltre il disco, la griglia di settori continua vuota (e ogni settore resta generabile). Una sola galassia per seed; più galassie sarebbero un livello sopra, senza cambiare gli indirizzi dei settori.
- **2026-09-27, step 6: numero di sistemi binomiale.** Su 16 celle con probabilità dalla densità: limitato a 16 senza tagli, media proporzionale alla densità, e ogni sistema ha una cella distinta della griglia 4 × 4 (nessuna sovrapposizione sulle mappe).
- **2026-09-27, step 6: carattere continuo.** Dalla prima mappa di regione: il colore delle nebulose deciso per settore faceva gradini. `Galaxy.character` è definito in ogni punto e le mappe sfumano con il dither anche i confini tra rampe.
- **2026-09-27, step 6: bagliore sotto le stelle.** Con un pixel colorato per ogni settore abitato la galassia intera era un rumore arancione. Ora i settori con pochi sistemi e senza stelle luminose mostrano il bagliore della densità con i colori della regione (nucleo caldo, nebulose nei bracci): i bracci si leggono, il nucleo con la barra spicca, gli ammassi globulari sono punti isolati.
- **2026-09-27, step 6: indici dei corpi in decimale.** Il test di round-trip ha trovato l'ambiguità di `p2m1` in base 36 (`m` è una cifra); galassia, settore e sistema restano in base 36, i corpi usano indici decimali.
- **2026-09-27, step 6: fasce al posto di un'orbita.** Una fascia occupa uno slot della sequenza di orbite (0,9–1,1 volte il semiasse), con probabilità più alta al primo slot oltre la linea della neve: rispetta per costruzione lo stesso margine dei pianeti. Le fasce "negli spazi larghi" del piano erano sempre troppo sottili, perché il rapporto tra orbite è al massimo 2,2.
- **2026-09-27, step 6: pesi delle classi tarati sul censimento.** I primi pesi davano A 5,6% e B+O 3,4%, perché la popolazione giovane è più diffusa del previsto; ora ogni valore sta nell'intervallo atteso su sette galassie diverse, con margine. Il primo semiasse è passato da 0,1–0,35 a 0,15–0,5 √L: con il valore del piano il 56% dei pianeti era nella zona calda.
- **2026-09-27, step 6: periodi delle lune dalla densità.** `4 · a^1.5` del piano dava alla Luna 77 giorni; con 1,4 per i rocciosi e 3 per i giganti (meno densi) Luna e Io tornano ai periodi reali.
- **2026-09-27, step 6: mappe in `gen/maps/`, non nel registro.** Sono grafica, quindi stanno in `gen/`, ma leggono oggetti dell'universo e non una ricetta; come funzioni semplici le potrà usare anche l'app allo step 7. Le stelle, i pianeti e gli asteroidi dentro le mappe passano dal registro, con la luce che viene dal centro del sistema.
- **2026-09-27, step 6: scala logaritmica nella vista di sistema.** Le orbite, con rapporti costanti tra semiassi, diventano quasi equidistanti; le ellissi si disegnano campionando l'orbita vera e scalando ogni punto lungo il raggio. La coppia stretta si disegna a distanza esagerata attorno al centro, la terza stella al bordo nella sua direzione vera.
- **2026-09-27, step 6: golden dell'universo.** `tests/golden/universe.json` fissa forma di due galassie, alcuni settori e 12 sistemi (riassunto leggibile più impronta del JSON completo): un indirizzo non deve cambiare destinazione senza alzare `UNIVERSE_VERSION`.
- **2026-09-27, step 6: stampa del censimento nei test della CLI.** I test dei moduli puri non hanno `console` (tsconfig senza tipi): il test di `universe/` verifica gli intervalli, quello di `forge census` su 10 000 sistemi stampa la tabella.

- **2026-09-27, step 7: un modulo puro `view/`.** Camera, mondo, cache, composizione e interfaccia non dipendono dal browser: `app/` aggiunge solo canvas, input, orologio reale, URL e worker. Così `forge view` usa lo stesso renderer dell'app e le viste sono testabili in Node (golden `tests/golden/view.json`).
- **2026-09-27, step 7: `putImageData`, non WebGL.** A 480 × 270 la conversione indice → RGBA con una tabella costa circa 0,2 ms; WebGL la sposterebbe sulla GPU al prezzo di shader, texture, perdita del contesto e un percorso diverso da Node. Gli effetti globali di colore restano gratuiti perché cambiano la tabella.
- **2026-09-27, step 7: un mondo continuo con geometria schematica.** Le distanze vere vanno da 10⁻⁵ UA a 10¹⁰ UA: nessuna scala le mostra insieme. Invece di cambiare sistema di riferimento a ogni livello, ogni sistema ha una disposizione in 0,03 settori (orbite logaritmiche, dimensioni leggibili): lo zoom è una sola trasformazione continua dalla galassia alla luna, e voli, selezione e URL funzionano uguali a ogni livello.
- **2026-09-27, step 7: pixel ancorati al mondo.** Le posizioni sono `floor(p·s) − floor(c·s)`: con un arrotondamento per oggetto, oggetti vicini tremavano di un pixel l'uno rispetto all'altro durante i pan.
- **2026-09-27, step 7: nessuno sfondo scalato.** Il bagliore della galassia non è un'immagine a gradini: con piastrelle generate a un gradino e disposte alla scala vera, tra le piastrelle si aprivano fessure fino al 20% della loro larghezza. Campioni del mondo interpolati per pixel seguono lo zoom senza salti.
- **2026-09-27, step 7: cambio secco tra gradini.** Confrontate su fotogrammi consecutivi (`out/step7-transition.png`, GIF `step7-transition-cut` e `-dither`): la dissolvenza a dither intreccia per 6 fotogrammi due immagini i cui dettagli non combaciano (dimensioni diverse del 20%) e produce un rumore "sale e pepe" più visibile di un solo salto netto. Default `cut`; la dissolvenza resta attivabile con il tasto T (e `--transition dither`).
- **2026-09-27, step 7: validazione senza rasterizzare.** I validatori leggevano già solo il descrittore; con `describe` il registro sceglie il tentativo dalla mappa del descrittore (32 righe) invece di disegnare il pianeta a 64 px. Stesso tentativo (lo verifica un test che forza i ritentativi), costo da 40–100 ms a 4–24 ms.
- **2026-09-27, step 7: `planet@2`, mappe a potenze di 2.** Le righe della mappa sono la potenza di 2 pari o superiore al diametro, invece di 1,6 × diametro: meno celle e una mappa condivisa da circa 4 gradini, frame e luci. Confrontati i fogli `sizes` prima e dopo: nessuna differenza visibile. Lato minimo da 16 a 8 px per i pianeti lontani dentro un sistema.
- **2026-09-27, step 7: generatore `surface` gemello di `planet`.** La mappa di superficie avrebbe potuto essere quella 64 × 32 del descrittore ingrandita, ma sarebbe stato uno zoom di pixel. Un generatore con la stessa ricetta, gli stessi validatori e lo stesso `describe` sceglie lo stesso tentativo e rende la mappa a pixel alla sua dimensione, con rilievo ombreggiato.
- **2026-09-27, step 7: universo 2, nuvole a due giorni.** Con il periodo delle nuvole a 0,8 giorni il ciclo di superficie e nuvole era il minimo comune multiplo dei due periodi, spesso centinaia di frame; con due giorni i frame si ripetono ogni 2 × periodo e restano in cache.
- **2026-09-27, step 7: stelle con cicli brevi.** Con un frame d'animazione nuovo a ogni tick decorativo, un'immersione generava 500 sprite di stelle (fino a 300 KB e 100 ms l'uno a 256 px) e riempiva la cache; ora il ciclo si ripete (96 frame fino a 64 px, 24 più lenti oltre 128) e ne bastano 140.
- **2026-09-27, step 7: pianeti almeno di 8 px al livello sistema.** Con le dimensioni della geometria i pianeti rocciosi erano punti di 1–3 px proprio quando il sistema riempie lo schermo; quando il raggio del sistema supera 70 px i pianeti sono sprite di almeno 8 px, come le stelle hanno un lato minimo.
- **2026-09-27, step 7: culling prima di generare.** Stelle, pianeti, lune e comete fuori dallo schermo (alone e lune compresi) non si disegnano e non si chiedono: in una vista ravvicinata si generavano a 256 px anche i pianeti vicini invisibili (38 sprite invece di 7).
- **2026-09-27, step 7: bagliore senza allocazioni per pixel.** La prima versione creava una closure e un array per pixel e costava 45–55 ms per frame; con interpolazione in linea, indice di rampa numerico, soglie Bayer precalcolate e uscita anticipata costa 1–5 ms, e con la camera ferma si copia l'ultimo risultato.
- **2026-09-27, step 7: limite di magnitudine.** Nella galassia e nelle regioni lontane i sistemi deboli (nane rosse) non si disegnano finché lo zoom non li separa: senza, i bracci attorno a 2–4 px per settore erano un tappeto di pixel rossi.
- **2026-09-27, step 7: l'inseguimento tiene il corpo dove sta.** Selezionare un pianeta lo riportava al centro con un salto (e il doppio clic successivo mancava il bersaglio); ora la camera lo segue mantenendo il suo scostamento sullo schermo, e lo zoom avviene attorno al corpo.
- **2026-09-27, step 7: font esteso e 5×7 disegnati a mano, accenti da codice.** Come il 3×5, i glifi sono bit scritti a mano (l'unica eccezione al principio); le lettere accentate sono la lettera base più un segno generato. `á` non c'è nel 3×5: sarebbe identica a `d`.
- **2026-09-27, step 7: ricerca per nome nei worker, per anelli di settori.** I nomi non stanno nel catalogo (calcolarli per 145 000 sistemi costa secondi): la ricerca li calcola settore per settore a partire dalla camera e restituisce i 10 più vicini. Cerca nomi e sigle dei sistemi, non ancora i nomi propri dei pianeti.

## 16. Questioni aperte

- **Spazio nella palette**: la palette è piena (63 su 63). Le stelle sono entrate riusando intervalli di toni; i fenomeni dello step 8 (buchi neri, pulsar) e le megastrutture potrebbero richiedere rampe nuove, quindi più condivisione o un limite più alto. Step 8.
- **Determinismo verificato anche nel browser**: lo stesso renderer gira in Node e nel browser e i test confrontano le viste in Node (`tests/golden/view.json`); manca un confronto automatico delle impronte calcolate dentro Chromium. Step 8 o 9.
- **Rotazioni a velocità alte**: a ×1000 un pianeta con un giorno di 10 ore fa decine di giri al secondo e la rotazione "sfarfalla" per campionamento. È fisicamente giusto, ma forse la rotazione visibile andrebbe limitata a qualche frame per fotogramma. Da provare con l'uso.
- **Pinch su schermi touch**: implementato (due puntatori, rapporto delle distanze → zoom) ma non ancora provato, né su un dispositivo né in simulazione.
- **Ricerca dei pianeti per nome proprio**: richiede di generare i sistemi; si potrebbe tenere un indice dei nomi propri costruito in un worker. Step 9 (catalogo).
- **Persistenza del catalogo**: storage del browser, export, entrambi. Step 9.
- **Illuminazione dalla stella**: nell'esploratore la luce viene dal centro del sistema, solo come direzione (32 direzioni). `intensity` e colore della stella non cambiano ancora l'aspetto dei pianeti; con la cache per luce, un livello di ambiente per stella moltiplicherebbe gli sprite solo per sistema. Step 8.

Risolte (vedi Decisioni): allo step 1 dimensione dei seed, `derive` a più componenti, indice 0 trasparente; allo step 2 palette unica globale, numero di rampe e di toni; allo step 3 formato dei golden dei generatori; allo step 6 forma dell'universo e formato degli indirizzi; allo step 7 cache nell'app, descrittore senza rasterizzare, costo dei pianeti ai gradini piccoli, gradini di dimensione (circa +20%, cache LRU da 48 MB) e prestazioni nel browser (misurate: 60 fps).
