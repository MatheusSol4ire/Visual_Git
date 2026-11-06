import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { MotionMode } from '../shared/protocol.ts';

/** Pastas de onde as telas podem carregar arquivos: só a dist/ da extensão. Nada da internet. */
export function webviewRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(extensionUri, 'dist')];
}

/** HTML de uma tela. `entry` é o nome do pacote gerado pelo esbuild (dist/<entry>.js e .css). */
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entry: 'commits' | 'details',
  motion: MotionMode,
  title: string,
): string {
  const dist = vscode.Uri.joinPath(extensionUri, 'dist');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, `${entry}.js`));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, `${entry}.css`));
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
  <title>${title}</title>
</head>
<body data-motion="${motion}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
