# Changelog

## 1.0.1

### Correções

- **Trava de click-through sem saída.** `Ctrl+Alt+S` (e os fallbacks) só escondiam/
  mostravam a janela — nada desligava o click-through. Com ele ligado, a janela ignora
  todo clique, inclusive no próprio checkbox que o desligaria e no botão de
  configurações necessário pra alcançá-lo. Novo atalho global **`Ctrl+Alt+C`**
  (fallbacks `Ctrl+Shift+C`, `Ctrl+Shift+F11`) sempre desliga o click-through e traz a
  janela pra frente — ação de recuperação, não um toggle, então não trava de novo.

## 1.0.0

Reescrita do núcleo de precisão, do caminho de rede e da camada de produto.

### Precisão

- **API oficial `appdetails` como fonte primária** dos requisitos, com o scraping da
  página da loja rebaixado a fallback. JSON de ~5 KB no lugar de ~500 KB de HTML, e vem
  com o nome canônico e a arte do jogo de brinde.
- **Semântica de “ou”**: um requisito com alternativas (“GTX 1060 ou RX 580 ou Arc A380”)
  agora usa a **mais fraca** delas. Antes vencia o nome de modelo mais comprido, o que
  podia inflar o requisito.
- **Cláusulas de exclusão descartadas**: “RX 580 (Intel UHD 630 não suportada)” não deixa
  mais a UHD 630 virar a régua.
- **Estimativa por família** para modelos fora da tabela: interpolação entre os vizinhos
  da mesma família e geração, marcada com `≈` / selo `ESTIMADO`. Antes o componente era
  simplesmente descartado.
- **Portão de VRAM**: uma placa mais rápida mas com menos VRAM do que o jogo pede tem a
  nota limitada por isso.
- **Nomes de dispositivo higienizados** — `(R)`, `(TM)`, “Advanced Micro Devices, Inc.” e
  companhia deixavam de casar com a tabela.
- **Tabelas de benchmark expandidas**: GPU de 103 → 349 entradas, CPU de 135 → 388.
  Inclui RTX 50, RX 9000, Arc B, Core Ultra, Ryzen 9000/X3D, peças de notebook, APUs e a
  geração 2007–2012 que ainda aparece no requisito mínimo de jogos antigos (Dota 2, CS).
  Nenhum valor pré-existente foi alterado.
- **Nomes de modelo colados** (`GTX1060`, `HD2600`, `9600GT`, `RX6600XT`) passam a casar —
  listagens antigas da loja escrevem assim e nada disso era reconhecido.
- **Requisitos extras passaram a existir**: SO, DirectX, espaço em disco e 64 bits eram
  parseados e jogados fora; agora viram selos ✓/✗ (fora do peso da %, porque não são
  sinal de desempenho).

### Robustez e desempenho

- **Detecção na biblioteca**: páginas `/library/app/<id>` do cliente agora são
  reconhecidas, não só as da loja.
- **Títulos localizados**: um cliente pt-BR devolve “Dota 2 **no** Steam”; o sufixo era
  mantido no nome. Agora é removido, e o nome da API prevalece.
- **Seleção de target CDP** determinística: só `type: page`, loja tem prioridade sobre
  biblioteca, devtools e alvos vazios são ignorados. A porta que funcionou fica lembrada.
- **Fim do desperdício de processos**: com o CDP conectado, o loop de ambiente não dispara
  mais `reg query` nem `tasklist` (eram ~40 processos por minuto, para sempre). O caminho
  da Steam fica em cache e a checagem de processo é limitada e deduplicada.
- **Fallback sem PowerShell**: compilava um shim C# via `Add-Type` a cada tick; agora lê a
  coluna de título que o `tasklist` já imprime, por posição — imune a Windows localizado.
  O resultado da busca também passa a ser validado contra o nome procurado, para não
  mostrar o jogo errado com confiança.
- **Cache em disco** de requisitos, specs e arte, com TTL e leitura *stale*: o segundo
  start é instantâneo e uma página já vista funciona sem internet.
- **Retry com backoff** e erros distintos (`network` / `unavailable` / `no-windows`).
- **Log rotativo em arquivo** no lugar dos `catch {}` silenciosos.

### Produto

- **Ícone do app**, gerado por código (PNG + ICO puros em Node, sem asset externo nem
  biblioteca de imagem) — janela, bandeja e instalador.
- **Ícone de bandeja** com menu: mostrar/esconder, sempre no topo, click-through, iniciar
  com o Windows, abrir pasta de dados, sair. É a rota de recuperação quando nenhum atalho
  global está livre.
- **Painel de configurações** com opacidade, sempre no topo, click-through, modo
  compacto, arte do jogo, iniciar com o Windows e bloco padrão.
- **Posição da janela lembrada**, com validação contra monitores que sumiram.
- **Arte do cabeçalho do jogo** na overlay, buscada no processo principal e entregue como
  data URL — a CSP continua fechada.
- Selo `CACHE` quando os dados vieram do cache após falha de rede; contador animado;
  tooltip com o texto bruto do requisito.

### Qualidade

- Testes: **28 → 104**, cobrindo semântica de alternativas, negação, estimador, VRAM,
  extras, cliente da API (com rede stubada), settings, cache e parsing do `tasklist`.
- `npm run verify` = validador das tabelas + self-check + testes.
- `scripts/validate-tables.js`: duplicatas, alcançabilidade pelo matcher, monotonicidade
  por família/geração e âncoras de ordenação.
- `scripts/selfcheck.js`: smoke test ponta a ponta sem rede e sem Electron, incluindo a
  conferência de que todo `window.api.*` usado pelo renderer existe no preload e tem
  handler no main.

### Correções

- `x`/`y` das configurações viravam `0` na primeira alteração de qualquer preferência
  (`Number(null)` é `0`), o que jogaria a overlay para o canto superior esquerdo.
- O chip de 64 bits imprimia o rótulo duas vezes (“64 bits 64 bits”).
- **Modo compacto não encolhia a janela em runtime.** Uma janela `resizable: false`
  fixa o tamanho via `WM_GETMINMAXINFO` no Windows, então `setSize` era ignorado em
  silêncio: o conteúdo sumia e sobrava a moldura vazia. O flag agora é levantado só
  durante a chamada.
- `loadFile` passou a usar caminho absoluto, em vez de depender do diretório de trabalho.

## 0.1.0

Versão inicial.
