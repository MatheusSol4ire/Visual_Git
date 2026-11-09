import * as vscode from 'vscode';
import { isAbsolute } from 'node:path';
import { findGitInPath } from './gitClient.ts';

/** Pedaço mínimo da API da extensão Git nativa do VS Code que usamos. */
export interface BuiltInGitApi {
  git: { path: string };
  /** Endereço que o VS Code entende como "este arquivo nesta versão do Git". */
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
  /** Repositório que a extensão nativa abriu e que contém este arquivo (`null` se ela não abriu nenhum). */
  getRepository(uri: vscode.Uri): unknown;
  /** Pede para a extensão nativa abrir o repositório desta pasta (`null` se ela não conseguir). */
  openRepository?(root: vscode.Uri): Promise<unknown>;
}

interface BuiltInGitExtension {
  getAPI(version: 1): BuiltInGitApi;
}

/** API da extensão Git nativa, ou `undefined` se ela estiver desativada. */
export async function getBuiltInGitApi(): Promise<BuiltInGitApi | undefined> {
  try {
    const extension = vscode.extensions.getExtension<BuiltInGitExtension>('vscode.git');
    if (!extension) return undefined;
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1);
  } catch {
    return undefined;
  }
}

/**
 * Caminho absoluto do Git.
 * 1º: o mesmo Git que a extensão nativa do VS Code já encontrou e usa (respeita `git.path`).
 * 2º: busca segura no PATH (nunca na pasta do projeto: nem entradas relativas, nem um Git que fique
 *     dentro de uma das pastas abertas).
 */
export async function resolveGitPath(): Promise<string> {
  const path = (await getBuiltInGitApi())?.git.path;
  if (path && isAbsolute(path)) return path;
  const projectFolders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  return findGitInPath(process.env, projectFolders);
}
