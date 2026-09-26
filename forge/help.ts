export interface CommandInfo {
  name: string;
  usage: string;
  summary: string;
  implemented: boolean;
}

export const COMMANDS: readonly CommandInfo[] = [
  {
    name: 'render',
    usage: 'render <gen> [--seed N] [--size PX] [--frame F] [--recipe FILE] [--scale K]',
    summary: 'Renderizza un singolo oggetto in out/render/',
    implemented: false,
  },
  {
    name: 'sheet',
    usage: 'sheet <gen> [--count 64] [--from N] [--size PX] [--scale K]',
    summary: 'Foglio di varianti (griglia di seed) in out/sheets/',
    implemented: false,
  },
  {
    name: 'anim',
    usage: 'anim <gen> [--seed N] [--frames F] [--step T] [--scale K]',
    summary: 'Animazione GIF (rotazione, nuvole, terminatore) in out/anim/',
    implemented: false,
  },
  {
    name: 'view',
    usage: 'view <indirizzo> [--tick T] [--scale K]',
    summary: "Vista dell'app 480x270 renderizzata senza browser in out/views/",
    implemented: false,
  },
  {
    name: 'lint',
    usage: 'lint [gen]',
    summary: 'Controlli automatici su ricette, palette e output generati',
    implemented: false,
  },
  {
    name: 'golden',
    usage: 'golden check|update [gen]',
    summary: 'Confronta gli output con i golden, o li aggiorna consapevolmente',
    implemented: false,
  },
  {
    name: 'help',
    usage: 'help',
    summary: 'Mostra questo messaggio',
    implemented: true,
  },
];

export function helpText(): string {
  const width = Math.max(...COMMANDS.map((c) => c.usage.length));
  const lines = COMMANDS.map((c) => {
    const todo = c.implemented ? '' : '  (non ancora implementato)';
    return `  ${c.usage.padEnd(width)}  ${c.summary}${todo}`;
  });
  return [
    'forge: CLI di spatialengine per generatori, preview e golden',
    '',
    'Uso: npm run forge -- <comando> [opzioni]',
    '',
    'Comandi:',
    ...lines,
    '',
    'Gli output finiscono in out/ (ignorata da git).',
  ].join('\n');
}
