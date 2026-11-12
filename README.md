# Visual Git

Extensão para o VS Code que mostra o histórico de commits de um projeto como um desenho: cada commit é uma bolinha, cada branch é uma linha colorida, e dá para clicar em tudo.

A ideia é que alguém que está aprendendo Git consiga olhar e entender o que aconteceu no projeto, sem decorar comando nenhum.

<!-- Coloque aqui um print ou GIF da extensão funcionando, ex.: ![Visual Git](imagens/visual-git.png) -->

> Em desenvolvimento. Por enquanto funciona com o repositório local; a integração com o GitHub vem depois.

## O que ela faz

- Lista os commits na barra lateral com o grafo das branches ao lado.
- A branch principal (`main`) fica sempre na primeira linha, à esquerda. As outras saem dela e voltam quando são juntadas.
- Clicar num commit abre uma aba com a mensagem completa, o autor, a data e os arquivos que mudaram.
- Clicar num arquivo abre o "antes e depois" no editor de diferenças do próprio VS Code.
- Clicar na etiqueta de uma branch acende só o caminho dela e apaga o resto.
- Mostra quantos commits uma branch tem que ainda não foram para a `main` (e vice-versa).
- Se atualiza sozinha quando você faz um commit, troca de branch ou baixa novidades.

Tudo roda no seu computador, usando o Git que já está instalado. Nada é enviado para a internet.

## Como usar

1. Abra no VS Code uma pasta que usa Git.
2. Clique no ícone do Visual Git na barra lateral, ou rode **Visual Git: Mostrar histórico de commits** em `Ctrl+Shift+P`.
3. Clique nos commits, nos arquivos e nas etiquetas.

Pelo teclado: `↑` `↓` escolhem um commit, `Enter` abre e `Esc` limpa o destaque.

### Como ler o desenho

| No desenho | Quer dizer |
|---|---|
| Bolinha cheia | Um commit |
| Bolinha vazada | Um merge (duas linhas de trabalho se juntando) |
| Anel em volta da bolinha | O commit em que você está agora |
| Etiqueta com nuvem | Branch que está no servidor (ex.: GitHub) |
| Etiqueta com marcador | Uma versão (tag) |
| "3 fora da main" | Commits desta branch que ainda não entraram na principal |

### Configurações

- **Visual Git › Animations**: `auto` (segue o "Reduzir movimento" do VS Code), `on` ou `off`.
- **Visual Git › Parent Folder Repos**: o que fazer quando o Git do projeto está numa pasta acima da que você abriu. O padrão é perguntar antes.

## Rodando o código

Precisa de [Node.js](https://nodejs.org) 22.18 ou mais novo, [Git](https://git-scm.com) e o VS Code.

```bash
npm install
npm run check     # confere os tipos e roda os testes
```

Depois aperte `F5` no VS Code: abre uma segunda janela com a extensão carregada. Para gerar o instalável, `npm run package` cria um `visual-git-<versão>.vsix`.

## Como funciona por dentro

A extensão tem duas partes que conversam por mensagens: o lado que roda dentro do VS Code e chama o Git (pasta [`src/`](src/)), e as telas, que são pequenas páginas web desenhadas com Preact (pasta [`webview/`](webview/)).

O grafo é calculado em [`webview/graph/layout.ts`](webview/graph/layout.ts): cada coluna "espera" pelo commit pai de quem a abriu, e quando esse pai aparece as linhas se juntam nele. A branch principal tem a primeira coluna reservada.

O Git é sempre executado pelo caminho absoluto (nunca um `git.exe` de dentro do projeto aberto), e a extensão fica desligada em pastas que o VS Code ainda não marcou como confiáveis.

## Licença

[MIT](LICENSE)
