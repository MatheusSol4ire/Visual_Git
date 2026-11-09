// "memo" sem o preact/compat: um componente que só redesenha quando alguma propriedade muda.
import { Component, type ComponentChild } from 'preact';

/** Mesmas chaves e mesmos valores (comparados com `Object.is`, sem entrar em objetos). */
export function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]));
}

/**
 * Envolve um componente de função: ele só é desenhado de novo quando alguma propriedade muda
 * (por referência). Só vale a pena se quem usa passar objetos e funções estáveis (useMemo/useCallback);
 * um objeto ou uma função nova a cada desenho faz ele redesenhar sempre.
 */
export function memo<P extends object>(render: (props: P) => ComponentChild, name = render.name) {
  class Memo extends Component<P> {
    static displayName = `memo(${name})`;
    override shouldComponentUpdate(next: P): boolean {
      return !shallowEqual(this.props, next);
    }
    override render(props: P) {
      return render(props);
    }
  }
  return Memo;
}
