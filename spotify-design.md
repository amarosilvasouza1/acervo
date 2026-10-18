# Spotify - sistema de design observado

**Origem:** https://open.spotify.com/intl-pt
**Analisado em:** 18 de outubro de 2026 · Chrome headless 1440x1000
**Modo:** escuro · **Tecnologia observada:** nao identificada

Perfil inferido do DOM renderizado, com estilos computados. Serve como referencia de estrutura, cor e tipografia para outro projeto. Nao copie textos, marca, logo ou imagens deste site.

## 1. Leitura rapida

- **Cor de fundo dominante:** #000000 · **tinta:** #ffffff · **acento:** #1ed760.
- **Tipografia:** uma familia (SpotifyMixUI).
- **Escala:** H1 16px · H2 32px · H3 12px · corpo 16px.
- **Layout:** container de 1955px · 11 secoes · 1187 elementos lidos.
- **Contraste:** texto 21:1 · apoio 10,02:1 · acento 10,94:1.
- **Densidade:** fundo escuro, contraste por luz; movimento presente em muitos elementos.

## 2. Estrutura da pagina (arquitetura de informacao)

1. **Cabecalho** - 2 links (Explore podcasts, Cookies); acao principal "Premium".
2. **Hero** - H1 "Sua Biblioteca" (16px).
3. **Hero** - H1 "Início" (16px).
4. **Secao** - H2 "".
5. **Secao** - H2 "Escolha um idioma" com 1 subtitulos (ex.: "Localização").
6. **Acoes** - "Premium"; "Suporte"; "Baixar"; "Inscrever-se".

**Inventario observado**

| Item | Quantidade |
| --- | --- |
| Elementos lidos | 1187 |
| Titulos (h1-h3) | 5 |
| Secoes | 11 |
| Links | 208 |
| Imagens | 0 (alt em 0%) |
| Campos de formulario | 6 |
| Artigos | 0 |

## 3. Cores

| Token | Hex | Papel | Contraste |
| --- | --- | --- | --- |
| **--color-bg** | #000000 | fundo | - |
| **--color-surface** | #121212 | superficie | 18,73:1 com a tinta |
| **--color-ink** | #ffffff | texto principal | 21:1 |
| **--color-muted** | #b3b3b3 | texto de apoio | 10,02:1 |
| **--color-accent** | #1ed760 | acao e destaque | 10,94:1 |
| **--color-on-accent** | #111111 | texto sobre acento | 9,84:1 |
| **--color-line** | #292929 | bordas e divisores | - |

Cores mais usadas no DOM (por area pintada ou volume de texto):

| Hex | Tipo | Peso relativo |
| --- | --- | --- |
| #000000 | fundo | 1940k |
| #121212 | fundo | 1837k |
| #181818 | fundo | 1503k |
| #333333 | fundo | 731954 |
| #535353 | fundo | 267521 |
| #1f1f1f | fundo | 110706 |
| #ffffff | fundo | 28311 |
| #3b3b3b | fundo | 4131 |

**Regras de cor**

1. Parta de **--color-bg** e **--color-ink**; o acento e excecao, nao base.
2. Use **--color-muted** so em textos curtos de apoio; confira o contraste ao trocar de fundo.
3. O acento atual passa AA para texto; pode sustentar rotulos pequenos.
4. Em tema escuro, eleve a superficie em vez de clarear a tinta.

## 4. Tipografia

| Papel | Familia | Tamanho | Peso | Entrelinha | Tracking |
| --- | --- | --- | --- | --- | --- |
| Display / H1 | SpotifyMixUI | 16px | 700 | normal | normal |
| H2 | SpotifyMixUITitle | 32px | 700 | normal | normal |
| H3 | SpotifyMixUI | 12px | - | - | normal |
| Corpo | SpotifyMixUI | 16px | 400 | normal | normal |

- **Display:** SpotifyMixUI (sans). Fallback sugerido: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif.
- **Texto:** SpotifyMixUI (sans). Fallback sugerido: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif.
- **Relacao H1/corpo:** 1.0x.
- **Pesos observados:** 400, 700.

Se as familias originais forem proprietarias, use os fallbacks acima e preserve tamanhos, pesos e tracking.

## 5. Layout e espaco

- **Container maximo:** 1955px.
- **Respiro de secao (topo):** 0px.
- **Sistema observado:** 15 blocos em grid · 390 em flex.
- **Unidade sugerida:** 4 px, com escala 8 / 16 / 24 / 32 / 48 / 64.
- **Grade:** grid e o motor principal; mantenha colunas explicitas e gaps consistentes.

## 6. Forma e profundidade

- **Raio dominante:** 1000px (variacoes: 1000px, 8px, 6px, 9999px).
- **Sombras:** presentes em 45 elementos; use com parcimonia.
- **Bordas:** 3 elementos com borda visivel. Hairline de 1 px e a aposta segura.

## 7. Componentes observados

**Botao 1 - "Premium"**

- fundo transparente · texto #b3b3b3 · raio 9999px.
- padding 8px 0px 8px 0px · fonte SpotifyMixUI 16px/700.

**Botao 2 - "Suporte"**

- fundo transparente · texto #b3b3b3 · raio 9999px.
- padding 8px 0px 8px 0px · fonte SpotifyMixUI 16px/700.

**Botao 3 - "Baixar"**

- fundo transparente · texto #b3b3b3 · raio 9999px.
- padding 8px 0px 8px 0px · fonte SpotifyMixUI 16px/700.

- **Campos de formulario:** 6 encontrados. Se houver, mantenha borda de 1 px, fundo igual ao papel e foco no acento.
- **Links:** herdam tinta; sublinhado fino com offset de 3-4 px e hover no acento.

## 8. Movimento

- **Elementos com transicao:** 100.
- **Animacoes ativas:** 0.
- **Duracoes vistas:** 0.3s, 0.15s, 0.2s, 0.2s, 0.15s, 0.15s, 0.15s.
- Recomendacao: 160-220 ms, ease-out, apenas em cor, borda e opacidade; respeite prefers-reduced-motion.

## 9. Regras para reaproveitar

**Faca**

- Reaproveite a **arquitetura** (cabecalho, hero, secoes, acoes, rodape) e a **hierarquia** de tamanhos.
- Mantenha uma familia tipografica e a relacao H1/corpo de 1.0x.
- Preserve o container de 1955px e o respiro entre secoes.
- Use o acento em uma acao principal por dobra.

**Evite**

- Copiar logotipo, textos, fotos ou ilustracoes do site analisado.
- Introduzir uma terceira familia ou uma segunda cor de acento.
- Trocar o fundo sem recalcular contraste de tinta e apoio.
- Empilhar sombras, gradientes e animacoes que nao estavam no sistema original.

## 10. Prompt de implementacao

Implemente uma pagina no espirito de **Spotify**, sem copiar seu conteudo ou marca. Use fundo #000000, tinta #ffffff, apoio #b3b3b3, acento #1ed760 e texto sobre acento #111111. Titulos em SpotifyMixUI com fallback 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; corpo em SpotifyMixUI com fallback 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif. Escala: H1 16px, H2 32px, corpo 16px. Container de 1955px, raio 1000px, secoes separadas por hairline. Estrutura: 1. Cabecalho - 2 links (Explore podcasts, Cookies); acao principal "Premium". 2. Hero - H1 "Sua Biblioteca" (16px). 3. Hero - H1 "Início" (16px). 4. Secao - H2 "". 5. Secao - H2 "Escolha um idioma" com 1 subtitulos (ex.: "Localização"). Uma unica acao de acento por tela; contraste AA; foco visivel; prefers-reduced-motion.

## 11. Confianca e limites

- Perfil extraido automaticamente; nomes de fonte, papeis de cor e agrupamento de secoes sao inferencias.
- A captura e do primeiro viewport; estados de hover, modais e paginas internas nao foram analisados.
- Este arquivo descreve o sistema visual, nao autoriza reutilizar a marca ou o conteudo do site.

