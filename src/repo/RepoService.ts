import * as vscode from 'vscode';
import { findRepo, GitNotFoundError, NotARepoError, readGitDirs, type Repo } from '../git/gitClient.ts';
import { resolveGitPath } from '../git/resolveGit.ts';
import type { RepoState } from '../shared/protocol.ts';

export type RepoResult = { repo: Repo } | { state: RepoState };

/**
 * Guarda qual repositório está aberto e avisa quando ele muda
 * (novo commit, troca de branch, fetch, tags...).
 */
export class RepoService implements vscode.Disposable {
  private readonly log: vscode.OutputChannel;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Disparado quando o histórico pode ter mudado. */
  readonly onDidChange = this.changed.event;

  private pending: Promise<RepoResult> | undefined;
  private watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(log: vscode.OutputChannel) {
    this.log = log;
    this.disposables.push(
      this.changed,
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reset()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.reset()),
    );
  }

  /** O repositório da pasta aberta (descoberto uma vez e guardado). */
  get(): Promise<RepoResult> {
    this.pending ??= this.resolve();
    return this.pending;
  }

  /** Esquece o repositório atual e avisa as telas para recarregar. */
  reset(): void {
    this.pending = undefined;
    this.disposeWatchers();
    this.changed.fire();
  }

  private async resolve(): Promise<RepoResult> {
    // Por enquanto usamos a primeira pasta aberta. Escolher entre várias fica para depois.
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { state: { kind: 'noWorkspace' } };
    try {
      const repo = await findRepo(await resolveGitPath(), folder.uri.fsPath);
      await this.watch(repo);
      return { repo };
    } catch (error) {
      this.pending = undefined; // tenta de novo na próxima vez
      if (error instanceof GitNotFoundError) return { state: { kind: 'gitMissing' } };
      if (error instanceof NotARepoError) return { state: { kind: 'notRepo' } };
      return { state: this.toErrorState(error) };
    }
  }

  /** Observa os arquivos internos do Git que mudam quando o histórico muda. */
  private async watch(repo: Repo): Promise<void> {
    this.disposeWatchers();
    try {
      const { gitDir, commonDir } = await readGitDirs(repo);
      const patterns = [
        new vscode.RelativePattern(vscode.Uri.file(gitDir), 'HEAD'),
        new vscode.RelativePattern(vscode.Uri.file(commonDir), '{packed-refs,refs/**}'),
      ];
      for (const pattern of patterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const onEvent = () => this.scheduleChange();
        this.watchers.push(watcher, watcher.onDidCreate(onEvent), watcher.onDidChange(onEvent), watcher.onDidDelete(onEvent));
      }
    } catch (error) {
      // Sem observação automática; o botão "Atualizar" continua funcionando.
      this.log.appendLine(`[aviso] não foi possível observar o repositório: ${String(error)}`);
    }
  }

  /** Várias mudanças seguidas (ex.: um fetch) viram um aviso só. */
  private scheduleChange(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed.fire(), 400);
  }

  toErrorState(error: unknown): Extract<RepoState, { kind: 'error' }> {
    const message = error instanceof Error ? error.message : String(error);
    this.log.appendLine(`[erro] ${message}`);
    return { kind: 'error', message };
  }

  private disposeWatchers(): void {
    for (const disposable of this.watchers.splice(0)) disposable.dispose();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposeWatchers();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}
