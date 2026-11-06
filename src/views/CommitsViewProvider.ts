import * as vscode from 'vscode';
import { isCommitHash, readCommits, readHead } from '../git/gitClient.ts';
import type { RepoService } from '../repo/RepoService.ts';
import { getMotionMode } from '../settings.ts';
import type { FromCommitsView, ToCommitsView } from '../shared/protocol.ts';
import { renderWebviewHtml, webviewRoots } from './html.ts';

const PAGE_SIZE = 300;
const MAX_RELOAD = 5000;

/** A lista de commits com o grafo, na barra lateral do Visual Git. */
export class CommitsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'visualGit.commits';

  private readonly extensionUri: vscode.Uri;
  private readonly repos: RepoService;
  private readonly onOpenCommit: (hash: string) => void;
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri, repos: RepoService, onOpenCommit: (hash: string) => void) {
    this.extensionUri = extensionUri;
    this.repos = repos;
    this.onOpenCommit = onOpenCommit;
    this.disposables.push(
      repos.onDidChange(() => this.post({ type: 'changed' })),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('visualGit.animations') || event.affectsConfiguration('workbench.reduceMotion')) {
          this.post({ type: 'settings', motion: getMotionMode() });
        }
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: webviewRoots(this.extensionUri) };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'commits', getMotionMode(), 'Commits');
    view.webview.onDidReceiveMessage((message: FromCommitsView) => this.onMessage(message), undefined, this.disposables);
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  /** Destaca um commit na lista (ex.: quando a aba de detalhes navega para outro). */
  select(hash: string): void {
    this.post({ type: 'select', hash });
  }

  /** Pede para a tela recarregar mantendo o que já foi carregado. */
  refresh(): void {
    this.post({ type: 'changed' });
  }

  private async onMessage(message: FromCommitsView): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.post({ type: 'settings', motion: getMotionMode() });
        await this.sendPage(0, PAGE_SIZE);
        break;
      case 'reload':
        await this.sendPage(0, clamp(message.count, PAGE_SIZE, MAX_RELOAD));
        break;
      case 'loadMore':
        await this.sendPage(Math.max(0, Math.floor(message.skip)), PAGE_SIZE);
        break;
      case 'openCommit':
        if (isCommitHash(message.hash)) this.onOpenCommit(message.hash);
        break;
      case 'openFolder':
        await vscode.commands.executeCommand('vscode.openFolder');
        break;
    }
  }

  private async sendPage(skip: number, limit: number): Promise<void> {
    const result = await this.repos.get();
    if ('state' in result) {
      this.post({ type: 'state', state: result.state });
      return;
    }
    const { repo } = result;
    try {
      const [page, head] = await Promise.all([readCommits(repo, skip, limit), readHead(repo)]);
      if (skip === 0 && page.commits.length === 0) {
        this.post({ type: 'state', state: { kind: 'empty', repoName: repo.name } });
        return;
      }
      this.post({ type: 'commits', repoName: repo.name, head, commits: page.commits, skip, hasMore: page.hasMore });
    } catch (error) {
      this.post({ type: 'state', state: this.repos.toErrorState(error) });
    }
  }

  private post(message: ToCommitsView): void {
    void this.view?.webview.postMessage(message);
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min;
}
