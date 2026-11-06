# Visual Git

Uma extensão para o VS Code que mostra o histórico de commits do seu projeto de forma visual: simples para quem está começando e bonita para o dia a dia.

> 🚧 **Em desenvolvimento.** A fase 1 foca no repositório local: grafo de commits, branches e detalhes de cada commit. A integração com o GitHub vem depois.

## Como usar

1. Abra a pasta de um projeto que usa Git no VS Code.
2. Clique no ícone do **Visual Git** na barra lateral (ou rode **Visual Git: Abrir** pela paleta de comandos, `Ctrl+Shift+P`).
3. Clique num commit para ver os detalhes: mensagem completa, autor, data e arquivos alterados.
4. Clique num arquivo para ver o **antes e depois** dele.

A lista se atualiza sozinha quando você faz um commit, troca de branch ou baixa novidades do servidor.

| Elemento | Significado |
|---|---|
| Bolinha cheia | Um commit |
| Bolinha vazada | Uma junção (merge) de duas linhas de trabalho |
| Anel em volta da bolinha | O commit onde você está agora |
| Etiqueta destacada | A branch em que você está |
| Etiqueta com nuvem | Branch que está no servidor (ex.: GitHub) |
| Etiqueta com marcador | Versão (tag) |

Navegação pelo teclado: `↑` `↓` para escolher, `Enter` para abrir.

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
src/                    roda dentro do VS Code (Node)
  extension.ts          ponto de entrada da extensão
  settings.ts           leitura das configurações
  git/                  leitura do Git (sem nada de tela)
  repo/                 qual repositório está aberto e quando ele muda
  views/                barra lateral, aba de detalhes e a ponte com as telas
  shared/protocol.ts    tipos das mensagens entre extensão e telas
webview/                as telas (Preact), rodam isoladas dentro do VS Code
  commits/              lista de commits da barra lateral
  details/              aba de detalhes do commit
  graph/                cálculo e desenho do grafo
  shared/               peças usadas pelas duas telas
  styles/               visual (cores, animações)
```

## Privacidade

O Visual Git só lê o repositório que está aberto, usando o Git instalado na sua máquina. Nenhum dado é enviado para a internet.

## Segurança

- O Git é sempre executado pelo caminho absoluto: o mesmo que a extensão Git do VS Code usa ou, na falta dela, o encontrado no PATH. Um `git.exe` colocado dentro de um projeto nunca é executado.
- A extensão só funciona em pastas marcadas como confiáveis (fica desativada no Modo Restrito do VS Code).

## Licença

[MIT](LICENSE)
