import { useEffect, useState } from 'preact/hooks';

/** De quanto em quanto tempo os textos "há N minutos" são refeitos. */
const TICK = 60_000;

/**
 * Hora atual que muda a cada minuto, para "agora mesmo"/"há 5 minutos" não ficarem parados com a tela
 * aberta. Parado enquanto a tela está escondida; ao voltar, atualiza na hora.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => clearInterval(timer);
    const start = () => {
      stop();
      if (!document.hidden) timer = setInterval(() => setNow(Date.now()), TICK);
    };
    const onVisibility = () => {
      if (!document.hidden) setNow(Date.now());
      start();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return now;
}
