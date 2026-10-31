# Quanto pesa cada coisa no resultado (estado em 2026-10-30)

Medido no código e em 40 corridas simuladas só com IA (20 voltas, 30 pistas diferentes):
`npx tsx scripts/weights.ts 40 20`. Pra refazer depois de mudar o equilíbrio, rodar de novo.

## 1. Por volta: de onde vêm os segundos

O tempo de volta é uma soma (`Race.lapOffset`). Diferença entre o melhor e o pior caso de cada coisa:

| O quê | Diferença por volta | Onde está |
|---|---|---|
| **Acerto do carro** (asas, altura, molas) | até **2,1 s** (padrão 50/50 x ideal); erro pequeno ±5 = 0,15 s; erro médio ±15 = 1,2 s | `tuning.ts`, `scripts/influence.ts` |
| **Pneu** (macio x duro) | **1,65 s** (macio −0,9 / médio 0 / duro +0,75), mas o macio gasta 2,5x mais | `COMPOUNDS` em `types.ts` |
| **Carro** (equipe) | **1,5 s** entre a melhor (Vortex 0,0) e a pior (Ironclad 1,5); o desenvolvimento na temporada tira daí | `TEAMS.carPace` em `data.ts` |
| **Ritmo** (atacar x poupar) | **1,05 s** (atacar −0,4 com 1,5x desgaste e 8x risco; poupar +0,65) | `PACE` em `types.ts` |
| **Combustível** | 0,035 s por kg (tanque de 100 kg = 3,5 s) | `FUEL_WEIGHT` |
| **Motor** (rica x pobre) | **0,7 s** (rica −0,3 gastando 18% mais; pobre +0,4) | `ENGINE` em `types.ts` |
| **Piloto** | **0,18 s** entre o mais rápido (99) e o mais lento (60) da lista de lendas; no grid real a faixa chegou a 0,55 s. Também mexe em desgaste de pneu (±7%), chuva, ultrapassar e defender | `drivers.ts` (`skill = (100 − pace) × 0,0045`) |
| **Desgaste do pneu** | cresce rápido: +0,4 s com metade gasto, explode depois de 70% | `lapOffset` |

## 2. Na corrida inteira (40 corridas com IA)

Correlação com a posição final (1 = decide tudo, 0 = nada):

| | carro | piloto | estratégia (engenheiro da IA) | **posição de largada** |
|---|---|---|---|---|
| correlação | 0,43 | 0,32 | 0,29 | **0,83** |

- **A largada decide quase tudo.** Sabendo a posição de largada, carro, piloto e engenheiro não acrescentam nada. Na corrida cada carro ganha ou perde em média **2,4 posições**.
- **A largada é 56% sorteio.** Carro + piloto + engenheiro explicam só 44% do grid. O resto vem do ruído da classificação (0,22 s) e, principalmente, do **acerto da IA**, que varia muito (1,2 s num erro médio).
- Dentro do que é explicado no resultado final: **carro 57%**, **engenheiro/estratégia 32%**, **piloto 11%**.
- Abandonos: 8% dos carros por corrida.

## 2b. Depois da IA nova (2026-10-30, mesma medição)

A IA agora lê a corrida (ataca com motor rico colada em alguém, defende, poupa sozinha, cobre o undercut,
tenta undercut quando presa, overcut). Resultado em 40 corridas:

| | antes | depois |
|---|---|---|
| posições ganhas/perdidas na corrida (média por carro) | 2,4 | **3,0** |
| a largada decide (correlação com o final) | 0,84 | **0,76** |
| abandonos por corrida | 8% (1,6 carro) | 11% (2,2 carros: 42 batidas, 15 muro, 19 brita, 12 quebras em 40 corridas) |

**Percentual de cada coisa no resultado final (IA x IA):**
- **carro 15%** · **piloto 6%** · **engenheiro/estratégia da IA 4%**
- **75% é a corrida em si**: a classificação (que é 57% sorteio, por causa do acerto), largada, batidas, safety car, chuva, brigas.
- Olhando só o que é explicável: carro 61% · piloto 22% · engenheiro 17%.

Isso mede IA contra IA. A estratégia do JOGADOR não entra aqui: as ferramentas dele (pneu, ritmo, motor, hora do
box) valem mais por volta que o carro (seção 1).

## 2c. Classificação menos sorteio + piloto pesando mais (2026-10-31, pedido do usuário)

- Acerto da IA mais preciso, e cada vez pior conforme o engenheiro piora (`aiTuning`: desvio bom ~2, médio
  ~4,5, ruim ~8,5; era ~8 no médio).
- Piloto com o dobro de peso (`toDriver`: 0,45 → 0,9; entre o mais rápido e o mais lento da lista de lendas
  agora são ~0,36 s por volta). Decisão do usuário: o piloto pode pesar mais, mas **nunca mais que o carro**.

| | antes de tudo | agora |
|---|---|---|
| grid explicado por carro/piloto/engenheiro | 43% (57% sorteio) | **66% (34% sorteio)** |
| dentro do grid: carro / piloto / engenheiro | 57 / 20 / 23 | 65 / 20 / 15 |
| resultado final, do explicável: carro / piloto / engenheiro | 57 / 11 / 32 | **72 / 19 / 9** |
| posições ganhas/perdidas na corrida | 2,4 | 3,5 |
| abandonos | 8% | 10% |

Consequência pro jogador: a IA acerta melhor o carro, então o acerto dele precisa ser bom pra brigar.

## 3. Pra decidir (o que eu mudaria, se for diferente do que você quer)

- **Piloto pesa pouco** (11%, 0,18 s na lista de lendas). Se a ideia é que um Senna faça diferença num carro médio, aumentar o 0,45 de `toDriver` (ex.: 0,9 dobra o peso).
- **Acerto pesa mais que o carro.** Errar o acerto custa até 2 s, mais que a diferença entre a melhor e a pior equipe. Bom pro jogador (a escolha dele importa), mas deixa o grid da IA aleatório. Dá pra deixar a IA errar menos no acerto, pra o grid seguir mais o carro.
- **A corrida muda pouco o que a classificação definiu** (2,4 posições em média). Se quiser mais estratégia na corrida: diferença maior entre os pneus, desgaste mais forte, ou ultrapassagem mais fácil (`ATTACK_BOOST`, vácuo e DRS).
- **Estratégia do jogador:** as ferramentas dele (pneu 1,65 s, ritmo 1,05 s, motor 0,7 s, hora do box) somam mais que o carro. Ou seja, um jogador bom consegue bater carros melhores, o que é o espírito de "engenheiro".
