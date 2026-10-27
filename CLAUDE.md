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

## Prioridades (decididas pelo usuário em 2026-10-26)
1. **Autódromos reais**: baixar do OpenStreetMap (Overpass) brita, areia, grama, asfalto de escape, arquibancadas, boxes, muros e zebras de cada pista, alinhados com o traçado atual (que veio só como linha, do f1-circuits). Fazer relatório de quais pistas vieram completas; só pras incompletas o usuário manda print de satélite. Serve de base pra pista 3D.
2. **Três modos gráficos** (o usuário viu o FPS subir no 2D):
   - **2D**: o desenho vetorial antigo (o mais leve).
   - **2D estilizado**: o "3D" atual, com imagens pré-renderizadas do Blender.
   - **3D de verdade** (Three.js, mesmo motor do pódio), em etapas: carros primeiro (protótipo com pista 2D), depois pista 3D, depois câmeras novas (TV, atrás do carro, onboard 3D real).
   - Só o modo escolhido carrega e roda (o 3D é baixado só quando ativado, como o pódio). Nunca dois ao mesmo tempo.
3. **Configurações gráficas pra PC fraco**: medir o que pesa (FPS caiu pra 15 no notebook do usuário) e ter opções além do modo: onboard on/off, partículas (faísca, fumaça, poeira, confete), chuva e spray, marcas de pneu, sombras, resolução/escala da tela, qualidade do pódio 3D, limite de FPS. Meta: quem tem PC ruim também consegue jogar.
   - **Botão "TESTE DE FPS"** nas configurações gráficas: roda uma corrida de demonstração curta (sem mexer no jogo salvo) com as opções escolhidas e mostra o FPS médio e o mínimo. Se ficar baixo, sugere o que desligar (ex.: "desligue a onboard e as partículas"). Opcional: "ajustar automático", que testa e escolhe as opções sozinho.

## Ideia de distribuição (não é pra agora)
- O jogo não vai ser vendido. Se for aberto pra outras pessoas jogarem: opção de contribuir com qualquer valor (doação) e um **pacote Plus** com mais edições, por exemplo criar/editar carros, pinturas e uniformes extras.

## Pendências
- Rebuild do .exe; zebras/bumps reais por foto das pistas; IA do rádio (voltar com Whisper maior/Ollama).
- Ideia futura: pilotos com rosto/corpo; interfaces em 3D.
- Adiados: modo pilotos novos, nome do rival na voz, botão "Baixar pro PC".

## Onde paramos (atualizar ao fim de cada sessão)
- 2026-10-26 (publicado até o commit 33957dc): incidentes com física, guindaste, pódio 3D (Victory + palmas por IK), uniforme, onboard com braços, SC/guindaste 3D.
- Publicado depois (2026-10-26, noite):
  - Carros 3D de verdade (src/render/cars3dReal.ts, public/car3d/carro.glb via art/export_carro_glb.py) sobre a pista 2D; `?carros=3d` força o modo.
  - Configurações (engrenagem do menu = ⚙ CONFIGURAÇÕES com abas PERFIL e GRÁFICOS; src/render/gfx.ts guarda): carros 2D / 2D estilizado / 3D, antisserrilhado, sombras/faíscas/fumaça/chuva/marcas de pneu em níveis (desligado/baixo/médio/alto), onboard on/off, pódio 3D/desenhado, limite de FPS, predefinições MÍNIMO/BAIXO/MÉDIO/ALTO e TESTE DE FPS (`?auto&fpsteste`, src/ui/fpsTest.ts; volta em `?config=graficos`).
  - Rodas esterçam pela curva real do carro (troca de faixa/desvio), não só pela da pista.
  - Encosto entre carros pelo tamanho desenhado (VIS_L 4,8 × VIS_W 1,9 m): encostou na tela = toque; ~4-5 toques por corrida.
  - Carro 3D: desenhos da pintura projetados de cima (UV planar), faixa do composto na borda do pneu, rodas só com o que gira (freio no corpo) e pivô no centro.
  - Spray na chuva (névoa + água das rodas, nuvens macias), faíscas novas (branca→vermelha, finas, por baixo dos carros).
  - Menu principal: botão CONFIGURAÇÕES (abas GRÁFICOS e SONS; `showSettings` em menu.ts); limite de FPS digitado (15-360, ritmo constante).
  - Corrida: FPS + ☰ MENU no canto inferior esquerdo (src/ui/raceMenu.ts: continuar, sons, configurações, voltar ao menu; pausa no solo, online não). Som/rádio/música/volume saíram da barra de cima (src/ui/soundPanel.ts).
  - Safety car e guindaste em 3D de verdade no modo 3D (public/props/sc.glb e crane.glb via art/export_props_glb.py; giroflex aceso + luz laranja, sombra). Nos outros modos, a imagem de cima.
  - Esc na corrida abre o MENU; a barra de cima some na corrida (MENU, ? e ⛶ no canto; microfone dentro do MENU).
  - Incidentes: volta pilotada pra pista (180 cantando pneu se de costas), colisão pelo tamanho do carro virado (extent), desvio cedo de carro rodado; Modo TV com prioridade pra rodada/guindaste; abandono pela aba BOX; lança do guindaste 3D estendida.
  - Autódromo real (OpenStreetMap): scripts/osm-track.ts encaixa o entorno no traçado do jogo (por s e distância lateral; longe da pista vira projeção direta) → public/autodromos/interlagos.json (Interlagos é o índice 71; o 3 é a versão antiga à mão, desativada). Prévia: /_osm_preview.html. Pista 3D (src/render/track3d.ts) em teste, desligada por padrão (Configurações > Gráficos > "Pista em 3D"); `?auto&pista=interlagos`.
  - Próximo: a pista 3D ficou com cara de blocos (vista de cima + prédios só com o contorno). Plano: câmera inclinada no modo 3D (marcas/faíscas/spray/etiquetas no 3D), detalhes perto da pista (arquibancadas, boxes, barreiras, árvores), brita/escape de Interlagos por print de satélite, otimização (só o que aparece na tela, cidade simples de longe). Fazer numa conversa nova.
- Publicado (2026-10-27): entorno 3D estilo cartoon low-poly em QUALQUER pista (peças em src/render/trackParts.ts: arquibancada com cadeiras em L, boxes 2 andares + torre, paddock com tendas/motorhomes, pneus, placas com marcas inventadas, pinheiros; montagem em track3d.ts; OSM só acrescenta casas/bosques/ruas) e protótipo de câmera inclinada (`?camera=tv` atrás do carro, `?camera=iso` de lado e de cima, botão direito arrastando gira; só no modo 3D e em Interlagos): câmera em perspectiva atrás/acima do carro seguido, autódromo na mesma cena, céu e neblina. Ainda sem marcas de pneu, faíscas, spray e etiquetas nessa câmera.
- Próximo pedido: EDITOR DE AUTÓDROMO dentro do jogo (mover/girar/apagar/adicionar peças: arquibancada, boxes, prédios, casas, árvores, placas, pneus, carros parados; salvar por pista em JSON que o track3d.ts lê por cima do automático). Usar as peças de trackParts.ts. Depois: tipo de chão (brita/grama/escape) e traçado. Fazer numa conversa nova.
- Publicado também: câmera do 3D nas Configurações > Gráficos (gfx.cam3d: cima/lado/tras) e tecla V na corrida (a câmera desliza em ~0,9 s até a nova; de cima vira câmera 3D olhando reto pra baixo durante a troca); nas inclinadas, marcas/faíscas/fumaça/spray/pedaços/etiquetas são desenhados depois da cena 3D, projetados pela câmera 3D (RealCars.project/scaleAt); vista de cima 3D com sol alto (sombra sem cortes). Som não depende da câmera.
- Ideia pedida: "2D estilizado do 3D" = assar (bake) o autódromo 3D visto de cima em imagens (tiles) uma vez por pista e usar como fundo do 2D (visual do 3D, peso do 2D). Fazer depois do editor.
