# Acervo

Biblioteca musical local com download de áudio do YouTube, normalização de loudness em **−14 LUFS** e recomendações por similaridade sonora.

Repositório: https://github.com/amarosilvasouza1/acervo

## Capturas

![Acervo no desktop](docs/desktop.jpg)

![Rádio por similaridade](docs/radio.jpg)

<img src="docs/mobile.png" alt="Acervo no celular" width="320">

Interface construída a partir do sistema visual descrito em **spotify-design.md**: fundo #000, superfícies #121212/#181818, tinta #fff, apoio #b3b3b3, acento #1ed760, texto sobre acento #111, pills de 1000px, foco visível e suporte a movimento reduzido.

## Rodar

Pré-requisitos:

- Node.js 20+ (testado com v25.9.0)
- Python 3.10 com yt-dlp (python -m pip install -U yt-dlp)
- FFmpeg/ffprobe no PATH

~~~powershell
git clone https://github.com/amarosilvasouza1/acervo.git
cd acervo
npm install
npm start
~~~

Abra http://127.0.0.1:4310 — ou dê duplo clique em **iniciar.cmd**.

## Versões PC e Web

Na primeira visita, a raiz do Acervo mostra uma tela de escolha. A preferência fica salva no navegador e pode ser trocada a qualquer momento pelo botão de telas no topo do app.

- **/pc** — versão PC: sidebar, fila, player expandido e o fluxo completo de download.
- **/web** — versão Web: interface de celular com abas inferiores e mini player, exibida em uma moldura no desktop e em tela cheia no celular.
- **/escolher** — tela de escolha; use `?choose=1` para ignorar a preferência salva.

O app Android ignora a escolha e abre direto na biblioteca quando acessa o servidor pelo WebView.

## Acessar o PC fora de casa (Tailscale)

O Acervo pode continuar no seu PC e ser acessado de qualquer rede pelo celular, sem abrir portas no roteador, usando a tailnet privada do Tailscale.

1. Mantenha o Tailscale instalado e conectado no PC e no celular, com a mesma conta.
2. No PC, rode **iniciar-externo.cmd**. Ele publica o Acervo em HTTPS na porta 10000 da tailnet e inicia o servidor em modo nuvem.
3. Abra o endereço mostrado. O Acervo reconhece sua identidade do Tailscale e entra direto, sem senha; se quiser parear o APK, gere o QR em **Conectar dispositivos**.
4. No celular, com o Tailscale ligado, abra o endereço no APK (ou escaneie o QR). Funciona fora de casa enquanto o PC estiver ligado e o servidor aberto.
5. Para encerrar o acesso externo, feche a janela do servidor e rode **parar-externo.cmd**.

O endereço fica disponível apenas dentro da sua tailnet — não é publicado na internet. O APK 1.2.0 já aceita links HTTPS, então não precisa reinstalar. O modo local (**iniciar.cmd**) continua sendo o mais simples para usar em casa. O acesso pela tailnet é autenticado pela identidade do Tailscale, não por senha. A senha em **externo.env** é apenas um fallback técnico para acesso sem a identidade da tailnet e não é solicitada no uso normal; mantenha esse arquivo privado.

## Android independente e conexão entre dispositivos

Instale [releases/acervo-1.2.0.apk](releases/acervo-1.2.0.apk) no Android 8 ou superior. Pode instalar por cima da versão anterior: a assinatura foi mantida. O botão **Baixar APK Android** em **Conectar dispositivos** também entrega esse arquivo.

Na tela inicial do APK, toque em **Usar neste celular**. O Android pesquisa no YouTube, resolve o áudio, baixa e reproduz pela própria conexão à internet. Funciona em outra rede e com o computador desligado. As músicas ficam na área privada do aplicativo e tocam sem internet depois de baixadas. A rádio usa uma música escolhida ou a última ouvida para buscar sugestões atuais; nenhuma hospedagem é necessária para esse modo.

O Android guarda M4A ou WebM de áudio, conforme a fonte. A conversão para MP3, a normalização em −14 LUFS e a análise de timbre continuam no servidor do PC. Nesta versão, o player nativo pausa ao sair do aplicativo. Desinstalar apaga a biblioteca local; atualizar com a mesma assinatura mantém os dados.

Para conectar as duas versões:

1. No computador, abra **http://127.0.0.1:4310** e gere um QR em **Conectar dispositivos**.
2. No APK, use **Escanear QR code**. Links locais precisam do computador ligado e acessível pela rede; um servidor HTTPS configurado permite conexão pela internet.
3. O modo conectado compartilha biblioteca, fila e controles em tempo real. **Ouvir aqui** transfere a reprodução entre as telas conectadas.
4. Na barra nativa do modo conectado, toque em **Sincronizar** para comparar os catálogos. Músicas faltantes são baixadas no celular e pedidos de download são enviados ao PC. Nada é apagado; cada versão mantém sua cópia e seu histórico. Os pedidos no PC continuam sujeitos ao progresso da fila de importação.

O celular continua independente depois da sincronização. Controlar um computador desligado e trocar dados com ele enquanto está inacessível exige aguardar sua volta. Uma biblioteca central hospedada é uma opção adicional, documentada em [docs/cloud.md](docs/cloud.md); nenhum servidor foi contratado ou publicado.

Cada QR vale cinco minutos e conecta um aparelho. O acesso pode ser removido por quem administra a biblioteca. O modo local exige novo QR após reiniciar o servidor; o modo nuvem preserva sessões em armazenamento permanente. Se houver várias placas de rede, escolha o endereço Wi‑Fi/Ethernet usado pelo celular.

O botão **Atualizar aplicativo** consulta novas versões no servidor lembrado ou nas releases do repositório no GitHub. No modo independente, usa as releases do GitHub. A atualização valida o pacote e a mesma assinatura antes de abrir o instalador do Android. Versões futuras precisam ser publicadas com APK e checksum; a ausência de release é informada na tela. A primeira instalação ainda usa o APK entregue aqui. Veja [android/README.md](android/README.md) para compilação, assinatura e publicação.

No modo local, o servidor aceita redes privadas e exige pareamento em outro aparelho. Se o Windows solicitar acesso de rede para o Node.js, permita a sua rede privada. O aplicativo não abre portas no roteador nem altera o firewall.

Para voltar a restringir o servidor ao próprio computador:

~~~powershell
$env:ACERVO_HOST = "127.0.0.1"
npm start
~~~

Se uma versão antiga estiver rodando, feche o servidor anterior e inicie novamente para carregar as funções de conexão.

## Usar

1. **Buscar**: pesquise por faixa/artista ou cole um link do YouTube no topo.
2. **Baixar**: baixa o melhor áudio disponível, converte para MP3 44,1 kHz, mede o loudness e normaliza em −14 LUFS (true peak −1 dB).
3. **Acervo**: capa, artista, BPM, LUFS, duração, ordenação e filtro local.
4. **Parecidas**: no painel da faixa, a similaridade cruza andamento, energia, brilho espectral e ruído, com bônus para mesmo artista/gênero.
5. **Rádio ao vivo**: descubra novas músicas a partir das ouvidas recentemente, de uma faixa do acervo ou de um nome de música/artista. Os resultados aparecem conforme as buscas no YouTube terminam. Ao digitar, a busca é atualizada automaticamente; mudar a referência ou sair da rádio cancela a pesquisa anterior.
6. **Descobrir**: usa artistas relacionados (Deezer) e busca no YouTube para sugerir novas faixas.

A rádio usa música de referência, artista, colaboradores identificados e artistas relacionados para buscar novidades online. Exclui faixas já salvas, a própria referência e resultados repetidos. A análise de BPM e timbre continua disponível nas recomendações **Parecidas no acervo**; os resultados online ainda não tiveram seu áudio analisado.

Use **Baixar** para guardar uma descoberta, o botão de play ao lado para **baixar e ouvir**, ou a seta para abrir no YouTube. O histórico é salvo localmente após a reprodução começar. A rádio de escutas recentes acompanha novas reproduções e renova a busca a cada 90 segundos enquanto a tela está aberta; **Parar busca** suspende essa atualização até você atualizar ou escolher outra referência.

## Como funciona

~~~text
yt-dlp            -> melhor áudio do vídeo
ffmpeg loudnorm   -> 1ª passada mede, 2ª normaliza em -14 LUFS (TP -1)
libmp3lame        -> MP3 VBR ~190 kbps, 44,1 kHz, estéreo
análise local     -> RMS/energia, ZCR, centroide espectral por FFT,
                     BPM por autocorrelação do fluxo de onsets
similaridade      -> distância ponderada + artista/gênero
~~~

Se o YouTube pedir verificação anti-bot, o download tenta automaticamente os clientes **android**, **web_embedded** e **android_vr** antes de desistir. Para vídeos que exigem login, exporte cookies do seu navegador e inicie com:

~~~powershell
$env:ACERVO_COOKIES_BROWSER = "chrome"   # ou edge, firefox, brave
npm start
~~~

## Estrutura

~~~text
server.js          servidor HTTP, rotas e fila de importação
lib/connect.js     pareamento, sessões, presença e player compartilhado
lib/yt.js          busca, metadados e download com fallback de clientes
lib/audio.js       loudness, normalização e extração de features
lib/library.js     persistência em data/library.json
lib/radio.js       rádio online com resultados progressivos e cancelamento
public/            interface (HTML/CSS/JS sem framework)
public/connect.js  controles remotos, dispositivos, QR e reprodutor expandido
public/mobile.css  interface de celular com áreas seguras e abas inferiores
data/tracks/       MP3 normalizados
data/covers/       capas
data/trash/        faixas removidas (recuperáveis)
tests/             testes de backend e de interface (Node test runner)
~~~

## API

- GET /api/health — estado e número de faixas
- GET /healthz — verificação pública mínima para a hospedagem
- GET /api/app/version — versão Android e checksum do APK disponível
- GET /api/search?q= — busca no YouTube (cache de 5 min)
- POST /api/import — { videoId | url | query }; retorna jobId
- GET /api/jobs/:id — progresso/etapa/erro
- GET /api/library — faixas + estatísticas
- GET /api/stream/:id — áudio com Range
- GET /api/cover/:id — capa
- GET /api/recommend/:id — parecidas com score e motivos
- GET /api/discover/:id — sugestões externas
- POST /api/radio — { seedId? | query?, excludeIds?, limit? }; resultados ao vivo via SSE. Sem referência explícita, usa o histórico recente.
- POST /api/track/:id/play — registra reprodução no histórico local
- DELETE /api/track/:id — move para data/trash
- GET /api/connect/info — dispositivos e estado compartilhado (exige pareamento remoto)
- POST /api/connect/register — registra o player local do computador
- POST /api/connect/pairing — gera QR code no computador
- POST /api/connect/claim — troca o código de pareamento por uma sessão do aparelho
- GET /api/connect/config — informa se o servidor está no modo nuvem
- POST /api/connect/login — entrada por senha no modo nuvem
- POST /api/connect/logout — encerra a sessão no modo nuvem
- GET /api/connect/events — eventos de dispositivos, comandos, player e biblioteca por SSE
- POST /api/connect/state — estado do player enviado pela saída de áudio ativa
- POST /api/connect/command — controle remoto e transferência entre aparelhos
- DELETE /api/connect/devices/:id — revoga uma conexão a partir do computador

## Verificar

~~~powershell
npm test
~~~

Os testes cobrem resultados progressivos, histórico, referências, repetições, cancelamento, falhas de fontes, controles da rádio, pareamento, expiração, revogação, transferência e sincronização entre dois clientes. Não precisam baixar músicas nem alterar o acervo existente.

`npm run test:connect` verifica a API por HTTP real na LAN, com um servidor temporário na porta 4312. Requer um endereço de rede privada ativo e acesso local à rede; não altera a biblioteca.

## Limites e uso

O download depende do YouTube e pode falhar por verificação anti-bot, região ou disponibilidade do vídeo — a interface mostra o motivo. Baixe apenas conteúdo que você tem direito de usar. O Acervo não contorna DRM, paywall ou controle de acesso; cookies são opcionais e ficam na sua máquina.
