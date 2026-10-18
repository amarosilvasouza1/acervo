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

## Celular e conexão por QR code

O aplicativo Android instalável está em **releases/acervo-1.0.0.apk**. Você também pode baixá-lo pelo botão **Baixar APK Android** em **Conectar dispositivos**. A partir do celular, esse botão baixa o arquivo pela rede local.

Transfira o APK para o Android, abra o arquivo e autorize a instalação pelo aplicativo de arquivos/navegador quando o sistema solicitar. Ao abrir o Acervo instalado, toque em **Escanear QR code**, permita a câmera e escaneie um novo QR gerado pelo computador. Também é possível colar o link de conexão. Requisitos: Android 8 ou superior, Android System WebView atualizado e acesso ao computador na mesma rede local.

O APK mantém a conexão dentro do aplicativo e usa o computador como biblioteca. Não inclui um servidor independente, armazenamento offline de músicas ou garantia de reprodução em segundo plano. Veja **android/README.md** para o código-fonte e a compilação.

A interface adapta-se ao celular com quatro abas inferiores, controles de toque e um mini player. Toque na capa ou no nome da faixa para abrir o reprodutor completo.

1. Abra o Acervo no computador em **http://127.0.0.1:4310** e clique no ícone **Conectar dispositivos** no cabeçalho ou no player.
2. Mantenha computador e celular na mesma rede local (o computador pode estar conectado por cabo).
3. Use a câmera do celular para escanear o QR code e abra o link. A biblioteca, a fila, a faixa atual e os controles passam a se comunicar em tempo real.
4. Escolha **Ouvir aqui** na lista de dispositivos para transferir o áudio, mantendo a faixa e sua posição. Se o navegador do destino pedir uma interação, toque em **play** nesse aparelho.

O computador hospeda as músicas e precisa ficar ligado, com o servidor aberto. O celular pode controlar a reprodução do computador ou receber o áudio pela rede. Downloads iniciados em um aparelho aparecem na biblioteca do outro. O histórico de escuta também alimenta a rádio em ambos.

Cada QR code vale por cinco minutos e conecta um aparelho. Gere outro para conectar mais um. O acesso pareado pode ser removido pelo computador; reiniciar o servidor exige ler um novo QR code. Se houver várias placas de rede, selecione no diálogo o endereço da rede Wi‑Fi/Ethernet usada pelo celular. O link também pode ser copiado.

O Acervo aceita conexões da rede privada e exige pareamento para ler ou alterar o acervo a partir de outro aparelho. Se o Windows exibir uma solicitação de rede para o Node.js, permita a sua rede privada para alcançar o computador pelo celular. O aplicativo não altera o firewall nem configura acesso pela internet.

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
