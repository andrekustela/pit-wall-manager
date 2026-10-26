# Pit Wall Manager

Jogo de gestão de F1 (navegador). Vite + TypeScript no cliente, Node + WebSocket (`server/`) pro online.
Responder sempre em pt-BR (inclusive descrições de ferramentas). Usuário prefere respostas curtas e economia de tokens.

## Comandos
- `npm run dev -- --port 5179` → http://localhost:5179 (o `jogo.bat` faz isso num clique)
- `npm run server` → servidor do modo online (local)
- `npm run build` → `tsc` + `tsc -p server` + vite build (rodar antes de publicar)
- `npm run sim` / `npx tsx scripts/<nome>.ts` → testes de simulação (sim-test, balance, racing-line, net-test...)
- `npx tsx scripts/shot.ts` → screenshot headless no Edge via CDP (wait/shot/evalfile/click). Matar os processos do Edge headless depois.

## Publicar
- `git push` na `main` (github andrekustela/pit-wall-manager) → Render publica sozinho em https://pit-wall-manager.onrender.com
- **Sempre perguntar antes de publicar** (a permissão vale só pra aquela vez: "pode publicar").

## Parâmetros de URL (teste)
`?auto&debug`, `&hold=practice|quali|strategy`, `&once`, `?bandeira=calma`, `?ia` (liga a IA do rádio, pausada), `?caos` (40x mais rodadas/batidas: ver guindaste e SC).

## Mapa do código
- `src/sim/` — simulação: `race.ts` (corrida, linha ideal, vácuo/DRS, ultrapassagem, inércia lateral), `track.ts` (pistas, linha, zonas DRS, zebras/bumps), `damageFx.ts` (dano por peça), `officialLaps.ts` (voltas em % das oficiais, arred. pra cima), `weekend.ts`, `tuning.ts`, `drivers.ts`, `data.ts`
- `src/net/` — `room.ts` (sala/regras, pickDriver, campeonato), `protocol.ts` (mensagens/LobbyState), conexão local ou WS
- `src/ui/` — telas: `menu`, `lobby`, `drivers` (sorteio/escolha), `practice`, `quali`, `strategy`, `hud` (corrida), `results`; `transition.ts`, `flagField.ts`/`checkerFlag.ts` (bandeiras), `menuBg.ts`
- `src/render/` — `renderer.ts`, `carFx.ts` (faíscas do assoalho)
- `src/main.ts` — fluxo entre telas; IA do rádio (`radioAI.ts`, workers LLM/TTS/STT) desligada sem `?ia`
- `desktop/` — versão .exe (Electron; desatualizada). Remover `ELECTRON_RUN_AS_NODE` do ambiente antes de rodar.

## Regras
- Sem marcas reais (Ferrari etc.) em arte/assets; nomes de pilotos oficiais ok.
- Pacotes da IA com versão fixa (piper-tts-web 1.0.5, onnxruntime-web 1.18.0, web-llm 0.2.78, transformers 3.7.6).
- Pedidos visuais costumam sair diferentes do imaginado: confirmar o que ficou diferente.

## Pendências
- Rebuild do .exe; zebras/bumps reais por foto das pistas; IA do rádio (voltar com Whisper maior/Ollama).
- Ideia futura: pilotos com rosto/corpo; interfaces em 3D.
- Adiados: modo pilotos novos, nome do rival na voz, botão "Baixar pro PC".

## Onde paramos (atualizar ao fim de cada sessão)
- 2026-10-26 (publicado):
  - Incidentes com física (`startSlide`/`stepSlide` em race.ts): rodar, passar reto, bater no muro (RUNOFF 13 m), atolar na brita; carro quebrado fica parado e o guindaste retira (`recover`), SC segura enquanto o carro está na pista. Toque só conta se os carros encostam.
  - Onboard: volante e braços parados, girando juntos; braço esmaecido onde o cockpit corta (art/render_onboard.py). Adversários em 11 ângulos (art/render_traseira.py).
  - Pódio 3D em Three.js (src/render/podium3d.ts, public/piloto/piloto.glb comprimido com meshopt; art/export_piloto_glb.py); 2D de reserva. Vencedor: animação Mixamo "Victory" (Downloads/Victory.fbx) passada pro piloto por `scripts/retarget.ts` → public/piloto/victory.json. 2º/3º: palmas por IK de dois ossos (`armIK`). Nomes dos ossos no Three vêm sem ponto (DEF-upper_armL). Pra mais animações: baixar do Mixamo (FBX, sem skin) e rodar o retarget.
  - Uniforme: `suit`/`suitDetail` na Livery, aba PILOTO no editor de pintura (art/render_piloto.py → public/piloto/*.png).
  - Safety car e guindaste 3D vistos de cima (art/render_props.py → public/props; modelos em Downloads/ferrari: safetycar.blend, prop_crane.obj).
