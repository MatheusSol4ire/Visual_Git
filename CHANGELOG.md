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
- Mais rápido em repositórios grandes: comparação de todas as branches com a principal de uma vez, menos processos
  do Git por página, arquivos e linhas de um commit lidos num só comando, e pedidos antigos cancelados.
- Commits com mais de 1000 arquivos abrem rápido (sem contar linhas); o total "+N −M" soma todos os arquivos do commit.
- Casos raros corrigidos: tag com o mesmo nome da branch, arquivo com TAB no nome, título de commit com várias linhas,
  pasta com espaço no fim do nome, repositório na raiz de um disco, Git antigo e repositórios no formato reftable.
- Segurança: o Git de reserva nunca é um executável de dentro da pasta aberta; regras mais restritas nas telas da
  extensão; caracteres invisíveis que invertem o texto aparecem como código (ex.: `<U+202E>`) em nomes e caminhos.
- Arquivos cujo nome começa com ".." (ex.: `..env.example`) abrem no editor de diferenças.
- A aba de detalhes leva o assunto do commit no título; "Código do commit copiado" ao copiar.
- Comando "Visual Git: Mostrar histórico de commits" e opções das configurações com nomes em português.
- Grafo mais leve na rolagem, linhas sem emendas visíveis e largura que acompanha o trecho visível.
- Nomes longos de branch ficam com "…"; etiquetas da aba de detalhes quebram linha em abas estreitas.
- Alto contraste: a linha aberta continua marcada mesmo sem foco na lista.
- Textos mais claros para quem não conhece Git: commit fora de uma branch, destaque de branch, merges, lista vazia
  (com botão para abrir o Controle do Código-Fonte), branch apagada no filtro e o "N fora da main" depois de Squash/Rebase.
- Tempo relativo que se atualiza sozinho e segue o calendário ("ontem", "há 1 mês"); datas no mesmo formato em toda parte
  e números grandes com ponto ("1.834 arquivos").
- Leitor de tela: posição na lista, tipo de cada etiqueta, aviso de carregamento e confirmação de cópia ("Copiado!").
- Requer Node 22.18 ou mais novo para compilar.
