import * as vscode from 'vscode';
import { RepoService } from './repo/RepoService.ts';
import { CommitDetailsPanel } from './views/CommitDetailsPanel.ts';
import { CommitsViewProvider } from './views/CommitsViewProvider.ts';

/** Chamado pelo VS Code quando a extensão é usada pela primeira vez. */
export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Visual Git');
  const repos = new RepoService(log, context.workspaceState);

  // A lista e a aba de detalhes conversam: clicar na lista abre os detalhes;
  // navegar nos detalhes (ex.: para o commit pai) destaca o commit na lista.
  let commits: CommitsViewProvider | undefined;
  const details = new CommitDetailsPanel(context.extensionUri, repos, (hash) => commits?.select(hash));
  commits = new CommitsViewProvider(context.extensionUri, repos, (hash) => details.show(hash));

  context.subscriptions.push(
    log,
    repos,
    details,
    commits,
    vscode.window.registerWebviewViewProvider(CommitsViewProvider.viewId, commits),
    vscode.commands.registerCommand('visualGit.open', () =>
      vscode.commands.executeCommand('workbench.view.extension.visualGit'),
    ),
    vscode.commands.registerCommand('visualGit.refresh', () => repos.reset()),
  );
}

export function deactivate(): void {}
