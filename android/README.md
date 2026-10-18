# Acervo para Android

O APK instala o Acervo como aplicativo no Android 8.0 ou superior. O aplicativo se conecta ao Acervo do computador: mantenha o servidor ligado e os dois aparelhos na mesma rede Wi-Fi. A biblioteca, a fila e os controles continuam usando a conexao de dispositivos do Acervo.

## Instalar

1. No computador, execute `iniciar.cmd` na pasta principal do projeto.
2. Copie `releases/acervo-1.0.0.apk` para o celular e abra o arquivo. Autorize a instalacao pelo navegador ou gerenciador de arquivos usado, caso o Android solicite.
3. Abra o Acervo no celular e use o leitor de QR code para conectar ao computador. Na tela do computador, abra **Conectar dispositivos** para mostrar o QR.
4. Autorize a camera ao usar o leitor. Tambem e possivel informar o endereco de conexao manualmente.

O computador precisa estar acessivel pela rede local; o endereco `127.0.0.1` pertence ao proprio aparelho e nao conecta o celular ao computador. Se o Windows solicitar permissao de rede para o servidor, permita na rede privada em que estiver usando o Acervo.

A assinatura e local, para instalacao direta. O aplicativo nao e distribuido pela Play Store. Para atualizar, instale um novo APK com a mesma chave de assinatura; nao e preciso desinstalar a versao anterior.

## Compilar novamente no Windows

Dependencias de compilacao:

- JDK 17 ou 21;
- Android SDK Platform 35 (`platforms/android-35/android.jar`);
- Android SDK Build Tools 35.0.0;
- ZXing core 3.5.4 (`core-3.5.4.jar`), usado no leitor de QR code.

O script usa as ferramentas oficiais do Android SDK diretamente, sem Gradle, e nao baixa dependencias durante a compilacao. Com as ferramentas ja instaladas:

```powershell
.\android\build.ps1 `
  -JavaHome 'C:\caminho\jdk-21' `
  -SdkRoot 'C:\caminho\android-sdk' `
  -ZxingJar 'C:\caminho\core-3.5.4.jar'
```

`JAVA_HOME` e `ANDROID_HOME` (ou `ANDROID_SDK_ROOT`) tambem sao aceitos. Caso exista `%TEMP%\acervo-android-toolchain\toolchain.json`, o script usa os caminhos `javaHome`, `sdkRoot` e `zxingJar` desse arquivo como padroes. Nesse computador, depois da preparacao das ferramentas, basta executar `android\build.cmd`.

O resultado fica em `releases/acervo-<versao>.apk`, acompanhado do SHA256 em `.apk.sha256`. Use `-OutputDirectory` para escolher outro destino. A versao e definida por `android:versionName` e `android:versionCode` em `app/src/main/AndroidManifest.xml`; aumente o codigo de versao nas atualizacoes.

Cada compilacao usa uma pasta nova em `%TEMP%\acervo-apk-build\`. Os fontes e recursos sao copiados para essa pasta porque ferramentas nativas do Android no Windows podem falhar com caminhos que contem acentos. O script verifica a assinatura do APK e o alinhamento antes de copiar o arquivo pronto para `releases/`.

## Guardar a assinatura

Na primeira compilacao, o script gera uma chave RSA local em `android/signing/acervo-release.jks` e uma senha aleatoria em `android/signing/password.txt`. A senha e passada aos programas por uma variavel de ambiente temporaria; o script nao a mostra na saida nem a inclui no APK.

Guarde um backup privado dos dois arquivos juntos. Eles permitem assinar futuras atualizacoes compativeis com a instalacao existente. A pasta `signing/` esta excluida pelo `.gitignore`: nao envie a chave ou a senha junto com o APK. Se a chave existir e a senha estiver ausente, a compilacao para em vez de substituir a assinatura.

Os fontes do aplicativo ficam em `app/src/main/java/`, com manifesto e recursos em `app/src/main/`. Para verificar o arquivo gerado manualmente, use `apksigner verify --verbose releases/acervo-1.0.0.apk` com o Android Build Tools no PATH.
