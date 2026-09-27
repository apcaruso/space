# Step 7: camera, scale e cache dell'esploratore

Piano scritto prima del codice. Richiesta in più rispetto al testo dello step: **risolvere il costo di generazione**, perché l'esplorazione deve essere fluida.

## 1. Dove vive il codice

- `view/` è un nuovo modulo **puro** (stesse regole di determinismo di `core/`, `gen/`, `universe/`): camera, geometria del mondo, scene, framebuffer, composizione, cache degli sprite, interfaccia disegnata a codice. Importa da `core/`, `toolkit/`, `gen/`, `universe/`; lo importano `app/` e `forge/`.
- Così **lo stesso renderer gira nel browser e in Node**: `forge view` chiama le stesse funzioni dell'app, con un fornitore di sprite sincrono al posto dei worker.
- `app/` contiene solo ciò che tocca il browser: canvas, input, `requestAnimationFrame`, worker, URL.

## 2. Renderer

- **Framebuffer indicizzato 480 × 270** (`IndexedBuffer` di `core/`). Tutto (mondo, sprite, interfaccia) finisce lì con blit 1:1; nessuna trasparenza parziale: le "trasparenze" dei pannelli sono tabelle di indici (per esempio `lightTable` verso i toni scuri) applicate al rettangolo del pannello.
- **Presentazione**: una tabella `Uint32Array(256)` indice → RGBA, ricostruita solo quando cambia (palette cycling globale, dissolvenze); poi un ciclo sul framebuffer riempie un `ImageData` e un solo `putImageData` per frame. **Scelta: `putImageData`, non WebGL.** A 480 × 270 (129 600 pixel) la conversione costa circa 0,2 ms in JS; WebGL farebbe lo stesso lavoro sulla GPU ma con shader, texture, perdita di contesto e un secondo percorso di codice diverso da Node. La stessa funzione di conversione produce i PNG di `forge view`.
- **Upscale**: il canvas resta 480 × 270, CSS lo ingrandisce del massimo fattore intero che entra nella finestra (in pixel del dispositivo), `image-rendering: pixelated`, bande nere attorno (letterbox).
- **Effetti globali di colore a costo zero**: una `IndexTable` applicata alla tabella di presentazione, non ai pixel. La usano lo scintillio delle stelle di sfondo (cycling sui toni 0–2 di `metal-light`, come nel generatore `background`) e le dissolvenze.

## 3. Mondo continuo e camera

**Un solo spazio**: tutto ha una posizione in unità di settore (`GalacticPoint`: settore intero + offset float). Sistemi, pianeti e lune non vivono in sistemi di riferimento separati: hanno una **geometria schematica** in unità di settore, così lo zoom è continuo dalla galassia alla superficie senza cambi di riferimento.

- **Camera**: `{ center: GalacticPoint, z }` con `z = log2(s)` e `s` = pixel dello schermo per settore. Da `z ≈ -1,4` (galassia intera) a `z ≈ 19` (un pianeta che riempie lo schermo).
- **Pixel ancorati al mondo**: un punto `p` va sullo schermo a `floor(p·s) − floor(c·s) + (240, 135)` (con `p·s` calcolato come `sx·s + x·s`): durante un pan tutti gli oggetti si spostano dello stesso numero intero di pixel, niente tremolio relativo.
- **Geometria schematica di un sistema** (raggio di disposizione `R = 0,03` settori; i sistemi distano almeno 0,075 settori, quindi non si sovrappongono):
  - stella: raggio `0,0025 × scala della classe` (quella di `gen/star/classes.ts`); coppie strette affiancate attorno al centro;
  - orbite: la scala radiale logaritmica di `gen/maps/system.ts`, da poco fuori le stelle fino a `R`; ellissi campionate sull'orbita vera;
  - pianeti: raggio `R × 0,022 × raggio^0,3` (raggio in raggi terrestri): circa 6 px per una Terra e 12 px per un Giove quando il sistema riempie lo schermo;
  - lune: raggio proporzionale al pianeta, orbite circolari a distanze geometriche fuori dagli anelli (`1,9` o `2,8` raggi del pianeta, poi × 1,35);
  - fasce e comete: attraverso la stessa scala radiale.
- **Pan**: trascinamento (mouse e un dito), frecce e WASD. **Zoom**: rotella, pinch, `+`/`-` e `Q`/`E`, centrato sul cursore (il punto sotto il cursore resta fermo). **Voli**: breadcrumb e ricerca spostano la camera con un'animazione (prima allontana, poi sposta, poi avvicina). **Inseguimento**: un corpo selezionato viene seguito mentre il tempo scorre; un pan lo sgancia.

## 4. Livelli di scala

Ogni livello decide cosa mostrare; i passaggi sono continui perché dipendono da dimensioni a schermo, non da un interruttore.

| Livello | `s` (px/settore) | Cosa si vede |
|---|---|---|
| Galassia | < 3 | bagliore della densità (colori delle nebulose), sistemi come singoli pixel colorati per classe, sommati per pixel: tono dal numero di sistemi, colore dal più luminoso; **limite di magnitudine**: le stelle deboli compaiono avvicinandosi |
| Regione | 3 – 1 200 | tutti i sistemi come punti, i luminosi come piccole croci, binarie come coppie; segni degli angoli dei settori quando un settore supera 24 px |
| Sistema | 1 200 – ~60 000 | le stelle diventano sprite animati quando il disco supera 6 px; orbite, fasce e comete compaiono (dissolvenza a dither) quando il raggio del sistema supera 40 px; pianeti come punti, poi sprite |
| Corpo | pianeta ≥ 48 px | pianeta con anelli, lune come sprite con le loro orbite |
| Superficie | pianeta ≥ 280 px | mappa equirettangolare del pianeta al centro, disegnata a pixel dal generatore, con legenda dei materiali |

Lo sfondo stellato (generatore `background`, con la regione del settore) compare solo dentro i sistemi, fermo: nella galassia e nelle regioni le stelle sono i sistemi veri.

## 5. Gradini di dimensione

- **Lo zoom non scala mai i pixel**: posizioni continue, sprite generati al **gradino** più vicino (in scala logaritmica) e disegnati 1:1.
- Gradini: diametri che crescono di circa il 20% (8, 10, 12, 14, 17, 20, 24, 29, 35, 42, 50, 60, 72, 86, 104, 124, 149, 179, 215, 256), limitati ai lati ammessi dal generatore.
- **Passaggio tra gradini**, due soluzioni da confrontare in `forge view --zoom-to`:
  1. **cambio secco**: al cambio di gradino si disegna subito il nuovo;
  2. **dissolvenza a dither**: per 6 frame si disegnano entrambi, il nuovo dove la soglia Bayer 4×4 è sotto la frazione di avanzamento.
  La scelta va in Decisioni dopo aver guardato le strisce.
- **Mappe senza gradini**: il bagliore della galassia si interpola in modo continuo da campioni su una griglia del mondo (una griglia per ottava di zoom, circa un campione ogni 8 px), con dither Bayer ancorato al mondo: niente da scalare.

## 6. Cache e generazione

- **Chiave**: `hash(generatore@versione, ricetta, seed, gradino, frame, direzione della luce)`; la ricetta in forma canonica (chiavi ordinate).
- **Web Worker**: un pool (fino a 4) genera gli sprite; lo stesso oggetto va sempre allo stesso worker, così le cache interne dei generatori (mappe dei pianeti) servono davvero. Il main thread non genera mai.
- **Segnaposto**: finché uno sprite non è pronto si disegna il gradino più vicino già in cache dello stesso oggetto (anche di un altro frame o luce), altrimenti un dischetto di pochi pixel del colore dell'oggetto.
- **Memoria**: LRU sui byte degli sprite, limite 48 MB; gli sprite usati nel frame corrente non si eliminano.
- **Pre-generazione**: quando lo zoom si muove verso un gradino, gli oggetti visibili chiedono anche il gradino successivo, con priorità più bassa; le richieste non più visibili vengono scartate prima di partire.
- **Catalogo della galassia**: posizioni, classi e luminosità di tutti i sistemi (circa 150 000) in array tipizzati, costruito dal worker a bande di settori e mostrato man mano; serve al livello galassia e regione e alla ricerca. I sistemi completi si generano solo vicino alla camera, con una cache LRU.

### Il costo di generazione (misurato prima di cominciare)

| Fase | Oggi |
|---|---|
| scelta del tentativo di un pianeta (`registry.select`): rende il pianeta a 64 px solo per validarlo | 40–100 ms |
| pianeta nuovo a 24 px (mappe + disegno) | 11–15 ms |
| pianeta nuovo a 128 px | 115–207 ms |
| stesso pianeta, altro frame, 24 px (mappe in cache) | 1,4–2,4 ms |

Interventi:

1. **Validazione senza rasterizzare**: i validatori guardano solo il descrittore. Nuovo campo opzionale `describe(recipe, seed)` del generatore; `select` lo usa quando c'è. Il tentativo scelto resta identico (stesso descrittore), quindi nessun golden cambia per questo.
2. **Mappe condivise tra gradini**: righe della mappa arrotondate alla potenza di 2 ≥ lato (oggi 1,6 × lato, diverse per ogni lato): una mappa serve 4 gradini e ha meno celle. Cambia l'output: `planet@2`.
3. Seni e coseni delle longitudini calcolati una volta per colonna.
4. Cache delle mappe nel worker più grande e limitata in memoria.
5. Gradini piccoli per i pianeti (lato minimo da 16 a 8), per i pianeti lontani dentro un sistema.

Obiettivo: nessun frame del main thread oltre i 16 ms per colpa della generazione; primo sprite di un pianeta nuovo entro 30 ms a 24 px.

## 7. Luce

La luce di ogni corpo viene dalla sua stella: direzione nel piano dello schermo dal corpo al centro del sistema, **quantizzata a 32 direzioni**, elevazione fissa (20°). La direzione quantizzata entra nella chiave della cache.

## 8. Tempo

- Orologio in tick interi (1 tick = 1 ora). Velocità ×1 = 1 tick al secondo, poi ×10, ×100, ×1000, ×10 000; pausa. Il main thread accumula il tempo reale e fa avanzare il tick di un numero intero per frame; il tick non dipende dagli fps.
- Data simulata: anno, giorno, ora (`anno 3, giorno 212, 14:00`).
- Orbite, rotazioni (frame dei pianeti = `rotationFrame`), nuvole e terminatori (direzione della luce) seguono il tick. Le animazioni decorative (granuli e corona delle stelle, scintillio) seguono un contatore di frame a 12 fps, indipendente dalla velocità del tempo.
- Per ridurre i frame diversi da mettere in cache, il periodo delle nuvole dei pianeti diventa il doppio della rotazione (il ciclo completo è 2 × periodo): cambia la ricetta dei corpi, quindi `UNIVERSE_VERSION` 2.

## 9. Interfaccia

Tutta disegnata nel framebuffer con funzioni di `view/ui/`:

- **Font**: il 3 × 5 esteso con minuscole (x-height 3, discendenti di una riga), lettere accentate (accenti generati da codice sopra la lettera base), cifre e punteggiatura; variante **5 × 7** per titoli e pannelli. Unica eccezione alla regola "niente pixel a mano", come il 3 × 5.
- **Pannelli**: 9-slice procedurali (angoli e bordi calcolati da funzioni, fondo scurito con una tabella di indici).
- **Icone** a 8 e 12 px da primitive (cerchi, linee, archi): stella, pianeta, luna, fascia, cometa, galassia, settore, ricerca, pausa, play, avanti veloce, chiudi.
- **Selezione**: hover (anello attorno all'oggetto) e clic; pannello con nome, classificazione e dati; **breadcrumb** galassia › settore › sistema › pianeta › luna, clic su un livello per risalire (volo della camera).
- **Mappa di superficie** con legenda dei materiali in italiano.
- **Ricerca** (`/` o `Ctrl+K`): indirizzo esatto, oppure nome o sigla cercati dal worker nel catalogo; risultati in un pannello.
- **URL**: `?a=<indirizzo>&z=<zoom>&t=<tick>` aggiornato con `history.replaceState` (al massimo 4 volte al secondo) e letto all'avvio.
- **Overlay di debug (F3)**: fps, tempo per frame, tempi di generazione per generatore, dimensione della cache, richieste in coda, gradino e `z`.

## 10. Strumenti

`forge view <indirizzo> [--zoom z] [--zoom-to z2] [--tick n] [--frames n] [--transition cut|dither]`: rende in Node con lo stesso renderer (fornitore di sprite sincrono) e salva PNG o GIF; `z` è un numero o un nome di livello (`galaxy`, `region`, `system`, `body`, `surface`). Stampa tempo per frame e tempi di generazione per tipo di oggetto.

## 11. Test

Camera (conversioni schermo ↔ mondo, zoom centrato sul cursore, pixel ancorati al mondo), gradini, chiavi della cache, LRU, geometria schematica (nessuna sovrapposizione tra sistemi, orbite ordinate), determinismo del renderer (stessa vista, stessi byte), `describe` che sceglie lo stesso tentativo della resa canonica, font (tutti i glifi definiti), ricerca e URL (parse e format), `forge view` end to end. Nel browser: verifica con Chromium headless (Playwright dalla cache locale) di caricamento, zoom, fps.

## 12. Note dall'implementazione

- **Passaggio tra gradini**: provate entrambe; scelto il cambio secco (vedi Decisioni in `docs/DESIGN.md`). La dissolvenza resta con il tasto T.
- **Soglie dei livelli** tarate guardando le viste: dettaglio dei sistemi da 300 px/settore (non 1 200), sfondo stellato da 500 a 2 000, pianeti almeno di 8 px quando il raggio del sistema supera 70 px, lune da 20 px di pianeta, superficie da 280 px con zoom fermato a 420.
- **Periodi delle stelle**: le stelle non seguono il tick della simulazione ma il contatore decorativo, con cicli brevi che restano in cache.
- **Stelle e magnitudine**: le giganti rosse non fanno da faro a scala galattica; le nane rosse compaiono solo da circa 16 px per settore.
- **Misure**: nel browser, immersione completa a 60 fps (99° percentile 17,6 ms); in Node, composizione a regime 1,3 ms di mediana.
