# MCP do Acervo

O Acervo expõe um servidor **MCP via stdio** para que agentes de IA possam pesquisar, criar playlists e controlar a reprodução da versão Web.

## Como funciona

- As ferramentas de biblioteca, busca, playlists e downloads usam a API local do Acervo.
- Os comandos de reprodução entram numa fila local. A aba Web aberta em `http://127.0.0.1:4310` consulta essa fila e executa **play, pause, resume, next, previous, seek e stop**.
- Se nenhuma aba Web estiver aberta, os comandos ficam pendentes; abra o Acervo para executá-los.
- Por segurança, os endpoints `/api/mcp/*` só aceitam requisições com host local (`127.0.0.1` ou `localhost`). O MCP não é exposto pelo relay público.

## Configuração

### Codex / Claude Code / clientes MCP via stdio

```json
{
  "mcpServers": {
    "acervo": {
      "command": "node",
      "args": ["C:\\caminho\\para\\acervo\\mcp\\acervo-mcp.mjs"],
      "env": { "ACERVO_URL": "http://127.0.0.1:4310" }
    }
  }
}
```

### Claude Desktop

Use o mesmo bloco em `claude_desktop_config.json` e reinicie o aplicativo.

## Ferramentas

- `acervo_status` — tocando agora, fila, aparelhos e pendências.
- `acervo_search` — busca no YouTube.
- `acervo_library` — músicas baixadas.
- `acervo_play` — toca uma faixa por `trackId` ou busca na aba Web.
- `acervo_play_phone` — envia faixa ou playlist para o celular ativo.
- `acervo_phone_control` — pause, resume, next, previous, seek e toggle no celular.
- `acervo_control` — pause, resume, stop, next, previous, seek.
- `acervo_playlists` — lista playlists.
- `acervo_play_playlist` — toca uma playlist baixada.
- `acervo_create_playlist` — cria playlist com faixas.
- `acervo_import_playlist` — importa playlist/faixa do Spotify ou YouTube.
- `acervo_download` — baixa por URL, `videoId` ou busca.
- `acervo_search_download` — pesquisa e baixa o primeiro resultado em uma chamada.
- `acervo_queue` — mostra a fila do aparelho com títulos e posição.
- `acervo_job` — acompanha um download.

## Recursos de contexto

O MCP também expõe recursos para o cliente anexar contexto sem gastar uma chamada de ferramenta:

- `acervo://now-playing` — aparelho ativo, faixa, fila, posição e diagnóstico.
- `acervo://playlists` — playlists e progresso.
- `acervo://library` — músicas baixadas.

## Exemplo de conversa

> Pesquise "Daft Punk Something About Us", baixe a primeira versão, crie a playlist "French House" com ela e coloque para tocar.

O agente chama `acervo_search`, `acervo_download`, espera o `acervo_job`, cria a playlist com `acervo_create_playlist` e envia `acervo_play_playlist`.

## Limitações

- O navegador pode exigir uma interação do usuário antes de liberar áudio; depois disso os comandos seguem normalmente.
- O MCP controla a **aba Web** e o **celular conectado**; o celular precisa estar com o app ativo e conectado.
- Os arquivos e a biblioteca continuam no PC.
