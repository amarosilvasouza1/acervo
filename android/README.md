# Acervo para Android

O APK instala o Acervo como aplicativo no Android 8.0 ou superior. Ele abre direto no **Início**, sem passar pelo leitor de QR, e lembra o último modo usado: o Acervo do PC ou a biblioteca do celular. Para pesquisar, baixar e ouvir usando apenas a internet do telefone, use o modo do celular. Nao exige computador ligado, mesma rede Wi-Fi, servidor ou assinatura de hospedagem.

As musicas baixadas ficam na area privada do aplicativo e aparecem em **Biblioteca**, disponiveis mesmo sem internet. **Buscar** encontra musicas, artistas e links do YouTube; **Radio** busca sugestoes atuais a partir de uma musica escolhida ou da mais recente. A pesquisa e os novos downloads precisam de internet no celular. A reproducao continua em segundo plano, com play/pause e proxima na notificacao. No modo Radio, a proxima musica e baixada enquanto a atual toca. Desinstalar o aplicativo tambem apaga sua biblioteca local; atualizar usando a mesma assinatura preserva os dados.

O painel **Conexões** permite abrir o leitor de QR ou escolher **Usar neste celular**. Depois de autenticar o PC, o aplicativo lembra a conexão e abre sua página inicial nas próximas entradas. Enderecos locais ou tuneis ate o computador dependem dele ligado; uma instalacao hospedada na nuvem pode funcionar com ele desligado. HTTPS exige a verificação da identidade; o aplicativo nao ignora erros de certificado.

A sincronizacao de bibliotecas e manual: depois de parear e conectar ao outro Acervo, use **Sincronizar bibliotecas**. O aplicativo compara os identificadores e mostra quantas musicas faltam em cada aparelho antes de continuar. O celular baixa sua propria copia pela internet; o computador recebe pedidos para baixar as que faltam nele. Nenhuma musica e apagada do outro aparelho. Essa etapa exige que o outro Acervo esteja acessivel; depois, cada biblioteca funciona por conta propria. Faixas sem identificador compativel sao ignoradas, e indisponibilidade na fonte pode impedir um download.

## Instalar

A versão 1.6.0 usa os mesmos HTML, CSS e JavaScript da web mobile nos modos conectado, independente e offline, com biblioteca, artistas, fila e player compartilhados. A interface fica no APK; no modo do celular ela acessa a biblioteca e os serviços Android dentro do próprio processo, sem servidor TCP ou PC. Busca e novos downloads usam a internet do telefone. Quando conectado ao PC, o áudio de uma faixa já salva é lido do celular pelo mesmo identificador, com suporte a avançar/voltar, sem pedir esses bytes ao servidor. A biblioteca existente e o vínculo seguro são preservados.

1. Copie `releases/acervo-1.6.0.apk` para o celular e abra o arquivo. Instale por cima da versão anterior para preservar suas músicas. Autorize a instalacao pelo navegador ou gerenciador de arquivos usado, caso o Android solicite.
2. Abra o aplicativo: a instalação nova entra direto no Início do celular; uma conexão anterior ao PC é reaberta automaticamente.
3. Em **Buscar**, procure uma musica e toque em **Baixar** ou **Baixar e ouvir**. Ela fica salva na biblioteca do celular.
4. Para controlar outro Acervo, abra **Conexões** pelo ícone de dispositivos e use o QR code ou cole o link. A camera so e solicitada ao abrir o leitor. Ao conectar, o app entra no Início e salva apenas a origem confirmada, sem guardar o convite temporário.

Para a nuvem, use o link HTTPS real da sua instalacao; nenhum servidor publico e criado ou definido pelo APK. Um exemplo de formato e `https://seu-dominio.com/#pair=CODIGO_DO_QR`, com o codigo real gerado pelo Acervo. O aplicativo lembra o endereco e os cookies de conexao, sem gravar o codigo temporario do QR.

Para conectar ao próprio PC, atualize também o Acervo nele, reinicie o servidor e gere um novo QR em **Conectar dispositivos**. Escaneie com o leitor do APK. O QR contém um convite temporário de uso único, a identidade pública do computador e seu endereço HTTPS, na porta 4311 por padrão. A chave privada do celular é gerada no Android Keystore e não é exportada; o PC exige essa identidade em cada conexão. Copiar cookies não basta para entrar. Confira os códigos dos dois aparelhos em **Proteção** no APK e no PC. Para trocar de celular, remova o anterior no PC antes de gerar outro QR. O vínculo sobrevive ao reinício; reinstalar o app perde a chave do telefone.

O computador precisa estar ligado e acessível. `ACERVO_PUBLIC_ENDPOINT` permite usar um endereço público/DDNS do próprio PC, desde que exista uma rota TCP até sua porta HTTPS; TLS termina no Acervo. Essa configuração não contorna CGNAT. O modo independente continua sem precisar do PC. A proteção usa TLS com autenticação mútua, sem implementar o protocolo do WhatsApp. Veja [docs/security.md](../docs/security.md) e [docs/isolation.md](../docs/isolation.md). Use `-Offline` em `build-gradle.ps1` para compilar com as ferramentas e dependências já salvas.

A assinatura e local, para instalacao direta. O aplicativo nao e distribuido pela Play Store. Para atualizar, toque em **Atualizar aplicativo** ou instale um novo APK com a mesma chave de assinatura; nao e preciso desinstalar a versao anterior. A instalacao e confirmada pelo proprio Android. O botao depende de uma nova versao publicada no canal de atualizacoes configurado.

## Compilar novamente no Windows

Dependencias de compilacao:

- JDK 21;
- Gradle 8.9;
- Android SDK Platform 35 (`platforms/android-35/android.jar`);
- Android SDK Build Tools 35.0.0;
- acesso aos repositorios de dependencias na primeira compilacao.

O projeto usa Android Gradle Plugin 8.7.3, NewPipeExtractor `v0.26.5` para busca e extracao no celular, ZXing core `3.5.4` para o leitor de QR e desugaring das APIs Java. As versoes e repositorios ficam em `build.gradle`, `settings.gradle` e `app/build.gradle`. Com as ferramentas ja instaladas:

```powershell
.\android\build-gradle.ps1 `
  -JavaHome 'C:\caminho\jdk-21' `
  -SdkRoot 'C:\caminho\android-sdk' `
  -GradleHome 'C:\caminho\gradle-8.9'
```

Nesta maquina, os caminhos preparados ficam em `%LOCALAPPDATA%\Temp\acervo-android-toolchain\toolchain.json`, nos campos `javaHome` e `sdkRoot`, e o Gradle em `%LOCALAPPDATA%\Temp\acervo-android-toolchain\gradle-8.9`. Esses caminhos sao os padroes do script; `-JavaHome`, `-SdkRoot` e `-GradleHome` permitem escolher outras instalacoes. A cache de dependencias fica em `%TEMP%\acervo-gradle-cache`. Use `-DependenciesOnly` para resolver as dependencias e imprimir o arquivo de classpath sem gerar o APK.

O resultado fica em `releases/acervo-<versao>.apk`, acompanhado do SHA256 em `.apk.sha256`. Use `-OutputDirectory` para escolher outro destino. Mantenha `versionName` e `versionCode` de `app/build.gradle` iguais aos campos `android:versionName` e `android:versionCode` do manifesto. Aumente o codigo de versao nas atualizacoes.

Cada compilacao usa uma pasta nova em `%TEMP%\acervo-gradle-build\`. Os fontes e recursos sao copiados para essa pasta porque ferramentas nativas do Android no Windows podem falhar com caminhos que contem acentos. O script alinha e assina o APK, verifica a assinatura e o alinhamento, e so entao copia o arquivo pronto para `releases/`.

## Guardar a assinatura

O script usa a chave original em `android/signing/acervo-release.jks` e sua senha em `android/signing/password.txt`. A compilacao para se algum deles estiver ausente, para preservar a identidade das atualizacoes. A senha e passada aos programas por uma variavel de ambiente temporaria; o script nao a mostra na saida nem a inclui no APK.

Guarde um backup privado dos dois arquivos juntos. Eles permitem assinar futuras atualizacoes compativeis com a instalacao existente. A pasta `signing/` esta excluida pelo `.gitignore`: nao envie a chave ou a senha junto com o APK. Se a chave existir e a senha estiver ausente, a compilacao para em vez de substituir a assinatura.

Os fontes do aplicativo ficam em `app/src/main/java/`, com manifesto e recursos em `app/src/main/`. Os arquivos compartilhados em `public/` são copiados para `assets/web` durante a compilação, sem manter uma segunda interface divergente. Para verificar o arquivo gerado manualmente, use `apksigner verify --verbose releases/acervo-1.6.0.apk` com o Android Build Tools no PATH.

## Atualizar pelo aplicativo

O botão **Atualizar aplicativo** consulta `/api/app/version` no servidor lembrado. Ainda não há repositório GitHub configurado para atualizações; ele será informado depois. Sem servidor lembrado, o aplicativo explica que o canal precisa ser configurado. A ausência de um canal ou de uma versão disponível não é tratada como confirmação de versão atualizada. O Android confirma a instalação e, se necessário, solicita permitir instalação por este aplicativo.

A atualização aceita apenas pacote `br.com.acervo.app`, código de versão maior e o mesmo certificado da instalação existente. Quando um checksum é publicado, ele também precisa conferir. Os arquivos temporários ficam no cache privado; o compartilhamento com o instalador é somente de leitura e limitado ao APK verificado.

Depois de informar e configurar o repositório de atualizações, será possível disponibilizar versões novas em releases estáveis com APK e checksum. **Nenhuma release foi publicada por esta alteração.** O script `android/publish-release.ps1` só deve ser usado após revisar o destino e os arquivos e autenticar o GitHub CLI. Antes de versões futuras, atualize os números no manifesto, Gradle, servidor e scripts/notas de release, compile, verifique e preserve a chave original.

## Licenças e fontes

O Android usa NewPipeExtractor e é distribuído sob GPL-3.0 ou posterior. Veja `LICENSE` e `THIRD-PARTY-NOTICES.md`, também acessíveis em **Sobre e licenças**. Os fontes completos estão em `android/` e `public/` neste repositório e no pacote `releases/acervo-1.6.0-source.zip`, incluindo as dependências abertas correspondentes. Nenhum pacote inclui assinatura privada, senhas ou músicas.

É possível compilar um APK próprio com Gradle e assiná-lo com uma chave própria sem ter acesso à chave original. Essa chave própria não permite atualizar por cima de uma instalação assinada pela chave original. Para empacotar os fontes da distribuição, use `python android/package-source.py --dependency-sources CAMINHO_DOS_FONTES_DAS_DEPENDENCIAS`.

Na versão 1.5.8, downloads maiores podem usar duas conexões por partes quando a fonte aceita Range; sem suporte, o app usa uma conexão normal. O player ganhou contexto do artista e próximas músicas. Perfis compatíveis do catálogo público incluem populares e álbuns e ficam guardados no celular. Execute `tests/run-download-tests.ps1 -JavaHome <JDK21>` para verificar bytes, limites, concorrência, respostas parciais e fallback com um servidor local.

Na versão 1.5.9, as faixas pretas horizontais uniformes são detectadas e recortadas só na exibição. A verificação também é aplicada às capas já guardadas no celular, sem mudar o arquivo original. Casos escuros ou incertos não são recortados.
