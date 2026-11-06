interface VsCodeApi<T> {
  postMessage(message: T): void;
}

// Função injetada pelo VS Code dentro da webview. Só pode ser chamada uma vez por tela.
declare function acquireVsCodeApi<T>(): VsCodeApi<T>;

let api: VsCodeApi<unknown> | undefined;

/** Canal de mensagens para a extensão, tipado com as mensagens que esta tela pode enviar. */
export function getVsCode<T>(): VsCodeApi<T> {
  api ??= acquireVsCodeApi<unknown>();
  return api as VsCodeApi<T>;
}

/** Liga/desliga animações conforme a configuração recebida da extensão. */
export function applyMotion(motion: string): void {
  document.body.dataset.motion = motion;
}
