# Acervo para Android

O APK instala o Acervo como aplicativo no Android 8.0 ou superior. Na tela inicial, escolha **Usar neste celular** para pesquisar, baixar e ouvir usando apenas a internet do proprio telefone. Nao exige computador ligado, mesma rede Wi-Fi, servidor ou assinatura de hospedagem.

As musicas baixadas ficam na area privada do aplicativo e aparecem em **Biblioteca**, disponiveis mesmo sem internet. **Buscar** encontra musicas, artistas e links do YouTube; **Radio** busca sugestoes atuais a partir de uma musica escolhida ou da mais recente. A pesquisa e os novos downloads precisam de internet no celular. A reproducao continua em segundo plano, com play/pause e proxima na notificacao. No modo Radio, a proxima musica e baixada enquanto a atual toca. Desinstalar o aplicativo tambem apaga sua biblioteca local; atualizar usando a mesma assinatura preserva os dados.

O modo **Conectar a outro Acervo** continua disponivel por QR code, separado da biblioteca local. Ele abre a biblioteca e os controles de outro servidor Acervo. Enderecos locais ou tuneis ate o computador dependem dele ligado; uma instalacao hospedada na nuvem pode funcionar com ele desligado. HTTPS exige certificado valido: o aplicativo nao ignora erros de certificado.

A sincronizacao de bibliotecas e manual: depois de parear e conectar ao outro Acervo, use **Sincronizar bibliotecas**. O aplicativo compara os identificadores e mostra quantas musicas faltam em cada aparelho antes de continuar. O celular baixa sua propria copia pela internet; o computador recebe pedidos para baixar as que faltam nele. Nenhuma musica e apagada do outro aparelho. Essa etapa exige que o outro Acervo esteja acessivel; depois, cada biblioteca funciona por conta propria. Faixas sem identificador compativel sao ignoradas, e indisponibilidade na fonte pode impedir um download.

## Instalar

1. Copie `releases/acervo-1.3.4.apk` para o celular e abra o arquivo. Autorize a instalacao pelo navegador ou gerenciador de arquivos usado, caso o Android solicite.
2. Abra o aplicativo e toque em **Usar neste celular**.
3. Em **Buscar**, procure uma musica e toque em **Baixar** ou **Baixar e ouvir**. Ela fica salva na biblioteca do celular.
4. Para controlar outro Acervo, volte a **Conexoes** e use o QR code ou cole o link. A camera so e solicitada ao abrir o leitor.

Para a nuvem, use o link HTTPS real da sua instalacao; nenhum servidor publico e criado ou definido pelo APK. Um exemplo de formato e `https://seu-dominio.com/#pair=CODIGO_DO_QR`, com o codigo real gerado pelo Acervo. O aplicativo lembra o endereco e os cookies de conexao, sem gravar o codigo temporario do QR.

Para a rede local, use um endereco IPv4 privado como `http://192.168.1.10:4310`. Nesse modo, o computador precisa estar ligado e acessivel pela mesma rede; o endereco `127.0.0.1` pertence ao proprio aparelho. Se o Windows solicitar permissao de rede para o servidor, permita na rede privada em que estiver usando o Acervo. HTTP para dominios ou enderecos publicos e bloqueado para evitar o envio da biblioteca e dos controles sem criptografia pela internet.

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

Os fontes do aplicativo ficam em `app/src/main/java/`, com manifesto e recursos em `app/src/main/`. Para verificar o arquivo gerado manualmente, use `apksigner verify --verbose releases/acervo-1.3.4.apk` com o Android Build Tools no PATH.

## Atualizar pelo aplicativo

O botão **Atualizar aplicativo** consulta `/api/app/version` no servidor lembrado, ou as releases estáveis de `amarosilvasouza1/acervo` no GitHub quando usado sem servidor. A verificação de ausência de release não é tratada como confirmação de versão atualizada. O Android confirma a instalação e, se necessário, solicita permitir instalação por este aplicativo.

A atualização aceita apenas pacote `br.com.acervo.app`, código de versão maior e o mesmo certificado da instalação existente. Quando um checksum é publicado, ele também precisa conferir. Os arquivos temporários ficam no cache privado; o compartilhamento com o instalador é somente de leitura e limitado ao APK verificado.

Para disponibilizar uma versão nova a aparelhos fora da rede local, publique os artefatos em uma release estável do repositório. **Nenhuma release foi publicada por esta alteração.** O script `android/publish-release.ps1` faz essa publicação apenas quando o proprietário o executa, após revisar os arquivos e autenticar o GitHub CLI. Antes de versões futuras, atualize os números no manifesto, Gradle, servidor e scripts/notas de release, compile, verifique e preserve a chave original.

## Licenças e fontes

O Android usa NewPipeExtractor e é distribuído sob GPL-3.0 ou posterior. Veja `LICENSE` e `THIRD-PARTY-NOTICES.md`, também acessíveis em **Sobre e licenças**. Os fontes completos estão em `android/` neste repositório; o pacote `releases/acervo-1.2.0-source.zip` continua disponível com as dependências abertas da versão anterior. Nenhum pacote inclui assinatura privada, senhas ou músicas.

É possível compilar um APK próprio com Gradle e assiná-lo com uma chave própria sem ter acesso à chave original. Essa chave própria não permite atualizar por cima de uma instalação assinada pela chave original. Para empacotar os fontes da distribuição, use `python android/package-source.py --dependency-sources CAMINHO_DOS_FONTES_DAS_DEPENDENCIAS`.
