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
  /** reação a um evento da corrida (casa com o texto inteiro do aviso, não só com o rádio) */
  react?: boolean;
  /** chance de falar (pra não reclamar de tudo) */
  chance?: number;
  /** quem fala é o carro citado por último no texto (ex.: "A passa B": fala o B) */
  target?: "last";
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
  // ---------- piloto bravo (reações) ----------
  {
    id: "raiva_box",
    who: "driver",
    react: true,
    match: /^Parada lenta de /,
    lines: ["Que parada foi essa?! Perdi um tempão!", "Pô, pessoal! Que demora foi essa no box?", "De novo uma parada lenta? Assim não dá, caramba!"],
  },
  {
    id: "raiva_liberacao",
    who: "driver",
    react: true,
    match: /liberação insegura/,
    lines: ["Punição por culpa do box? Vocês tão de brincadeira comigo!", "Me soltaram em cima do outro carro! Que porcaria foi essa?"],
  },
  {
    id: "raiva_estrategia",
    who: "driver",
    react: true,
    match: /não usou 2 compostos/,
    lines: ["Ninguém me avisou do segundo pneu? Que vacilo, pessoal!", "Punição por erro de estratégia? Que vergonha!"],
  },
  {
    id: "raiva_toque_dano",
    who: "driver",
    react: true,
    match: /danificou a .* no toque com/,
    lines: ["Ele me acertou! Esse cara é maluco!", "Você viu isso? Ele jogou o carro em cima de mim!", "Quebrou meu carro! Isso tem que ser punição!"],
  },
  {
    id: "raiva_rodou_toque",
    who: "driver",
    react: true,
    match: /rodou depois de um toque/,
    lines: ["Ele me rodou! Isso tem que ser punição!", "Me tocou e me rodou! Inacreditável!"],
  },
  { id: "raiva_toque", who: "driver", react: true, chance: 0.5, match: /^Toque entre /, lines: ["Ei! Ele me tocou!", "Que isso, cara? Encostou em mim!"] },
  {
    id: "raiva_ultrapassado",
    who: "driver",
    react: true,
    chance: 0.3,
    target: "last",
    match: /^\S+ passa \S+!$/,
    lines: ["Ele me fechou na freada!", "Droga, perdi a posição!", "Esse carro tá voando na reta, não consigo segurar!"],
  },
  { id: "raiva_ordem", who: "driver", react: true, match: /cumpre a ordem e deixa/, lines: ["Tá bom, deixei passar. Mas eu era mais rápido!", "Sério isso? Tá, vou deixar ele passar."] },
  { id: "batida", who: "driver", react: true, match: / bateu|bateu no muro|preso na brita/, lines: ["Bati! Acabou pra mim. Desculpa, pessoal.", "Droga! Tô fora, o carro já era."] },
  { id: "raiva_motor", who: "driver", react: true, match: /o motor quebrou/, lines: ["O motor estourou! Que porcaria de motor!", "Quebrou o motor! Não acredito, eu tava indo bem!"] },
  { id: "raiva_comb", who: "driver", react: true, match: /ficou sem combustível/, lines: ["Fiquei sem combustível? Quem fez essa conta?!", "Acabou o combustível! Vocês erraram a conta, pessoal!"] },
  // ---------- piloto respondendo a você (o engenheiro é o jogador) ----------
  // ordens de equipe: o aviso "Rádio: ..." é você falando; quem responde é o piloto
  { id: "ordem_passar", who: "driver", match: /deixa o .* passar/, lines: ["Entendido, vou abrir pra ele.", "Copiado, deixo ele passar."] },
  { id: "ordem_manter", who: "driver", match: /^Mantenham as posições/, lines: ["Entendido, mantenho a posição.", "Copiado, sem briga com o companheiro."] },
  { id: "ordem_livre", who: "driver", match: /^Estão liberados/, lines: ["Valeu! Agora é pra valer.", "Entendido, vou pra cima."] },
  { id: "plano", who: "driver", match: /^era pra parar nesta volta/, lines: ["Tá na volta do plano. Entro no box?", "Era pra parar agora, né? Confirma o box?"] },
  { id: "teste", who: "driver", match: /^Rádio ligado/, lines: ["Rádio ok, tô te ouvindo bem."] },
  // resposta ao seu comando de voz (tocadas pelo id)
  { id: "ok_box", who: "driver", react: true, match: /^$/, lines: ["Copiado, entrando no box.", "Entendido, box nesta volta."] },
  { id: "ok_cancela", who: "driver", react: true, match: /^$/, lines: ["Ok, fico na pista.", "Entendido, cancelado."] },
  { id: "ok_atacar", who: "driver", react: true, match: /^$/, lines: ["Entendido, vou pra cima!", "Copiado, modo ataque."] },
  { id: "ok_poupar", who: "driver", react: true, match: /^$/, lines: ["Copiado, vou poupar os pneus.", "Entendido, maneirando."] },
  { id: "ok_normal", who: "driver", react: true, match: /^$/, lines: ["Ok, ritmo normal."] },
  { id: "ok_rico", who: "driver", react: true, match: /^$/, lines: ["Motor rico, entendido."] },
  { id: "ok_pobre", who: "driver", react: true, match: /^$/, lines: ["Copiado, motor pobre."] },
  { id: "ok_motor_normal", who: "driver", react: true, match: /^$/, lines: ["Motor no normal, ok."] },
  { id: "ok_pneu", who: "driver", react: true, match: /^$/, lines: ["Entendido, esse pneu na próxima parada.", "Copiado, anotado o pneu."] },
  { id: "nao_entendi", who: "driver", react: true, match: /^$/, lines: ["Não entendi, repete?", "Não copiei. Pode repetir?"] },
];

/** fala gravada pro aviso (texto já sem o "Rádio XXX:") */
export function radioLineFor(text: string): RadioLine | undefined {
  return RADIO_LINES.find((l) => !l.react && l.match.test(text));
}

/** reação do piloto a um evento da corrida (texto inteiro do aviso) */
export function reactionFor(text: string): RadioLine | undefined {
  return RADIO_LINES.find((l) => l.react && l.match.test(text));
}
