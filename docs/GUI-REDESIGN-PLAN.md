# Plano de Redesign — Steam Spec Overlay

> Objetivo: matar a leitura de "AI slop" na GUI e transformar o overlay em algo
> que as pessoas queiram deixar aberto na tela. Escopo: `index.html`,
> `styles.css`, `renderer.js`, `assets/`. Nenhuma mudança em `lib/` (lógica de
> comparação, scraping e specs fica intacta).

---

## 1. Diagnóstico — por que parece gerado por IA

Isso não é opinião de gosto. Cada item abaixo é um marcador que aparece em
praticamente todo output de LLM que gera interface, e está no código hoje.

| # | Evidência | Onde | Por que denuncia |
|---|-----------|------|------------------|
| 1 | `--fg: #e6edf3` / `--accent: #58a6ff` / `--bg: rgba(14,17,22,…)` | [styles.css:2-14](styles.css) | É a paleta do GitHub Primer Dark, literalmente. Todo mundo que pede "dark UI" pra um LLM recebe esses hex. |
| 2 | `backdrop-filter: blur(6px)` + `border-radius: 14px` + `border: 1px solid rgba(255,255,255,0.14)` | [styles.css:29-38](styles.css) | O "card de vidro" default. Pior: com `transparent: true` no Windows ([main.js:281](main.js)) o Chromium não amostra o desktop atrás — **o blur não faz nada visualmente e ainda custa GPU**. |
| 3 | `font-family: var(--mono)` em `html, body` | [styles.css:25](styles.css) | Mono em *tudo*, inclusive prosa ("no limite, espere quedas / baixar gráficos"). Mono vira decoração em vez de função. Produto de verdade usa mono só em dado. |
| 4 | Velocímetro SVG com agulha e cubo | [index.html:39-44](index.html) | Clichê nº 1 de dashboard gerado por IA. Gasta 120px de altura pra comunicar um número. |
| 5 | Semáforo de 4 cores (verde/lima/âmbar/vermelho) | [styles.css:10-13](styles.css), `band()` em [renderer.js:13](renderer.js) | Zero cor de marca. Só estado. O produto não tem cara. |
| 6 | `letter-spacing: 2px` em labels uppercase de 9–10px, em todo lugar | [styles.css:52, 110, 148](styles.css) | Assinatura visual de LLM. |
| 7 | Tudo centralizado e simétrico | `#game`, `#gauge-wrap`, `.verdict` | Layout default. Sem tensão, sem hierarquia espacial, sem ponto focal escolhido. |
| 8 | `⚙ – ×` como botões de titlebar | [index.html:19-21](index.html) | Glifos de fonte de sistema. Alinham mal, renderizam diferente por máquina, parecem placeholder. |
| 9 | 3 barras de progresso idênticas empilhadas | [index.html:51-67](index.html) | Componente genérico. E não mostram a informação que importa (folga vs. requisito). |
| 10 | Salto tipográfico 11px → 34px, nada no meio | [styles.css:102-104](styles.css) | Sem escala. Hierarquia por acidente. |
| 11 | Motion = duas `transition: … ease` | [styles.css:98-99](styles.css) | Nenhum momento de deleite. Troca de jogo não tem coreografia. |
| 12 | Estado vazio = `<div class="idle">aguardando jogo na Steam…</div>` | [renderer.js:263](renderer.js) | **É a tela que o usuário mais vê** e é uma linha de texto cinza. |

**Resumo:** o app não é feio. Ele é *anônimo*. Trocando o texto, ele vira qualquer
outro dashboard. Nenhum pixel diz "Steam", "hardware", "medição" ou "meu produto".

---

## 2. Direção — "Bancada de Teste"

O produto **não é um dashboard**. É um **instrumento de medição** que fica em cima
do jogo. A referência certa não é Grafana — é telemetria de sim racing, painel de
bancada de eletrônica, osciloscópio de fósforo, medidor VU. Executado com refino,
não com skeuomorfismo barato.

Conceito de uma frase: **o overlay é um aparelho encostado no jogo, medindo ele.**

### 2.1 Tipografia

Matar mono como fonte de UI. Duas fontes, empacotadas localmente (OFL, sem CDN):

- **Archivo Variable** (`wght` 100–900 + `wdth` 62–125) — títulos, veredito, o
  número gigante. O eixo de largura permite condensar nome de jogo longo em 360px
  sem `text-overflow`, e expandir o número herói.
- **Martian Mono Variable** (`wdth` + `wght`) — só onde é dado: APPID, nomes de
  GPU/CPU, GB, notas por componente. Tem caráter próprio (não é o mono default de
  todo mundo).

Escala real, não dois tamanhos: `10 / 11 / 13 / 16 / 22 / 34 / 88`.

### 2.2 Cor — a arte do jogo manda

Qualquer paleta fixa que eu escolhesse seria mais um tema escuro entre milhares.
A saída não é escolher melhor: é **não escolher**.

A arte da loja é a única coisa no app que muda a cada jogo, e no design antigo
ela era decoração passiva. Agora o renderer amostra o banner, extrai a matiz
dominante e escreve `--accent` em `#app`. Essa cor pinta o número, a régua, as
barras, o toggle ativo, o LED de modo e a marca da titlebar.

**Cyberpunk fica amarelo. DOOM âmbar. Hades laranja. Stardew azul-céu. Elden
Ring dourado.** O app é um camaleão: nenhuma captura de tela se parece com a
outra. Um template genérico não consegue imitar isso porque a cor não está no
CSS, está na obra.

O resto da interface é cromaticamente mudo de propósito — ardósia da Steam,
tinta fria — para que a cor do jogo seja a única cor na tela.

```
--void:     #080B10   /* ardósia da Steam, escurecida para overlay */
--panel:    #0F151D
--rule:     #1E2A37
--ink:      #E4ECF5
--ink-dim:  #7E8FA3
--accent:   extraído da arte  (fallback #96BF3E, verde de ação da Steam)
--tint:     hsl(matiz 34% 7%) — respiro da cor do jogo na base do painel
--alarm:    #E8564C   /* fixo, nunca vem da arte */
```

Três detalhes que o algoritmo precisa acertar:

1. **Ignorar cinza, sombra e estouro** (`s < 0.2`, `l < 0.14`, `l > 0.9`) — senão
   toda arte "vence" com preto e o acento vira cinza.
2. **Normalizar luminosidade e saturação** para `62%` / `58–88%`. A arte escolhe
   a matiz; o app garante o contraste sobre fundo escuro.
3. **Manter distância do alarme.** `--alarm` fica em ~4°. Uma arte dominada por
   vermelho pintaria "92 · roda tranquilo" da mesma cor de "abaixo do requisito".
   `keepOffAlarm()` empurra a matiz para fora da faixa 350–20°: Hades sai de
   vermelho para laranja `hsl(28)` e continua sendo Hades.

Os chips de extras ficam **fora** do acento: com a cor vindo da arte, um
"✓ DirectX 12" vermelho ou amarelo lê como erro. A marca desenhada já carrega a
semântica; só a falha precisa de cor.

### 2.3 O número é o herói (adeus velocímetro)

Fora o gauge. Entra:

- **Veredito numérico gigante** — `88px`, Archivo expandida, alinhado à direita,
  sangrando na margem. É a primeira coisa que o olho pega.
- **Régua de tolerância horizontal** no lugar do arco: escala 0–100 com marcações
  de instrumento (ticks finos, ticks maiores em 25/50/75), agulha fina indicando o
  valor, e as faixas nomeadas ao longo dela. Ocupa ~36px em vez de 120px, carrega
  mais informação e é raro em interface.

### 2.4 Barras de folga (headroom), não barras de progresso

Hoje a barra mostra a nota. Mas a informação que ninguém dá e que o usuário quer é
**a distância entre o que ele tem e o que o jogo pede**. Nova barra: escala
compartilhada, marcador do requisito fixo, preenchimento da máquina do usuário —
dá pra *ver* se sobra ou falta, e quanto.

### 2.5 Superfície e textura

- Sai `backdrop-filter` (no-op no Windows com janela transparente).
- Entra superfície sólida + **grain overlay** (SVG `feTurbulence` inline, um
  elemento, `mix-blend-mode: overlay`, opacidade baixíssima).
- Borda de luz de 1px só no topo do painel, não perímetro inteiro.
- Arte do jogo em **cor cheia, 196px**, sangrando por baixo da titlebar. Sem
  card, sem borda, sem opacidade reduzida — o véu é ancorado embaixo, só o
  suficiente para assentar o nome. Ela é a identidade do app, não um enfeite:
  vale os pixels que ocupa.
- Medidores **segmentados** (20 divisões via `mask-image`) no lugar de barras
  arredondadas. Lê como instrumento, não como barra de progresso de site.

### 2.6 Assimetria

Nome do jogo à esquerda, alinhado à margem. Número herói à direita. Régua
atravessando toda a largura, quebrando as margens. Chips embaixo, alinhados à
esquerda, ragged. Nada centralizado exceto o que precisa estar.

### 2.7 Motion — um momento, bem orquestrado

Trocar de jogo dispara uma sequência de boot (~600ms total), não seis transições
soltas:

```
0ms    arte faz fade + scale 1.04 → 1.00
60ms   nome do jogo entra (clip-path wipe da esquerda)
120ms  régua desenha da esquerda pra direita
180ms  agulha viaja até o valor (overshoot leve, cubic-bezier)
180ms  número conta de 0 → valor (já existe em animateGauge, reaproveitar)
280ms  barras de folga varrem, stagger de 40ms
420ms  chips aparecem, stagger de 25ms
```

Respeitar `prefers-reduced-motion`.

### 2.8 Estado vazio com personalidade

`aguardando jogo na Steam…` vira a tela-assinatura: régua em modo idle com a
agulha oscilando devagar (respiração de instrumento ligado), texto curto,
tipografia boa. É a tela mais vista do app — merece ser a mais bonita.

### 2.9 Botões de titlebar

SVG inline (24×24, stroke 1.5), não glifos Unicode. Ícone de engrenagem, minus e
X desenhados, hover com fundo sutil, `#btn-quit` com hover `--alarm`.

---

## 3. Plano de implementação

Sequencial. Cada fase é commitável e deixa o app funcionando.

### Fase 0 — Fundação (base para tudo)

| Tarefa | Arquivo |
|---|---|
| Baixar Archivo Variable + Martian Mono Variable (woff2, subset latin) → `assets/fonts/` | `assets/fonts/` |
| Adicionar `font-src 'self'` ao CSP | [index.html:5](index.html) |
| Confirmar que `assets/**/*` já cobre as fontes no `build.files` | [package.json](package.json) — já cobre ✅ |
| Reescrever `:root` com os tokens novos (cor, escala tipográfica, escala de espaço, durações) | [styles.css:1-15](styles.css) |
| Remover `backdrop-filter`; medir se some algum efeito real | [styles.css:37](styles.css) |
| Adicionar camada de grain | `index.html` + `styles.css` |

**Aceite:** app abre, fontes carregam offline, nada quebrado, paleta nova aplicada
mesmo com layout antigo.

### Fase 1 — Tipografia e layout

- Trocar mono global por Archivo; mono só em `.comp-detail`, `.game-sub`, valores.
- Aplicar escala tipográfica; matar `letter-spacing: 2px` genérico.
- Reorganizar `#game` + veredito em grid assimétrico de 2 colunas.
- Arte vira bleed de fundo com `mask-image` em vez de card.
- Botões de titlebar em SVG.

**Aceite:** nome de jogo longo (ex.: "Warhammer 40,000: Rogue Trader") cabe em
360px sem reticências, via eixo `wdth`.

### Fase 2 — Instrumentação (substituir o gauge)

- Novo componente régua em SVG: `<svg id="rule">` com ticks, agulha e faixas.
- Número herói 88px.
- `setGauge()` → `setReading()`: reaproveita `animateGauge()`, troca
  `stroke-dasharray` por `transform: translateX` da agulha.
- Barras de folga: adicionar marcador de requisito em `.bar`, mudar
  `setComponent()` pra posicionar requisito e preenchimento na mesma escala.
- Remover `<svg id="gauge">` e CSS órfão.

**Aceite:** os 4 screenshots em `docs/` regravados; leitura do valor continua
correta em `overall == null` e em componente não identificado.

### Fase 3 — Motion

- Sequência de boot em CSS (`animation-delay` escalonado) disparada por classe
  `.booting` que `render()` aplica quando `state.game.appid` muda.
- Agulha com `cubic-bezier` de overshoot.
- Guard de `prefers-reduced-motion`.

**Aceite:** trocar de jogo na Steam dispara a sequência uma vez, não a cada push
de estado (o `pushState` é frequente — precisa de dedupe por appid).

### Fase 4 — Estados e polimento

- Estado vazio "aguardando jogo" redesenhado com agulha em respiração.
- Estados `setup` / `no-steam` / `sem rede` / `requisitos indisponíveis` com o
  mesmo vocabulário visual (hoje são caixas cinza genéricas).
- Painel de configurações: reagrupar, controles custom (toggle em vez de checkbox
  nativo, slider com track de instrumento).
- Chips de extras: alinhamento ragged, tipografia mono, `✓/✗` em SVG.
- Modo compacto revisto (hoje só esconde seções — deve ser um layout próprio).

**Aceite:** todo estado da máquina de estados de `render()` tem tratamento visual
intencional. Nenhum cai em fallback cinza.

### Fase 5 — Vitrine

Isso é metade do "atrair o público" e hoje está subaproveitado.

- Regravar `docs/shot-*.png` com jogos de arte forte (a arte de fundo é o que
  vende).
- Gravar um GIF/webm de 6–8s: Steam abre jogo → overlay reage → sequência de boot
  → troca de jogo. Colocar no topo do README.
- README: hero visual antes do texto.
- Ícone do app e da bandeja alinhados com a identidade nova
  (`assets/icon.png`, `assets/tray.png`, `build/icon.ico` via `npm run icons`).

**Aceite:** README abre com imagem, não com parágrafo.

---

## 4. Riscos técnicos

| Risco | Mitigação |
|---|---|
| CSP bloqueia `@font-face` | Adicionar `font-src 'self'` — sem isso a fonte falha em silêncio e cai no fallback |
| Fontes variáveis aumentam o instalador | Subset latin + `unicode-range`; ~40–70KB cada em woff2 |
| Janela é `transparent` e não redimensionável (`WIN_W = 360` fixo) | Todo layout novo precisa fechar em 360px; nada de breakpoint |
| Altura fixa 600 / compacto 316 ([main.js:28-30](main.js)) | Se o layout novo mudar a altura ideal, ajustar as constantes junto — senão sobra moldura vazia |
| `pushState()` dispara render frequente | Sequência de boot precisa de guard por `appid`, senão fica reanimando |
| Nenhum teste cobre `renderer.js` | Fase 2 muda a lógica de leitura — vale um teste de `setReading`/escala antes de mexer |

---

## 5. Status — o que foi entregue

Fases 0–3 implementadas e verificadas no layout real (harness de preview com
`window.api` mockado, gerado a partir do `index.html` de produção, 12 cenas).
`npm run verify`: 106/106 testes passam.

### Decidido durante a execução

| Decisão | Valor |
|---|---|
| Estética | Instrumento refinado (não brutalismo) |
| Cor de sinal | **Extraída da arte do jogo** (fallback: `#96BF3E`, verde de ação da Steam) |
| Display | Archivo Variable (`wght` 100–900, `wdth` 62–125), 80 KB |
| Dados | Martian Mono SemiCondensed 400/600, 17 KB cada |
| Datum da escala | 70% — `scoreFromRatio` mapeia ratio 1.0 → 70 em GPU, CPU e RAM |
| `WIN_H` | 600 → **584** (pior caso medido: 565px + uma fileira de chips) |
| `WIN_H_COMPACT` | 316 → **350** (necessário: 350px — o compacto agora mostra a arte) |

### Primeira versão foi conservadora demais

A tentativa inicial rearranjou o layout mas manteve o fundo quase-preto, as três
barras empilhadas e — pior — **apagou a arte** (opacity 0.5 sob véu pesado).
Resultado: "ficou com a mesma cara, perdeu a identidade que é o banner do jogo".
Correto. A arte era a única coisa com personalidade e eu a mutei.

A correção foi inverter a relação: em vez de a interface hospedar a arte, a arte
comanda a interface. Verificado com seis headers reais da Steam (Cyberpunk,
DOOM, Hades, Stardew, Elden Ring, Baldur's Gate 3) — seis apps visualmente
distintos.

### Defeitos encontrados e corrigidos de passagem

1. **`backdrop-filter: blur(6px)` era no-op.** Com `transparent: true` no Windows
   o Chromium não amostra o desktop atrás da janela. Custava GPU e não pintava
   nada. Substituído por superfície sólida + camada de grão.
2. **`[hidden]` não escondia nada.** Regras de autor como `.toggle{display:flex}`
   vencem o `[hidden]{display:none}` da folha do user-agent, então seções
   "escondidas" continuavam pintando. Travado com `[hidden]{display:none!important}`.
3. **`✓` e `✗` não existem na Martian Mono** (medidos: 8.99px e 9.80px contra
   7.80px dos glifos reais) — caíam numa fonte de sistema e desalinhavam.
   Redesenhados como SVG.
4. **106px de moldura vazia** embaixo dos chips, por a janela ser mais alta que o
   conteúdo. Resolvido medindo o pior caso e ajustando as constantes.

### Verificado, não presumido

- `canvas.getImageData()` sobre a arte em `data:` URL **não fica tainted** sob o
  CSP real (`img-src 'self' data:`) — testado dentro do Electron, com o
  `index.html` de produção, nos seis headers. Zero bloqueios de CSP.
- As três `@font-face` carregam sob `font-src 'self'` em `file://`.
- O eixo `wdth` da Archivo responde: 237.72px → 177.03px em `font-stretch: 70%`.
- `npm run verify`: 106/106.

### Puxado da Fase 4

O estado ocioso ficava com ~400px de vazio e é a tela mais vista do app. Como
`state.specs` já carrega tudo, ele passou a mostrar a **ficha da máquina do
usuário** (GPU + VRAM, CPU + núcleos/clock, RAM, SO/DirectX/arch, disco livre).
O resto da Fase 4 continua pendente.

## 6. O que fica pendente

1. **`docs/shot-*.png` mostram o design antigo.** O README aponta para eles.
   Regravar é Fase 5. `shot-minimo.png` já regravado (Resident Evil 4, modo CDP,
   tema vermelho extraído da arte). Faltam `shot-recomendado.png`,
   `shot-config.png` e `shot-compacto.png`.
2. **Fase 4 restante** — estados `setup`/`no-steam`/erro ainda usam a caixa de
   mensagem padrão (funcional e coerente, mas sem tratamento próprio).
3. **Fase 5 inteira** — GIF de demonstração, hero no README, ícones do app e da
   bandeja alinhados com a identidade nova.
4. **Nenhum teste cobre `renderer.js`.** A lógica de bandas e de posicionamento
   da régua agora tem regras suficientes para justificar teste.
