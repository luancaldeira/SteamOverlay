# Steam Spec Overlay

Overlay de desktop que **detecta automaticamente** qual página de jogo está aberta no
**app desktop da Steam**, lê os requisitos mínimos/recomendados, compara com as specs
reais do seu PC e mostra a compatibilidade em porcentagem — em tempo real, por cima da
janela da Steam. Sem digitar ou colar nada.

![status](https://img.shields.io/badge/plataforma-Windows-blue) ![status](https://img.shields.io/badge/steam-app%20desktop-informational)

> ⚠️ **Suporte: só Windows + app desktop da Steam.** Não funciona com a Steam no
> navegador, nem no macOS/Linux. Não é um overlay dentro do jogo — é sobre a janela da
> **loja** da Steam.

---

## Como funciona

O cliente desktop da Steam é uma aplicação Chromium (CEF) que pode expor um endpoint de
*remote debugging* (protocolo Chrome DevTools). O app lê esse endpoint para descobrir
qual página `store.steampowered.com/app/<APPID>` está aberta — **sem OCR, sem ler
pixels, sem scraping da janela nativa**. A partir do APPID ele busca os requisitos na
loja, lê as specs da máquina e calcula a compatibilidade.

Se o debug do CEF não estiver disponível, cai para um **modo fallback** que lê o título
da janela em foco da Steam (menos confiável). O indicador de modo no topo mostra qual
está ativo: `CDP` (verde) ou `FALLBACK` (âmbar).

---

## Instalação

### Usuário final

1. Baixe e rode o instalador `Steam Spec Overlay Setup x.y.z.exe` (ou a versão
   *portable*) da pasta `dist/`.
2. Abra o app. Na primeira vez ele vai pedir para **ativar a detecção automática**
   (passo do flag de debug abaixo).

### Desenvolvimento

```bash
npm install
npm start          # roda o overlay
npm test           # roda os testes da lógica de comparação
npm run dist       # gera instalador NSIS + portable em dist/
```

Requer Node.js 18+ (testado no Node 24) e Windows.

---

## Passo obrigatório: ativar o debug do CEF da Steam

A Steam só abre a porta de debug se existir um arquivo-flag vazio chamado
`.cef-enable-remote-debugging` na raiz da pasta de instalação
(ex.: `C:\Program Files (x86)\Steam\.cef-enable-remote-debugging`).

O app faz isso pra você:

1. Ao abrir sem detecção ativa, clique em **“Ativar debug”** no overlay. Ele encontra a
   pasta da Steam (pelo registro do Windows) e cria o arquivo.
2. **Feche a Steam completamente** (inclusive o ícone na bandeja do sistema) e abra de
   novo.
3. Pronto — o indicador muda para `CDP` e o overlay passa a detectar os jogos sozinho.

> Se a criação do arquivo falhar por permissão, crie manualmente um arquivo vazio com
> esse nome na pasta da Steam e reinicie a Steam.

---

## Uso

- Abra a página de um jogo na loja da Steam. Em poucos segundos o overlay mostra o
  jogo, um medidor de compatibilidade em % e a quebra por **GPU / CPU / RAM**.
- Alterne entre **Recomendado** e **Mínimo** no topo.
- Trocar de jogo atualiza o overlay automaticamente. Sair da página deixa o overlay em
  estado de espera.
- Atalho global **`Ctrl+Shift+S`** para mostrar/esconder o overlay. Se esse combo
  já estiver em uso por outro app, o overlay tenta `Ctrl+Alt+S` e depois
  `Ctrl+Shift+F10`. Mesmo que nenhum atalho fique disponível, **abrir o app de novo**
  traz a janela de volta (instância única).
- Arraste pela barra de título para reposicionar.

---

## Limitações e avisos

- **A % é uma estimativa, não uma medida exata.** Requisitos da loja são texto livre e
  imprecisos (“or better”, “equivalent”). Use como referência de ordem de grandeza.
- A **tabela de benchmark é interna e estimada** (`data/cpu-benchmarks.json` e
  `data/gpu-benchmarks.json`). Se sua CPU/GPU aparecer como “não identificado”, ela não
  está na tabela — é só adicionar a entrada (chave em minúsculas → pontuação relativa).
  O componente não identificado é **excluído** do cálculo, nunca chutado.
- **Requisitos de CPU ambíguos** (ex.: “4 hardware CPU threads”, “Dual core 2.8 GHz”,
  “Quad-core from Intel or AMD”) são tratados: quando não há um modelo reconhecível, o
  app compara diretamente o número de núcleos/threads/clock reais do seu processador
  contra o que o requisito pede. O matching de modelos também é insensível a hífen
  (“i5 750” = “i5-750”).
- A detecção depende do comportamento do cliente Steam (flag de debug, porta CDP). A
  Valve pode mudar isso em versões futuras; por isso existe o modo fallback.
- Jogos só-console ou sem bloco de requisitos de PC aparecem como
  **“requisitos indisponíveis”**.

---

## Estrutura

```
steam-spec-overlay/
  main.js                 processo Electron: janela + orquestração + IPC
  preload.js              ponte segura main↔renderer (contextIsolation)
  index.html / styles.css / renderer.js   UI do overlay (HUD)
  lib/
    steamDebug.js         acha porta CDP, lê /json, extrai appid, faz polling
    steamSetup.js         acha a pasta da Steam (registro), cria o flag de debug
    steamScraper.js       busca+parseia requisitos por appid (com cache)
    detectSpecs.js        specs reais da máquina (systeminformation)
    compare.js            matching CPU/GPU + cálculo da %
    windowFallback.js     plano B via título de janela (Win32)
  data/
    cpu-benchmarks.json
    gpu-benchmarks.json
  test/                   testes da lógica pura (node:test)
```

## Licença

MIT.
