// Caminho de um arquivo do commit no disco. Separado do CommitDetailsPanel para ser testado sem o VS Code.
import { posix, win32 } from 'node:path';

/**
 * Junta a raiz do repositório com o caminho que o Git informou, garantindo que o resultado fica
 * DENTRO do repositório. Devolve `undefined` para algo como "../fora" ou "a/../../fora".
 * Um nome que só começa com dois pontos (ex.: "..env.example", "..config/x.json") é um arquivo
 * comum e é aceito.
 */
export function repoFilePath(root: string, path: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const lib = platform === 'win32' ? win32 : posix;
  const full = lib.join(root, path);
  const rel = lib.relative(root, full);
  if (!rel || rel === '..' || rel.startsWith(`..${lib.sep}`) || lib.isAbsolute(rel)) return undefined;
  return full;
}
