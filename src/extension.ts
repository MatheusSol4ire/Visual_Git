import * as vscode from 'vscode';
import { VisualGitPanel } from './panel/VisualGitPanel.ts';

/** Chamado pelo VS Code quando a extensão é usada pela primeira vez. */
export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Visual Git');

  context.subscriptions.push(
    log,
    vscode.commands.registerCommand('visualGit.open', () => VisualGitPanel.show(context, log)),
  );
}

export function deactivate(): void {}
