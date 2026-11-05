import type { FromWebview } from '../src/shared/protocol.ts';

interface VsCodeApi {
  postMessage(message: FromWebview): void;
}

// Função injetada pelo VS Code dentro da webview. Só pode ser chamada uma vez.
declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
