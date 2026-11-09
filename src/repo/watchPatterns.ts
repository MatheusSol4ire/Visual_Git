// Quais arquivos internos do Git observar para saber que o histórico mudou.
// Separado do RepoService para poder ser testado sem o VS Code.
import { comparablePath } from './parentFolder.ts';

export interface WatchPattern {
  /** Pasta onde o padrão é procurado. */
  base: string;
  /** Padrão glob, relativo a `base`. */
  glob: string;
}

/**
 * `gitDir` é a pasta do Git deste checkout (onde fica o HEAD); `commonDir` é a pasta onde ficam as
 * branches e tags (a mesma, fora de worktrees).
 *
 * Dois formatos de guardar as referências:
 *  - "files" (o padrão até hoje): HEAD, packed-refs e refs/**;
 *  - "reftable" (opcional, previsto para virar o padrão no Git 3.0): HEAD e refs/ ficam fixos e tudo
 *    muda em reftable/ (tables.list e os *.ref). Numa worktree, o HEAD dela fica na reftable/ da
 *    pasta própria da worktree.
 */
export function watchPatterns(gitDir: string, commonDir: string, platform: NodeJS.Platform = process.platform): WatchPattern[] {
  const shared: WatchPattern = { base: commonDir, glob: '{packed-refs,refs/**,reftable/**}' };
  if (comparablePath(gitDir, platform) === comparablePath(commonDir, platform)) {
    return [{ base: gitDir, glob: 'HEAD' }, shared];
  }
  return [{ base: gitDir, glob: '{HEAD,reftable/**}' }, shared];
}
