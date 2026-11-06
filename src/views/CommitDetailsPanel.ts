import * as vscode from 'vscode';
import { isAbsolute, join, relative } from 'node:path';
import { isCommitHash, readCommitDetails, type Repo } from '../git/gitClient.ts';
import { getBuiltInGitApi } from '../git/resolveGit.ts';
import type { RepoService } from '../repo/RepoService.ts';
import { getMotionMode } from '../settings.ts';
import type { CommitDetails, FileChange, FromDetailsView, ToDetailsView } from '../shared/protocol.ts';
import { renderWebviewHtml, webviewRoots } from './html.ts';

/** A aba com os detalhes do commit clicado. Uma só, reaproveitada a cada clique. */
export class CommitDetailsPanel implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly repos: RepoService;
  private readonly onNavigate: (hash: string) => void;
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  private hash: string | undefined;
  private details: CommitDetails | undefined;
  private repo: Repo | undefined;
  private requestId = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri, repos: RepoService, onNavigate: (hash: string) => void) {
    this.extensionUri = extensionUri;
    this.repos = repos;
    this.onNavigate = onNavigate;
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('visualGit.animations') || event.affectsConfiguration('workbench.reduceMotion')) {
          this.post({ type: 'settings', motion: getMotionMode() });
        }
      }),
    );
  }

  /** Mostra os detalhes de um commit, criando a aba se ela ainda não existir. */
  show(hash: string): void {
    if (!isCommitHash(hash)) return;
    this.hash = hash;

    if (!this.panel) {
      this.ready = false;
      this.panel = vscode.window.createWebviewPanel(
        'visualGit.details',
        'Commit',
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
        { enableScripts: true, localResourceRoots: webviewRoots(this.extensionUri) },
      );
      this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
      this.panel.webview.html = renderWebviewHtml(this.panel.webview, this.extensionUri, 'details', getMotionMode(), 'Commit');
      this.panel.webview.onDidReceiveMessage((message: FromDetailsView) => this.onMessage(message));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.details = undefined;
      });
    } else {
      this.panel.reveal(undefined, true);
    }

    if (this.ready) void this.load(hash);
  }

  private async onMessage(message: FromDetailsView): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.post({ type: 'settings', motion: getMotionMode() });
        if (this.hash) await this.load(this.hash);
        break;
      case 'openCommit':
        if (isCommitHash(message.hash)) {
          this.show(message.hash);
          this.onNavigate(message.hash);
        }
        break;
      case 'openFile': {
        // A tela só manda a posição na lista; o caminho vem da nossa própria cópia dos detalhes.
        const file = Number.isInteger(message.index) ? this.details?.files[message.index] : undefined;
        if (file && this.details && this.repo) await openFileChange(this.repo, this.details, file);
        break;
      }
      case 'copyHash':
        if (this.details) {
          await vscode.env.clipboard.writeText(this.details.hash);
          void vscode.window.setStatusBarMessage('$(check) Hash do commit copiado', 2500);
        }
        break;
    }
  }

  private async load(hash: string): Promise<void> {
    const id = ++this.requestId;
    this.post({ type: 'loading', hash });
    const result = await this.repos.get();
    if ('state' in result) {
      this.post({ type: 'error', message: 'Não foi possível acessar o repositório.' });
      return;
    }
    try {
      const details = await readCommitDetails(result.repo, hash);
      if (id !== this.requestId) return; // o usuário já clicou em outro commit
      this.repo = result.repo;
      this.details = details;
      if (this.panel) this.panel.title = `Commit ${details.hash.slice(0, 7)}`;
      this.post({ type: 'details', details });
    } catch (error) {
      if (id !== this.requestId) return;
      this.post({ type: 'error', message: this.repos.toErrorState(error).message });
    }
  }

  private post(message: ToDetailsView): void {
    void this.panel?.webview.postMessage(message);
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}

/** Abre o "antes e depois" de um arquivo usando o editor de diferenças do próprio VS Code. */
async function openFileChange(repo: Repo, details: CommitDetails, file: FileChange): Promise<void> {
  const fileUri = safeFileUri(repo.root, file.path);
  const oldUri = safeFileUri(repo.root, file.oldPath ?? file.path);
  if (!fileUri || !oldUri) return;

  const git = await getBuiltInGitApi();
  if (!git) {
    void vscode.window.showWarningMessage('Para ver as diferenças, ative a extensão "Git" que já vem com o VS Code.');
    return;
  }

  const short = details.hash.slice(0, 7);
  const name = file.path.split('/').pop() ?? file.path;
  const after = git.toGitUri(fileUri, details.hash);

  if (file.status === 'added' || !details.comparedTo) {
    await vscode.commands.executeCommand('vscode.open', after, { preview: true }, `${name} (adicionado em ${short})`);
    return;
  }
  const before = git.toGitUri(oldUri, details.comparedTo);
  if (file.status === 'deleted') {
    await vscode.commands.executeCommand('vscode.open', before, { preview: true }, `${name} (removido em ${short})`);
    return;
  }
  await vscode.commands.executeCommand('vscode.diff', before, after, `${name} (${short}) — antes ↔ depois`, { preview: true });
}

/** Monta o endereço do arquivo garantindo que ele fica dentro do repositório. */
function safeFileUri(root: string, path: string): vscode.Uri | undefined {
  const full = join(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return vscode.Uri.file(full);
}
