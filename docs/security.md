# Proteção da conexão PC e Android

O Acervo 1.4.0 usa HTTPS/TLS entre o APK e o Acervo conectado. No modo local, o computador guarda uma chave EC P-256 e um certificado em `data/identity`. O QR contém um código de pareamento temporário e o SHA-256 da chave pública (SPKI). O APK recebe essa identidade pelo QR, não pela rede, e a salva vinculada ao endereço e à porta.

O transporte nativo verifica a chave e a validade do certificado antes de enviar cookies ou dados. Permite TLS 1.2 ou superior, recusa redirecionamentos e não altera a validação SSL global. Uma chave diferente exige desparear e conferir um novo QR. Identidade corrompida no PC impede a inicialização, sem substituição silenciosa da chave.

Biblioteca, controles, sincronização, imagens locais, rádio em streaming e áudio usam esse transporte. O WebView encaminha os pedidos ao cliente nativo, incluindo POST com resposta em streaming e cancelamento. O manifesto recusa HTTP. A sessão usa cookie HttpOnly, SameSite=Strict e Secure; o QR é de uso único, expira em cinco minutos e seu código temporário não fica salvo. Reiniciar o servidor local exige novo QR, preservando a identidade do PC.

Compare o código em **Conectar dispositivos** no PC com **Proteção** no APK. O QR local deve ser lido no APK, pois navegadores comuns não têm a identidade pareada. Não é necessário ignorar alertas nem instalar certificados globais no telefone.

Esta implementação usa TLS autenticado pelo QR, sem implementar Signal Protocol, Double Ratchet ou o protocolo do WhatsApp. O computador/servidor conectado é uma das pontas e lê a biblioteca e o áudio para atendê-los. Em hospedagem HTTPS pública, o Android usa a validação de certificado e domínio do sistema; um proxy HTTPS também faz parte da infraestrutura confiada. As músicas offline ficam na área privada do app, sem uma nova camada de criptografia de arquivos.

Para migrar, atualize PC e APK, reinicie o servidor e gere um novo QR. O navegador do próprio PC continua usando HTTP de loopback; APIs pela rede sem TLS são recusadas. A porta HTTPS local é a HTTP + 1 e pode ser ajustada em `ACERVO_HTTPS_PORT`. O primeiro início requer OpenSSL (`OPENSSL_BIN` permite escolher o executável). Preserve `data/identity` no backup privado e exclua-a das releases.

Testes: `npm test`, `npm run test:tls`, `android/tests/run-secure-tests.ps1` e `node --test android/tests/native-transport-tests.mjs`. Usam dados temporários para validar chave trocada, certificado vencido, cookies, QR, revogação, áudio parcial, streaming e cancelamento.

Referências: [segurança de rede no Android](https://developer.android.com/privacy-and-security/security-ssl), [TLS no Node.js](https://nodejs.org/api/tls.html).
