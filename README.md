# Pit Wall Manager

Manager de F1 em pixel art no navegador. Você é o engenheiro-chefe: acerta o carro no treino,
classifica numa volta única e decide pneus, combustível e paradas na corrida.

## Rodar no PC

```bash
npm install
npm run dev      # jogo em http://localhost:5179 (solo funciona só com isso)
npm run server   # em outro terminal: servidor do modo online (porta 8787)
```

Pra jogar online com amigos na mesma rede: `npx vite --host` e passe o IP da sua máquina.

## Publicar (online de verdade)

O servidor (`server/index.ts`) serve o jogo **e** o online numa porta só:

```bash
npm run build && npm start   # usa a variável PORT
```

No Render: suba o projeto pro GitHub, crie um **Blueprint** apontando pro repositório
(o `render.yaml` já está pronto). A Vercel não serve, porque não mantém WebSocket aberto.

## Estrutura

- `src/sim/`: simulação (TypeScript puro, determinística por seed): corrida, pneus, combustível,
  clima, acerto do carro, treino e classificação, IA com engenheiros bons e ruins.
- `src/net/room.ts`: fluxo do fim de semana. Roda no navegador (solo) ou no servidor (online).
- `src/render/`: pista e carros em pixel art (canvas), câmera seguindo um carro.
- `src/ui/`: telas (menu, lobby, treino, classificação, estratégia, HUD, pódio).

## Testes

```bash
npx tsx scripts/sim-test.ts <seed> <voltas> <pista 0-2> [equal]   # corrida sem tela
PORT=8799 npm start   +   npx tsx scripts/net-test.ts 8799           # online ponta a ponta
npx tsx scripts/shot.ts <url> <pasta> "click:#m-solo;wait:1000;shot:x"  # prints no Edge
```

## Créditos

- Traçados reais das pistas: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), licença MIT, Copyright (c) 2019-2025 Tomislav Bacinger (texto em `public/licencas/f1-circuits-MIT.txt`). Dados não oficiais, sem ligação com a Formula One.
- Gerados com `node scripts/gen-real-tracks.mjs <f1-circuits.geojson> <meta.json>`.
