// Título da aba de detalhes. Separado do CommitDetailsPanel para ser testado sem o VS Code.

/** Tamanho máximo do título (o VS Code não corta: um assunto longo deixaria a aba enorme). */
const MAX_TITLE = 40;

/**
 * O assunto do commit diz mais a um leigo do que o código ("1a2b3c4"), que continua dentro da página.
 * Assunto vazio: "Commit 1a2b3c4".
 */
export function detailsTabTitle(subject: string, hash: string): string {
  const text = subject.replace(/\s+/g, ' ').trim();
  if (!text) return `Commit ${hash.slice(0, 7)}`;
  // Array.from: conta emojis e acentos combinados sem partir um caractere ao meio.
  const chars = Array.from(text);
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join('').trimEnd()}…` : text;
}
