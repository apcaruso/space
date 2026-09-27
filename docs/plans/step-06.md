# Step 6: modello dati dell'universo

Piano scritto prima del codice. Tutto vive in `universe/` come logica pura e deterministica (solo `core/`); la grafica resta in `gen/`, e chi unisce le due cose è `forge/` (poi `app/`).

## 1. Unità

| Grandezza | Unità | Note |
|---|---|---|
| Posizione nella galassia | settore | griglia di interi; il centro della galassia è nel settore (0, 0) |
| Distanze in un sistema | UA (unità astronomica) | orbite di stelle compagne, pianeti, fasce, comete |
| Distanze attorno a un pianeta | raggi del pianeta | orbite delle lune, anelli |
| Tempo | tick = 1 ora di gioco | intero; un anno = 8766 tick |
| Massa delle stelle | masse solari | |
| Luminosità | luminosità solari | |
| Raggio dei pianeti | raggi terrestri | |

Il tick orario rende leggibili i moti a velocità 1×: una luna fa un giro in qualche giorno (decine o centinaia di tick), un pianeta interno in qualche settimana, uno esterno in anni. L'app sceglie quanti tick far passare per frame.

## 2. Coordinate

```ts
interface SectorCoord { sx: number; sy: number }          // interi (int32), anche negativi
interface GalacticPoint { sx: number; sy: number; x: number; y: number } // x, y in [0, 1): offset nel settore
```

- Un punto della galassia è **settore intero più offset locale** in float. L'offset resta sempre in [0, 1): `normalize` riporta dentro il settore i punti che escono, spostando il settore.
- **Conversioni**:
  - `toGlobal(p) = (sx + x, sy + y)` in unità di settore. Serve solo per disegnare la galassia (mappe, scale larghe): la galassia sta entro ~±300 settori, dove un double ha più di 40 bit di parte frazionaria.
  - `fromGlobal(gx, gy) = { sx: floor(gx), sy: floor(gy), x: gx - sx, y: gy - sy }`.
  - `delta(a, b) = ((b.sx - a.sx) + (b.x - a.x), (b.sy - a.sy) + (b.y - a.y))`: la differenza tra interi si fa prima, così la precisione dipende dalla distanza tra i due punti e non dalla loro distanza dall'origine. È la conversione da usare per la camera.
- Dentro un sistema: coordinate in UA rispetto al baricentro del sistema, asse x a destra e asse y in basso come lo schermo. Le posizioni vengono dalle orbite (§6).
- Attorno a un pianeta: coordinate in raggi del pianeta, rispetto al suo centro.

## 3. Gerarchia e seed

Ogni livello deriva il proprio seed da quello del livello sopra, con un nome (regola 3). Nessun livello legge i fratelli: generare un sistema richiede solo il seed della galassia, le coordinate del settore e l'indice.

```
galassia G
├─ forma           derive(G, "shape")                   bracci, nucleo, barra, raggio
├─ settore         S = derive(G, "sector", sx, sy)      numero di sistemi, carattere, stile dei nomi
│  └─ sistema      Y = derive(S, "system", i)           posizione nel settore, stelle, pianeti...
│     ├─ stella    derive(Y, "star", k)
│     ├─ pianeta   P = derive(Y, "planet", n)
│     │  ├─ luna   derive(P, "moon", m)
│     │  └─ aspetto derive(P, "look")                    seed passato al generatore planet
│     ├─ fascia    derive(Y, "belt", b)
│     └─ cometa    derive(Y, "comet", c)
└─ stili dei nomi  derive(G, "names")                   regioni linguistiche
```

Il **numero** di sistemi di un settore dipende solo dalla densità della galassia in quel settore e dal seed del settore; la **posizione** del sistema i dipende solo dal seed del settore (una cella distinta di una griglia 4 × 4, con jitter). Quindi `system(G, sx, sy, i)` costa un sistema, non un settore intero.

## 4. ID e indirizzi

```ts
type BodyRef =
  | { kind: 'star'; index: number }                      // 0 = primaria, 1-2 = compagne
  | { kind: 'planet'; index: number; moon?: number }    // pianeti in ordine di distanza, lune in ordine di distanza
  | { kind: 'belt'; index: number }
  | { kind: 'comet'; index: number };

interface Address {
  galaxy: number;                        // seed della galassia, uint32
  sector?: { sx: number; sy: number };
  system?: number;                       // indice nel settore
  body?: BodyRef;
}
```

- Un indirizzo può fermarsi a ogni livello: galassia, settore, sistema, corpo.
- **Stringa corta** per i link: numeri in base 36, livelli separati da punti, solo `[0-9a-z.-]`:

  ```
  <galassia>[.<sx>.<sy>[.<sistema>[.<corpo>]]]
  corpo: s<k> | p<n>[m<k>] | a<k> | c<k>      (indici del corpo in decimale)
  ```

  Esempio: galassia 305419896, settore (-12, 40), sistema 3, pianeta 2, luna 1 → `51u7i0.-c.14.3.p2m1`.
  *Nota dall'implementazione*: gli indici del corpo sono decimali, perché in base 36 `m` è una cifra e `p2m1` sarebbe ambiguo (l'ha trovato il test di round-trip).
- `parseAddress` restituisce un indirizzo o un errore leggibile (in italiano, come la CLI); `resolve` controlla che il corpo esista davvero (indice del sistema minore del numero di sistemi del settore, pianeta esistente...).
- **Stabilità**: gli indici sono l'ordine di generazione (sistemi) o l'ordine per distanza (corpi), entrambi deterministici; un indirizzo resta valido finché non cambia la versione dell'universo. La versione (`universe@1`) va nei link dell'app allo step 7.
- Zoom e tick non fanno parte dell'indirizzo di un oggetto: appartengono allo stato della vista (link dell'app, step 7).

## 5. Forma della galassia

Parametri dal seed: raggio del disco (180–240 settori), numero di bracci (2–4), angolo di apertura dei bracci, larghezza dei bracci, eventuale barra, raggio del nucleo, rotazione.

Densità in un punto (unità di settore, centro in 0,0):

- **disco** esponenziale che si spegne dopo il raggio;
- **nucleo** gaussiano denso, eventuale **barra**;
- **bracci**: spirale logaritmica per ogni braccio, profilo gaussiano in angolo attorno al braccio; coordinate deformate da un domain warp, così i bracci non sono geometrici;
- **grumi**: fbm che modula la densità;
- **vuoti**: rumore a bassa frequenza sotto una soglia azzera la densità;
- **ammassi**: celle rare con una gaussiana stretta e intensa.

Oltre il disco la densità scende quasi a zero: la griglia di settori è infinita, ma la galassia ha un bordo leggibile.

**Settore** (`sector(sx, sy)`): numero di sistemi (0–16, da una distribuzione con media proporzionale alla densità) e **carattere**:

- `age` 0..1: giovane nei bracci, vecchio nel nucleo e tra i bracci; sposta la distribuzione delle stelle;
- `nebula` 0..1 e le due rampe delle nebulose (emissione viola, magenta, turchese nei bracci; toni caldi e scuri nel nucleo);
- `stars` 0..3: densità delle stelle dello sfondo;
- `style`: stile dei nomi della regione.

Il carattere si traduce direttamente nei parametri `region` del generatore `background`.

## 6. Sistemi

**Stelle** (classi come `gen/star`): pesi interpolati tra una popolazione giovane e una vecchia secondo `age`. Molte nane rosse, poche stelle massicce: attese globali circa M 45–55%, K 15–20%, G 8–12%, F 5–9%, A 2–5%, B+O sotto il 3%, resti (nane bianche, stelle di neutroni) e giganti rosse pochi per cento. Massa, luminosità e temperatura dalla classe e da un sottotipo casuale; i dati fisici delle classi stanno in `universe/stars.ts`, e `gen/star` li importa da lì.

**Molteplicità**: binarie ~12%, triple ~2%. Nella binaria stretta le due stelle orbitano attorno al baricentro e i pianeti orbitano attorno alla coppia (a partire da 3 volte la separazione); nella tripla la terza stella è lontana, oltre i pianeti.

**Pianeti**: numero dalla classe della stella (M 1–4, K 2–6, G 3–9, F 3–8, A 2–6, B/O 0–4, resti 0–2, giganti 1–4). Semiassi crescenti: il primo a 0,15–0,5 × √L UA (0,1–0,35 nella prima stesura: metà dei pianeti finiva nella zona calda), poi ogni orbita tra 1,5 e 2,2 volte la precedente. Zone da √L: calda (< 0,95 √L), abitabile (0,95–1,67 √L), fredda, oltre la linea della neve (> 2,7 √L). Archetipo per zona:

| Zona | Archetipi |
|---|---|
| calda | lava, deserto, morto, tossico |
| abitabile | terrestre, oceanico, deserto, tossico, ghiacciato, morto |
| fredda | deserto, ghiacciato, morto, craterizzato |
| oltre la neve | gigante gassoso, ghiacciato, craterizzato, morto |

Le nane rosse fanno meno giganti gassosi. Raggio del pianeta dall'archetipo (roccioso 0,4–1,8, gigante 3,5–12 raggi terrestri); rotazione da 8 a 60 ore (giganti 9–18); anelli soprattutto sui giganti.

**Lune**: giganti 1–6, rocciosi 0–2; archetipi craterizzato, ghiacciato (oltre la neve), morto, raramente lava. Orbite da 2,5 raggi del pianeta in su (oltre gli anelli), rapporto 1,4–2 tra orbite successive.

**Fasce di asteroidi** (0–2) al posto di un'orbita della sequenza (da 0,9 a 1,1 volte il semiasse), più probabili al primo posto oltre la linea della neve; **comete** (0–3) su orbite molto eccentriche, le sole che possono incrociare le altre.

**Aspetto**: ogni corpo porta la ricetta per il suo generatore (archetipo, anelli sì o no, periodo di rotazione, periodo delle nuvole) e il seed `look`: l'universo decide *che cosa* esiste, il generatore *come appare*.

## 7. Orbite

```ts
interface Orbit { a: number; e: number; omega: number; period: number; phase: number } // a in UA (o raggi), period e phase in tick
```

- Posizione al tick t: anomalia media `M = 2π · ((t + phase) mod period) / period` con modulo intero, poi equazione di Keplero `E − e sin E = M` risolta con un numero fisso di passi di Newton (partenza da π per le eccentricità alte), poi `x = a(cos E − e)`, `y = a √(1−e²) sin E`, ruotati di `omega`. Tutto con `core/dmath`.
- Periodo: `8766 · a^1.5 / √M` tick per i corpi attorno a stelle; per le lune `k · a^1.5` tick con a in raggi del pianeta, k = 1,4 per i rocciosi e 3 per i giganti (con 4 la Luna impiegava 77 giorni).
- **Nessuna sovrapposizione**: tra pianeti consecutivi il periastro dell'esterno supera di almeno il 20% l'apoastro dell'interno (eccentricità dei pianeti ≤ 0,1, rapporto tra semiassi ≥ 1,5); le fasce occupano solo spazi liberi con lo stesso margine; lo stesso per le lune. Le comete sono escluse.
- Rotazione dei corpi: periodo in tick, fase dal seed; il generatore `planet` riceve il periodo nella ricetta e il tick come frame.

## 8. Nomi

- **Stili per regione**: cinque grammatiche di sillabe (attacchi, vocali, code, numero di sillabe, apostrofi o trattini); la regione di un settore viene da celle di Worley a bassa frequenza sul piano della galassia, così regioni vicine parlano la stessa "lingua".
- **Sistema**: nome proprio (per esempio "Velmara") e sigla da catalogo `XX-NNNN` (due lettere dal settore, quattro cifre dal sistema, per esempio "KX-4471"). Unici nel settore: in caso di doppione si ritenta con `derive(seed, "name", n)`.
- **Corpi**: stelle `A`, `B`, `C` nei sistemi multipli; pianeti `b`, `c`, `d`… ("KX-4471 b"); lune in numeri romani ("KX-4471 b II"); i pianeti abitabili hanno anche un nome proprio.
- **Filtri**: nessun nome reale (elenco di stelle, pianeti e lune reali, confronto esatto) e nessuna parola offensiva (elenco di radici in italiano e inglese, confronto per sottostringa dopo aver tolto accenti e maiuscole). Un nome scartato si rigenera.

## 9. API

| Modulo | Contenuto |
|---|---|
| `universe/coords.ts` | `GalacticPoint`, `normalize`, `toGlobal`, `fromGlobal`, `delta` |
| `universe/galaxy.ts` | `Galaxy(seed)`: forma, `density(gx, gy)`, `sector(sx, sy)` → numero di sistemi, carattere, stile |
| `universe/stars.ts` | classi stellari fisiche, `pickStarClass(age, rng)`, `starIdentity(class, seed)` |
| `universe/orbit.ts` | `Orbit`, `solveKepler`, `orbitPosition(orbit, tick)` |
| `universe/names.ts` | stili, `systemName`, `catalogCode`, lettere, numeri romani, filtri |
| `universe/system.ts` | `generateSystem(galaxy, sx, sy, i)`, `systemSummary(sector, i)` (solo stelle e posizione, per le mappe) |
| `universe/address.ts` | `Address`, `formatAddress`, `parseAddress`, `resolve` |
| `universe/census.ts` | `sampleSystems` (uniforme tra i sistemi), `takeCensus`, intervalli attesi `EXPECTED` (aggiunto durante l'implementazione) |

## 10. CLI

- `forge galaxy [--galaxy n] [--center sx,sy --radius n] [--cell px]`: la galassia intera (un pixel per settore, colore dalla stella più luminosa, intensità dal numero di sistemi) o una regione ingrandita (un blocco di pixel per settore, sistemi come punti colorati per classe).
- `forge system <indirizzo> [--tick n] [--frames n --step t]`: vista schematica del sistema (scala logaritmica delle distanze) con orbite, stelle, pianeti, lune, fasce e comete disegnati dai generatori, sfondo dal carattere del settore; con `--frames` una GIF con il tempo che scorre.
- `forge systems [--galaxy n] [--count 16]`: foglio di viste di sistemi scelti a caso dove la galassia è abitata.
- `forge census [--count 10000]`: statistiche su molti sistemi (classi, molteplicità, pianeti, archetipi, lune), confrontabili con i valori attesi.

## 11. Test

Determinismo e round-trip degli indirizzi; accesso casuale (un sistema generato da solo è identico a quello generato dopo i suoi vicini); orbite senza sovrapposizioni; Keplero (residuo, periodicità); forma della galassia (nucleo più denso del bordo, contrasto tra bracci e spazi tra i bracci, quasi vuoto fuori dal disco); statistiche su 10 000 sistemi entro gli intervalli attesi; nomi unici in ogni settore e senza parole filtrate.
