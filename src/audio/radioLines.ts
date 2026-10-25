// Falas gravadas do rádio da equipe (geradas com o Piper: scripts/gen-radio.ts).
// Cada aviso do jogo (texto do rádio) cai numa fala pelo "match"; cada fala tem algumas versões
// pra não repetir sempre igual. Arquivos: public/radio/<id>_<n>.wav
// Frases sem números/nomes soltos: o áudio é fixo (o texto na tela continua com os detalhes).

export type RadioWho = "driver" | "engineer";

export interface RadioLine {
  id: string;
  who: RadioWho;
  /** reconhece o aviso do jogo pelo texto (sem o "Rádio XXX:") */
  match: RegExp;
  lines: string[];
}

export const RADIO_LINES: RadioLine[] = [
  // ---------- piloto ----------
  {
    id: "motor",
    who: "driver",
    match: /^O motor está sofrendo/,
    lines: ["O motor tá sofrendo. Melhor poupar, senão ele quebra.", "Tô sentindo o motor estranho. Acho bom poupar.", "O motor não tá legal, vou ter que maneirar."],
  },
  { id: "dano_asa_d", who: "driver", match: /^Problema na asa dianteira/, lines: ["Danifiquei a asa dianteira! Tô perdendo tempo, troca no box?", "Quebrou a asa da frente! O carro não vira."] },
  { id: "dano_asa_t", who: "driver", match: /^Problema na asa traseira/, lines: ["A asa traseira tá danificada! A traseira tá solta.", "Tô sem asa traseira direito, o carro tá escapando!"] },
  { id: "dano_susp_d", who: "driver", match: /^Problema na suspensão dianteira/, lines: ["Acho que entortou a suspensão da frente! Puxando pro lado.", "A suspensão dianteira tá danificada, o carro tá estranho!"] },
  { id: "dano_susp_t", who: "driver", match: /^Problema na suspensão traseira/, lines: ["A suspensão traseira tá danificada! A traseira não segura.", "Bati e a traseira ficou estranha, acho que é a suspensão!"] },
  { id: "dano", who: "driver", match: /^Problema na /, lines: ["Tenho dano no carro! Tô perdendo tempo, box pra trocar?"] },
  {
    id: "pneu_fim",
    who: "driver",
    match: /^Os pneus acabaram/,
    lines: ["Os pneus acabaram! Box, box!", "Não tenho mais pneu, preciso parar agora!", "Tô sem aderência nenhuma, os pneus foram embora!"],
  },
  {
    id: "pneu_caindo",
    who: "driver",
    match: /^Pneus começando a cair/,
    lines: ["Pneus começando a cair.", "Tô começando a perder aderência.", "Os pneus já tão indo embora."],
  },
  { id: "chuva_w", who: "driver", match: /^Tem muita água/, lines: ["Tem muita água! Preciso de pneu de chuva!", "Tá um aguaceiro aqui, quero o pneu de chuva!"] },
  { id: "chuva_i", who: "driver", match: /^Pista molhada demais pro slick/, lines: ["Pista molhada demais pro pneu liso. Intermediário!", "Tá escorregando muito, é hora do intermediário."] },
  { id: "secando", who: "driver", match: /^A pista está secando/, lines: ["A pista tá secando, já dá pra ir de pneu liso.", "Já tem trilho seco, dá pra colocar pneu liso."] },
  { id: "inter_w", who: "driver", match: /^Muita água pro intermediário/, lines: ["Muita água pro intermediário, quero o de chuva!", "O intermediário não dá conta, tem água demais!"] },
  { id: "comb_fim", who: "driver", match: /^Combustível no fim/, lines: ["Combustível no fim! Box agora ou a gente para!", "O combustível tá acabando, preciso parar!"] },
  { id: "comb_pouco", who: "driver", match: /^Combustível só pra mais/, lines: ["O combustível tá ficando apertado.", "Combustível só pra mais umas poucas voltas."] },
  // problemas mecânicos (FAULTS)
  { id: "furou", who: "driver", match: /^Furou o pneu/, lines: ["Furou o pneu! Tô me arrastando, preciso do box!", "Pneu furado, pneu furado! Tô entrando!"] },
  { id: "cambio", who: "driver", match: /^O câmbio/, lines: ["O câmbio tá pulando marcha!", "Problema no câmbio, as marchas não entram direito!"] },
  { id: "freio", who: "driver", match: /^Pedal de freio/, lines: ["Pedal de freio tá longo, vou ter que frear antes.", "O freio tá fraco, tô freando antes."] },
  { id: "potencia", who: "driver", match: /^Tô perdendo potência/, lines: ["Tô perdendo potência na reta!", "O carro tá sem força, perdi potência!"] },
  { id: "hidraulica", who: "driver", match: /^Luz da hidráulica/, lines: ["Luz da hidráulica acesa no painel!", "Alarme da hidráulica! O que eu faço?"] },
  // ---------- engenheiro ----------
  { id: "ordem_passar", who: "engineer", match: /deixa o .* passar/, lines: ["Atenção: deixa o seu companheiro passar.", "Ordem de equipe: abre pro seu companheiro."] },
  { id: "ordem_manter", who: "engineer", match: /^Mantenham as posições/, lines: ["Mantenham as posições, sem briga entre vocês.", "Segurem as posições. Nada de disputa entre vocês."] },
  { id: "ordem_livre", who: "engineer", match: /^Estão liberados/, lines: ["Estão liberados pra correr.", "Liberados. Podem disputar."] },
  { id: "plano", who: "engineer", match: /^era pra parar nesta volta/, lines: ["Era pra parar nesta volta. Vamos pro box?", "Volta da parada do plano. Chamo pro box?"] },
  { id: "teste", who: "engineer", match: /^Rádio ligado/, lines: ["Rádio ligado. Tá me ouvindo bem?"] },
];

/** fala gravada pro aviso (texto já sem o "Rádio XXX:") */
export function radioLineFor(text: string): RadioLine | undefined {
  return RADIO_LINES.find((l) => l.match.test(text));
}
