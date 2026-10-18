# Acervo em um servidor independente

Este pacote permite manter uma biblioteca central acessivel por HTTPS com o PC de casa desligado. E uma opcao adicional: exige um servidor Linux proprio, dominio e armazenamento persistente. Os arquivos foram preparados localmente; nenhum servidor foi contratado e nenhuma publicacao foi feita.

O APK e os navegadores conectados usam o mesmo endereco do servidor. Para pesquisar e importar novas musicas nessa modalidade, o servidor precisa continuar funcionando e ter acesso aos servicos de busca. O modo **Usar neste celular** do APK 1.2.0 ja pesquisa e baixa usando apenas a internet do telefone, e toca os arquivos salvos sem PC ou hospedagem. A nuvem e opcional para manter uma biblioteca central conectada.

## Subir o servidor

No servidor, instale Docker Engine com o plugin Compose, copie o projeto e aponte o DNS do seu dominio para ele. Libere as portas TCP 80 e 443. A porta UDP 443 e opcional para HTTP/3. A porta interna 4310 nao e publicada pelo Compose.

Na pasta do projeto, em um terminal Bash:

```bash
cp deploy/cloud.env.example deploy/cloud.env
chmod 600 deploy/cloud.env
```

Edite `deploy/cloud.env` com um hostname real, por exemplo `musica.seudominio.com`, e uma senha unica com pelo menos 16 caracteres. Mantenha a senha entre aspas simples caso contenha `$` ou `#`. O arquivo real e ignorado pelo Git e excluido do contexto de build. Nao envie esse arquivo junto com capturas ou relatorios.

```bash
docker compose --env-file deploy/cloud.env config --quiet
docker compose --env-file deploy/cloud.env build --pull
docker compose --env-file deploy/cloud.env up -d
docker compose --env-file deploy/cloud.env ps
```

Abra `https://SEU_DOMINIO` e entre com a senha configurada para administrar o servidor e gerar o QR de pareamento. No APK, escaneie esse QR ou informe o endereco HTTPS. PC e celular precisam acessar a mesma biblioteca no servidor para compartilhar fila e reproducao. A biblioteca mantida em `localhost` e outra instalacao.

O Caddy emite o certificado HTTPS automaticamente quando o DNS e as portas estao corretos. A configuracao preserva o hostname e transmite os eventos de radio e dispositivos imediatamente. O processo Acervo executa como usuario `node`, sem privilegios de root, com sistema de arquivos somente leitura e escrita limitada ao volume de dados e aos temporarios.

## Trazer a biblioteca atual sem substituir dados

Finalize importacoes pendentes e feche o servidor local antes de copiar a pasta `data`, para obter uma copia consistente. Ela inclui `library.json`, audios, capas, historico e arquivos de conexao. Nao e preciso copiar `node_modules`, o Android SDK ou as chaves de assinatura.

Copie essa pasta por um meio privado para `/srv/acervo-migration/data` no servidor. Antes do primeiro uso, ou usando um volume de dados novo:

```bash
docker compose --env-file deploy/cloud.env stop caddy acervo
docker compose --env-file deploy/cloud.env run --rm --no-deps \
  --volume /srv/acervo-migration/data:/import:ro \
  acervo node deploy/import-data.mjs /import
docker compose --env-file deploy/cloud.env up -d
```

O importador recusa links simbolicos, pastas sobrepostas e qualquer destino que ja contenha arquivos. Ele nunca substitui um arquivo existente. Se a execucao for interrompida no meio, preserve o volume parcial para inspecao e repita em um volume novo. O arquivo original no computador permanece intacto. O pareamento pode precisar ser feito novamente ao mudar de endereco.

## Dados, backup e atualizacoes

O volume `acervo_data` guarda a biblioteca inteira, incluindo musicas e sessoes. `caddy_data` guarda certificados e chaves TLS; `caddy_config` guarda o estado do proxy. Os volumes sobrevivem a reinicios, recriacao de containers e atualizacoes da imagem. Nao use `docker compose down --volumes` para atualizar: esse comando remove os dados.

Para um backup consistente da biblioteca, no servidor:

```bash
mkdir -p deploy/backups
chmod 700 deploy/backups
backup_file="deploy/backups/acervo-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
test ! -e "$backup_file" || exit 1
docker compose --env-file deploy/cloud.env stop caddy acervo
docker compose --env-file deploy/cloud.env run --rm --no-deps \
  acervo tar -C /app/data -czf - . > "$backup_file"
chmod 600 "$backup_file"
docker compose --env-file deploy/cloud.env up -d
```

Guarde uma copia privada fora desse servidor. O backup pode conter sessoes de acesso; trate-o como dado pessoal. Para restaurar, extraia em uma pasta separada e use o importador com um volume vazio. Guarde tambem `deploy/cloud.env` e uma copia do volume `caddy_data` em local privado.

Para atualizar o codigo e as imagens, mantendo os volumes:

```bash
docker compose --env-file deploy/cloud.env build --pull
docker compose --env-file deploy/cloud.env pull caddy
docker compose --env-file deploy/cloud.env up -d
```

A imagem usa a linha Node 24 LTS, Python em ambiente virtual, ffmpeg/ffprobe e `yt-dlp[default]` fixado em `2026.8.19`, com o resolvedor JavaScript EJS. Atualize essa versao em `deploy/requirements.txt` e reconstrua a imagem quando o YouTube exigir correcoes; nao e necessario apagar a biblioteca. A base Node acompanha correcoes da linha 24 ao reconstruir com `--pull`.

## Verificacao e limites

O endpoint `GET /healthz` e usado pelo healthcheck sem abrir a biblioteca. Confira o estado com `docker compose --env-file deploy/cloud.env ps`. Para diagnosticar a inicializacao, use `docker compose --env-file deploy/cloud.env logs --tail=100 acervo caddy`; evite publicar logs que contenham informacoes pessoais.

Este pacote nao oferece um endereco publico por conta propria. Acesso remoto real depende da configuracao e disponibilidade do servidor, DNS e certificado. Alguns provedores ou o YouTube podem limitar buscas e downloads vindos de datacenters. Os arquivos ja importados continuam no volume mesmo quando uma nova busca falha.

Referencias oficiais usadas na configuracao: [imagem Node e linhas LTS](https://github.com/nodejs/docker-node), [dependencias do yt-dlp](https://github.com/yt-dlp/yt-dlp#dependencies), [imagem Caddy](https://hub.docker.com/_/caddy) e [proxy e streaming do Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
