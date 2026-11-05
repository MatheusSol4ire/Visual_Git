# Visual Git

Uma extensão para o VS Code que mostra o histórico de commits do seu projeto de forma visual: simples para quem está começando e bonita para o dia a dia.

> 🚧 **Em desenvolvimento.** A fase 1 foca no repositório local: grafo de commits, branches e detalhes de cada commit. A integração com o GitHub vem depois.

## Como usar

1. Abra a pasta de um projeto que usa Git no VS Code.
2. Abra a paleta de comandos (`Ctrl+Shift+P`) e rode **Visual Git: Abrir**.

### Animações

As animações podem ser ligadas ou desligadas em **Configurações → Visual Git → Animations**:

| Valor | Comportamento |
|---|---|
| `auto` (padrão) | Segue o `workbench.reduceMotion` do VS Code e a preferência do sistema |
| `on` | Sempre ligadas |
| `off` | Sempre desligadas |

## Desenvolvendo

Requisitos: [Node.js](https://nodejs.org) 22 ou mais novo, [Git](https://git-scm.com) e o VS Code.

```bash
npm install        # instala as dependências
npm run check      # verificação de tipos e testes
```

- **Testar:** aperte `F5` no VS Code. Abre uma segunda janela com a extensão carregada.
- **Editar com recarga rápida:** deixe `npm run watch` rodando num terminal e, na janela de teste, use `Ctrl+R` para recarregar.
- **Gerar o instalável:** `npm run package` cria um arquivo `visual-git-<versão>.vsix`.
- **Instalar o `.vsix`:** `code --install-extension visual-git-<versão>.vsix`

### Estrutura

```
src/
  extension.ts          ponto de entrada da extensão
  settings.ts           leitura das configurações
  git/                  leitura do Git (sem nada de tela)
  panel/                a aba do Visual Git e a ponte com a tela
  shared/protocol.ts    tipos das mensagens entre extensão e tela
webview/                a tela (Preact), roda isolada dentro do VS Code
```

## Privacidade

O Visual Git só lê o repositório que está aberto, usando o Git instalado na sua máquina. Nenhum dado é enviado para a internet.

## Licença

[MIT](LICENSE)
