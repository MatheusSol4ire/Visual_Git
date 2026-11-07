interface VsCodeApi<T> {
  postMessage(message: T): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// Função injetada pelo VS Code dentro da webview. Só pode ser chamada uma vez por tela.
declare function acquireVsCodeApi<T>(): VsCodeApi<T>;

let api: VsCodeApi<unknown> | undefined;

/** Canal de mensagens para a extensão, tipado com as mensagens que esta tela pode enviar. */
export function getVsCode<T>(): VsCodeApi<T> {
  api ??= acquireVsCodeApi<unknown>();
  return api as VsCodeApi<T>;
}

/**
 * Ouve as mensagens da extensão. A tela roda num frame interno; o frame de fora (do próprio VS Code,
 * mesma origem) repassa cada mensagem da extensão com `contentWindow.postMessage(msg, window.origin)`.
 * Então só vale o que vem do frame pai e da nossa origem; o resto (outra página tentando falar com
 * esta tela) é ignorado, assim como mensagens fora do formato esperado.
 * Devolve a função que para de ouvir.
 */
export function onHostMessage<T>(isValid: (data: unknown) => data is T, handler: (message: T) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== window.origin) return;
    if (isValid(event.data)) handler(event.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** Liga/desliga animações conforme a configuração recebida da extensão. */
export function applyMotion(motion: string): void {
  document.body.dataset.motion = motion;
}
