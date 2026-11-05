import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { findRepo, GitNotFoundError, NotARepoError, readCommits, type Repo } from '../git/gitClient.ts';
import { resolveGitPath } from '../git/resolveGit.ts';
import { getMotionMode } from '../settings.ts';
import type { FromWebview, RepoState, ToWebview } from '../shared/protocol.ts';

const PAGE_SIZE = 300;

/** A aba do Visual Git. Existe no máximo uma por vez. */
export class VisualGitPanel {
  private static current: VisualGitPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly log: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private repo: Repo | undefined;

  static show(context: vscode.ExtensionContext, log: vscode.OutputChannel): void {
    if (VisualGitPanel.current) {
      VisualGitPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('visualGit', 'Visual Git', vscode.ViewColumn.Active, {
      enableScripts: true,
      // A tela só pode carregar arquivos da pasta dist/ da extensão. Nada da internet.
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    });
    VisualGitPanel.current = new VisualGitPanel(panel, context, log);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, log: vscode.OutputChannel) {
    this.panel = panel;
    this.context = context;
    this.log = log;
    panel.webview.html = this.renderHtml();

    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: FromWebview) => this.onMessage(message)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('visualGit.animations') || event.affectsConfiguration('workbench.reduceMotion')) {
          this.post({ type: 'settings', motion: getMotionMode() });
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.repo = undefined;
        void this.loadFirstPage();
      }),
    );
  }

  private async onMessage(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.post({ type: 'settings', motion: getMotionMode() });
        await this.loadFirstPage();
        break;
      case 'refresh':
        this.repo = undefined;
        await this.loadFirstPage();
        break;
      case 'loadMore':
        await this.loadPage(message.skip);
        break;
    }
  }

  private async loadFirstPage(): Promise<void> {
    const state = await this.resolveRepo();
    if (state) {
      this.post({ type: 'state', state });
      return;
    }
    await this.loadPage(0);
  }

  /** Encontra o repositório da pasta aberta. Retorna um estado de erro se não conseguir. */
  private async resolveRepo(): Promise<RepoState | undefined> {
    if (this.repo) return undefined;
    // Por enquanto usamos a primeira pasta aberta. Escolher entre várias fica para depois.
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { kind: 'noWorkspace' };
    try {
      this.repo = await findRepo(await resolveGitPath(), folder.uri.fsPath);
      return undefined;
    } catch (error) {
      if (error instanceof GitNotFoundError) return { kind: 'gitMissing' };
      if (error instanceof NotARepoError) return { kind: 'notRepo' };
      return this.errorState(error);
    }
  }

  private async loadPage(skip: number): Promise<void> {
    const repo = this.repo;
    if (!repo) return;
    try {
      const page = await readCommits(repo, skip, PAGE_SIZE);
      if (skip === 0 && page.commits.length === 0) {
        this.post({ type: 'state', state: { kind: 'empty', repoName: repo.name } });
        return;
      }
      this.post({ type: 'commits', repoName: repo.name, commits: page.commits, skip, hasMore: page.hasMore });
    } catch (error) {
      this.post({ type: 'state', state: this.errorState(error) });
    }
  }

  private errorState(error: unknown): RepoState {
    const message = error instanceof Error ? error.message : String(error);
    this.log.appendLine(`[erro] ${message}`);
    return { kind: 'error', message };
  }

  private post(message: ToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const nonce = randomBytes(16).toString('base64');

    // Content Security Policy: só roda o nosso script e só carrega arquivos locais da extensão.
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Visual Git</title>
</head>
<body data-motion="${getMotionMode()}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    VisualGitPanel.current = undefined;
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}
