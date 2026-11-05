import * as vscode from 'vscode';
import { isAbsolute } from 'node:path';
import { findGitInPath } from './gitClient.ts';

/** Pedaço mínimo da API da extensão Git nativa do VS Code que usamos. */
interface BuiltInGitExtension {
  getAPI(version: 1): { git: { path: string } };
}

/**
 * Caminho absoluto do Git.
 * 1º: o mesmo Git que a extensão nativa do VS Code já encontrou e usa (respeita `git.path`).
 * 2º: busca segura no PATH (nunca na pasta do projeto).
 */
export async function resolveGitPath(): Promise<string> {
  try {
    const extension = vscode.extensions.getExtension<BuiltInGitExtension>('vscode.git');
    if (extension) {
      const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
      const path = api.git.path;
      if (path && isAbsolute(path)) return path;
    }
  } catch {
    // extensão Git nativa desativada ou indisponível: usamos o PATH
  }
  return findGitInPath();
}
