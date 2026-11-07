// Repositório numa pasta ACIMA da que foi aberta (ex.: abrir C:\proj\frontend com o .git em C:\proj).
// Seguimos a mesma regra da extensão Git do VS Code: a configuração `git.openRepositoryInParentFolders`.
// Separado do RepoService para poder ser testado sem o VS Code.
import { posix, win32 } from 'node:path';

/** Valores de `git.openRepositoryInParentFolders` (o padrão do VS Code é "prompt"). */
export type ParentFolderMode = 'always' | 'never' | 'prompt';

export function parentFolderMode(value: unknown): ParentFolderMode {
  return value === 'always' || value === 'never' ? value : 'prompt';
}

/** Caminho absoluto comparável: no Windows e no macOS maiúsculas e minúsculas são a mesma pasta. */
export function comparablePath(path: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = (platform === 'win32' ? win32 : posix).resolve(path);
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

/** true quando a raiz do repositório não é a pasta aberta nem fica dentro dela. */
export function isOutsideFolder(root: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  const path = platform === 'win32' ? win32 : posix;
  const rel = path.relative(comparablePath(folder, platform), comparablePath(root, platform));
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}
