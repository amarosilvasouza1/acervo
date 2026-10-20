# O PC como servidor privado do Acervo

O computador pode hospedar a biblioteca e atender o telefone pareado. A autorização do aparelho e a criptografia protegem os pedidos ao Acervo. A API disponibiliza a biblioteca, o áudio e os controles do aplicativo; ela não oferece compartilhamento geral de pastas, área de trabalho remota ou um terminal.

O QR transmite a identidade pública do PC e uma autorização temporária de pareamento. O telefone apresenta sua própria identidade criptográfica; o PC guarda a identidade pública autorizada e recusa outro telefone até o proprietário remover a conexão. A chave privada do PC permanece no PC e a chave privada do telefone permanece no telefone. Não se deve copiar uma chave privada permanente para um QR: a pessoa que fotografasse o código também teria essa chave.

Essas garantias dependem de manter os aparelhos e seus backups privados. O usuário do sistema operacional, um administrador ou um programa com acesso às pastas privadas do app pode ler os dados locais. Executar `node server.js` normalmente no Windows não cria uma caixa isolada do restante do computador: o processo continua com as permissões da conta que o iniciou.

## Limites dos arquivos atendidos

O servidor confere os caminhos dos arquivos públicos, capas e áudio antes de abri-los. Arquivos fora da pasta autorizada, pastas com o mesmo prefixo, diretórios, links simbólicos e junções são recusados. A leitura usa um descritor validado; em sistemas que oferecem `O_NOFOLLOW`, essa opção impede seguir um link simbólico no arquivo final. IDs recebidos pela API também precisam ser validados antes de formar caminhos de download.

Isso protege a fronteira da API. Não transforma uma conta Windows comum em uma sandbox. A implementação assume que outro processo local não está substituindo continuamente as pastas autorizadas enquanto o servidor as abre. O perfil de contêiner abaixo reduz as pastas e permissões disponíveis ao processo.

## Perfil opcional para Docker Engine no Linux

O arquivo `deploy/compose.local-isolated.yaml` prepara um contêiner local com:

- Processo sem privilégios de administrador, raiz somente para leitura, nenhuma capability Linux e bloqueio de ganho de privilégios.
- Um volume próprio para `/app/data`, sem montar Documentos, Downloads, a pasta pessoal, o projeto ou o socket do Docker.
- Temporários com tamanho limitado, sem execução, e limites de memória, CPU, processos e logs.
- Interface administrativa HTTP em `127.0.0.1:4310` e conexão HTTPS do APK em `0.0.0.0:4311`.

Esse perfil usa a rede do host para preservar o endereço de loopback real. Não confia em cabeçalhos de proxy nem considera toda a rede Docker como proprietária do servidor. Ele separa arquivos e processos, mas compartilha a rede com o PC; portanto, não oferece isolamento dos serviços de rede locais. O Docker documenta essa diferença entre [isolamento do contêiner](https://docs.docker.com/engine/security/) e [rede do host](https://docs.docker.com/engine/network/drivers/host/).

Em um computador Linux com Docker Engine e Compose instalados, execute na raiz do projeto:

```sh
docker compose -f deploy/compose.local-isolated.yaml config --quiet
docker compose -f deploy/compose.local-isolated.yaml up -d --build
```

Abra `http://127.0.0.1:4310` no próprio computador. O volume começa com uma biblioteca separada e guarda músicas, identidade e pareamentos; ele não importa automaticamente a pasta `data` da instalação normal. Mantenha esse volume e seus backups privados. Para parar preservando os dados:

```sh
docker compose -f deploy/compose.local-isolated.yaml down
```

O perfil foi validado pelo analisador de configuração do Compose, mas o contêiner não foi compilado nem executado nesta sessão Windows. Não há instalador de sandbox Windows incluído. Embora versões recentes do Docker Desktop ofereçam uma opção de rede do host, isso não confirma as mesmas propriedades de endereço e descoberta deste perfil Linux.

## Acesso por outra rede

Criptografia e autorização não criam uma rota pela internet. Para o telefone alcançar diretamente o PC fora de casa, o endereço anunciado pelo Acervo precisa ser alcançável e a rede precisa permitir a conexão HTTPS. CGNAT ou regras do provedor podem impedir a conexão direta, mesmo com o pareamento correto. Este perfil não altera roteador, firewall, portas públicas ou serviços de terceiros.

Se já existir um endereço público que encaminhe TLS diretamente à porta HTTPS deste PC, configure `ACERVO_PUBLIC_ENDPOINT` antes de iniciar o Compose. Exemplo de formato: `https://seu-endereco.example:4311`. Essa variável adiciona o endereço ao QR e à validação do servidor; não registra domínio, não descobre o IP público e não cria encaminhamento de portas. Para manter o PC e o telefone como únicas pontas criptográficas, o TLS precisa terminar no próprio Acervo, sem um proxy de terceiros descriptografando a conexão.

O PC precisa permanecer ligado e conectado para atender o telefone. O modo independente do APK continua usando a própria conexão do celular e seus arquivos locais quando o PC está desligado.

## Verificação

`node --test tests/isolation-tests.mjs` usa apenas arquivos temporários e verifica leitura normal, travessia de diretórios, prefixos semelhantes, arquivos ausentes, diretórios e links. As junções foram verificadas no Windows. O caso de link simbólico de arquivo é marcado como indisponível quando a conta não tem a permissão exigida pelo Windows.
