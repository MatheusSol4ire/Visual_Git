import * as vscode from 'vscode';
import { realpathSync } from 'node:fs';
import { findRepo, GitError, GitNotFoundError, NotARepoError, readGitDirs, type Repo } from '../git/gitClient.ts';
import { resolveGitPath } from '../git/resolveGit.ts';
import type { RepoState } from '../shared/protocol.ts';
import { comparablePath, isOutsideFolder, parentFolderMode } from './parentFolder.ts';

/** Onde guardamos (por projeto aberto) os repositórios de pastas acima que o usuário aceitou. */
const ALLOWED_PARENTS_KEY = 'visualGit.allowedParentRepos';

export type RepoResult = { repo: Repo } | { state: RepoState };

/**
 * Guarda qual repositório está aberto e avisa quando ele muda
 * (novo commit, troca de branch, fetch, tags...).
 */
export class RepoService implements vscode.Disposable {
  private readonly log: vscode.OutputChannel;
  private readonly workspaceState: vscode.Memento;
  /** Repositório numa pasta acima da aberta, esperando o usuário aceitar. */
  private parentRoot: string | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Disparado quando o histórico pode ter mudado. */
  readonly onDidChange = this.changed.event;

  private pending: Promise<RepoResult> | undefined;
  private watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(log: vscode.OutputChannel, workspaceState: vscode.Memento) {
    this.log = log;
    this.workspaceState = workspaceState;
    this.disposables.push(
      this.changed,
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reset()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.reset()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('git.openRepositoryInParentFolders') ||
          event.affectsConfiguration('visualGit.parentFolderRepos')
        ) {
          this.reset();
        }
      }),
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

  /**
   * O usuário aceitou o repositório da pasta acima (o que está esperando resposta).
   * `always`: muda só a configuração do Visual Git (`visualGit.parentFolderRepos`), nunca a do Git do VS Code.
   */
  async allowParentRepo(always: boolean): Promise<void> {
    const root = this.parentRoot;
    if (!root) return;
    // Lembrado para este projeto aberto (vale mesmo se a configuração da pasta mandar perguntar).
    const allowed = this.allowedParents();
    allowed.add(comparablePath(root));
    await this.workspaceState.update(ALLOWED_PARENTS_KEY, [...allowed]);
    if (always) {
      await vscode.workspace
        .getConfiguration('visualGit')
        .update('parentFolderRepos', 'always', vscode.ConfigurationTarget.Global);
    }
    this.reset();
  }

  private allowedParents(): Set<string> {
    const saved = this.workspaceState.get<unknown>(ALLOWED_PARENTS_KEY);
    return new Set(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : []);
  }

  /**
   * Repositório numa pasta acima da aberta: segue `git.openRepositoryInParentFolders`, como o Git do VS Code.
   * Devolve o estado a mostrar no lugar do histórico, ou `undefined` se pode seguir.
   */
  private checkParentRepo(root: string, folder: string): RepoState | undefined {
    this.parentRoot = undefined;
    if (!isOutsideFolder(realPath(root), realPath(folder))) return undefined;
    const mode = parentFolderMode(vscode.workspace.getConfiguration('git').get('openRepositoryInParentFolders'));
    if (mode === 'always') return undefined;
    if (mode === 'never') return { kind: 'notRepo' };
    // Só o valor do usuário: o .vscode/settings.json do próprio projeto não pode pular a pergunta.
    if (vscode.workspace.getConfiguration('visualGit').inspect('parentFolderRepos')?.globalValue === 'always') return undefined;
    if (this.allowedParents().has(comparablePath(root))) return undefined;
    // Nada mais roda nesse repositório (a configuração local dele pode chamar programas) até o usuário aceitar.
    this.parentRoot = root;
    return { kind: 'parentRepo', root };
  }

  private async resolve(): Promise<RepoResult> {
    // Por enquanto usamos a primeira pasta aberta que está no computador (não virtual).
    // Escolher entre várias fica para depois.
    const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file');
    if (!folder) return { state: { kind: 'noWorkspace' } };
    try {
      const repo = await findRepo(await resolveGitPath(), folder.uri.fsPath);
      const blocked = this.checkParentRepo(repo.root, folder.uri.fsPath);
      if (blocked) {
        if (blocked.kind === 'notRepo') this.watchForNewRepo(folder.uri);
        return { state: blocked };
      }
      await this.watch(repo);
      return { repo };
    } catch (error) {
      this.pending = undefined; // tenta de novo na próxima vez
      if (error instanceof GitNotFoundError) return { state: { kind: 'gitMissing' } };
      if (error instanceof NotARepoError) {
        this.watchForNewRepo(folder.uri);
        return { state: { kind: 'notRepo' } };
      }
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

  /**
   * Pasta sem Git: espera o `.git` aparecer (`git init` no terminal ou "Inicializar repositório" do
   * VS Code) para a lista sair sozinha do "Esta pasta não usa Git".
   */
  private watchForNewRepo(folder: vscode.Uri): void {
    this.disposeWatchers();
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '{.git,.git/HEAD}'));
    const onEvent = () => {
      this.pending = undefined; // descobre o repositório de novo
      this.scheduleChange();
    };
    this.watchers.push(watcher, watcher.onDidCreate(onEvent), watcher.onDidChange(onEvent), watcher.onDidDelete(onEvent));
  }

  /** Várias mudanças seguidas (ex.: um fetch) viram um aviso só. */
  private scheduleChange(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed.fire(), 400);
  }

  toErrorState(error: unknown): Extract<RepoState, { kind: 'error' }> {
    const message = error instanceof Error ? error.message : String(error);
    // O texto técnico do Git (em inglês) fica só no log; a tela recebe a frase em português.
    const detail = error instanceof GitError && error.detail ? `\n${error.detail}` : '';
    this.log.appendLine(`[erro] ${message}${detail}`);
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

/** Caminho real (sem atalhos/links), para comparar pastas; se não der, o próprio caminho. */
function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
