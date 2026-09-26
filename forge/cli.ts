import { runCli } from './run';

process.exitCode = runCli(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
