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
