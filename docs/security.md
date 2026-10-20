# Proteção da conexão PC e Android

O Acervo 1.5.0 usa HTTPS com autenticação mútua entre o APK e o PC no modo local. O computador guarda uma chave EC P-256 e um certificado em `data/identity`. O telefone cria uma chave EC P-256 própria no Android Keystore, sem exportar a chave privada. O PC autoriza a identidade pública de um único celular e a mantém em `data/paired-phone.json`.

O QR contém um convite temporário de uso único e o SHA-256 da chave pública do PC (SPKI). Ele não contém a chave privada do computador nem a do celular. O convite ainda é confidencial: alguém que escaneá-lo antes do proprietário pode tentar ocupar o vínculo. Leia o QR diretamente na tela do seu PC e confira as identidades em **Dispositivos** no PC e **Proteção** no APK.

O transporte nativo verifica a identidade do PC e a validade do certificado antes de enviar cookies ou dados. O PC exige que o cliente TLS prove posse da chave privada correspondente à identidade autorizada. Um cookie copiado, o endereço do servidor ou a identidade pública, isoladamente, não autorizam outro cliente. O TLS aceita a apresentação inicial de uma identidade ainda não cadastrada para o pareamento; a autorização das APIs privadas ocorre pela identidade conferida na aplicação. Permite TLS 1.2 ou superior, recusa redirecionamentos e não altera a validação SSL global.

Biblioteca, controles, sincronização, imagens locais, rádio em streaming e áudio usam esse transporte. O WebView encaminha os pedidos ao cliente nativo, incluindo POST com resposta em streaming e cancelamento. O manifesto recusa HTTP. Os cookies continuam HttpOnly, SameSite=Strict e Secure. O QR expira em cinco minutos e seu código temporário não fica salvo.

O vínculo sobrevive ao reinício do servidor enquanto os arquivos de identidade do PC e a chave do APK forem preservados. Outro celular é recusado até o proprietário remover o aparelho autorizado pelo próprio PC. Uma chave diferente exige novo pareamento; arquivos de identidade inválidos bloqueiam a conexão, sem substituição silenciosa. Reinstalar o APK ou restaurar seus dados sem a chave do Android Keystore exige remover o vínculo antigo no PC e escanear um novo QR.

O QR local deve ser lido no APK atualizado. Navegadores comuns não apresentam a identidade privada do app; não é necessário ignorar alertas nem instalar certificados globais no telefone. Para migrar da versão 1.4.0, atualize PC e APK, reinicie o servidor e faça esse novo pareamento uma vez.

## Portas e acesso pela internet

A janela do navegador no próprio PC usa HTTP de loopback, por padrão em `127.0.0.1`, definido por `ACERVO_HTTP_HOST`. O listener HTTPS do telefone usa `ACERVO_HTTPS_HOST`, por padrão o endereço de `ACERVO_HOST`. A porta HTTPS local é a HTTP + 1 e pode ser ajustada em `ACERVO_HTTPS_PORT`. APIs remotas em HTTP são recusadas. O primeiro início requer OpenSSL (`OPENSSL_BIN` permite escolher o executável).

`ACERVO_PUBLIC_ENDPOINT` pode anunciar um endereço HTTPS público que encaminhe a conexão diretamente ao PC. A identidade mútua continua obrigatória nesse endereço. O TLS precisa terminar no Acervo do próprio PC para preservar somente os dois aparelhos como pontas criptográficas. Um proxy que termine HTTPS passa a ser outra ponta confiada e não substitui esse modo direto.

Configurar o endereço não publica o PC, não abre portas e não atravessa NAT ou CGNAT. O roteamento até a porta HTTPS precisa existir; o provedor pode impedir uma conexão direta. O computador deve ficar ligado para atender o telefone. A busca, o download e a reprodução independentes do APK continuam funcionando pela própria internet do celular.

## Limites e armazenamento

Essa implementação usa TLS com identidades pareadas por QR; não implementa Signal Protocol, Double Ratchet ou o protocolo do WhatsApp. O PC é uma das pontas e lê a biblioteca e o áudio para atendê-los. O modo `cloud` mantém seu modelo separado de senha/sessão e validação HTTPS do sistema; a exclusividade de um celular descrita aqui se aplica ao modo local com mTLS.

As músicas offline ficam na área privada do APK, sem uma nova camada de criptografia dos arquivos. As chaves privadas protegem a comunicação, mas não impedem o proprietário ou um administrador do sistema de ler os dados locais. Preserve `data/identity` e `data/paired-phone.json` em backups privados e exclua-os das releases.

Executar Node normalmente no Windows mantém as permissões da conta: não cria isolamento do restante do sistema operacional. O servidor limita as rotas e os arquivos disponibilizados pela API, bloqueando caminhos externos e links. O perfil opcional de contêiner Linux restringe arquivos, processos e privilégios; seus limites estão em [Isolamento do Acervo](isolation.md).

Testes: `npm test`, `npm run test:tls`, `android/tests/run-secure-tests.ps1` e `node --test android/tests/native-transport-tests.mjs`. Usam dados temporários para validar identidades, chave trocada, certificado vencido, cookies, QR, exclusividade, persistência, revogação, limites dos arquivos, áudio parcial, streaming e cancelamento. A política do Android Keystore tem testes de JVM; armazenamento protegido por hardware e comportamento em aparelho real ainda precisam de verificação no dispositivo.

Referências: [segurança de rede no Android](https://developer.android.com/privacy-and-security/security-ssl), [TLS no Node.js](https://nodejs.org/api/tls.html).
