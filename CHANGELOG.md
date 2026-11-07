# Changelog

## 0.0.1 (em desenvolvimento)

- Estrutura inicial da extensão.
- Leitura dos commits do repositório local (todas as branches, tags e remotos).
- Ícone próprio na barra lateral com a lista de commits e o grafo (curvas suaves, cores por branch).
- Avatares com iniciais, etiquetas de branch/tag/remoto e destaque do commit atual.
- Aba de detalhes: mensagem completa, autor, data, commits anteriores e arquivos alterados.
- Clique num arquivo para ver o "antes e depois" no editor de diferenças do VS Code.
- Atualização automática ao fazer commit, trocar de branch ou fazer fetch.
- Lista virtualizada com carregamento progressivo (aguenta milhares de commits).
- Navegação pelo teclado na lista.
- Configuração `visualGit.animations` para ligar ou desligar animações.
- Segurança: Git executado por caminho absoluto e extensão desativada em pastas não confiáveis.
- Branch principal fixa no primeiro trilho do grafo; cada branch segue no próprio trilho até o commit de onde saiu.
- Etiqueta "N fora da main" na ponta das branches e aviso no topo sobre a branch atual.
- Destacar o caminho de uma branch clicando na etiqueta dela.
- Filtro "Mostrar": todas as branches, a sua com a principal, ou uma escolhida.
- Aba de detalhes mostra se o commit já está na principal e em quais branches ele aparece.
- Lista e aba de detalhes voltam ao mesmo lugar (filtro, seleção, destaque, rolagem) ao trocar de área ou de aba.
- Aba de detalhes se atualiza sozinha depois de merge, sync ou do botão Atualizar.
- Telas de erro com "Tentar de novo" e "Mostrar todas as branches"; link para baixar o Git quando ele não é encontrado.
- Mensagens de erro em português claro (pasta que sumiu, pasta sem permissão, comando que demorou demais).
- Git numa pasta acima da aberta: pergunta antes de mostrar (configuração `visualGit.parentFolderRepos`).
- `git init` feito depois de abrir a pasta aparece sozinho; submódulos mostram a troca de versão em vez de um diff quebrado.
- Commits além do 10º trilho do grafo continuam com a bolinha (parte do desenho é recolhida à direita).
- Contraste melhor no tema claro e anel de foco visível na lista ao usar o teclado.
- Robustez: grafo correto com `log.showSignature` ligado, refs internas fora da lista, prazo para cada comando do Git,
  clone parcial sem internet, branch órfã no filtro e respostas fora de ordem descartadas.
- Pacote da extensão sem source maps e com build de produção automático antes de publicar.
