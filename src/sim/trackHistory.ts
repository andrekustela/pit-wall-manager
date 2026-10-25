// História curta de cada pista (texto nosso, pra tela de carregamento). A chave é o nome da pista no jogo.
export const TRACK_HISTORY: Record<string, string> = {
  "Albert Park":
    "Montado nas ruas do parque em volta do lago de Melbourne, recebe o GP da Austrália desde 1996, quando tomou o lugar de Adelaide. Muitas vezes foi a corrida de abertura da temporada. Em 2022 ganhou um traçado mais rápido, pensado pra facilitar as ultrapassagens.",
  "Austin (COTA)":
    "O Circuito das Américas foi a primeira pista construída especialmente pra F1 nos Estados Unidos e estreou em 2012. A subida íngreme até a curva 1 virou marca registrada, e o primeiro setor é uma homenagem às curvas rápidas de Silverstone.",
  Bahrein:
    "Em 2004 foi o primeiro GP do Oriente Médio, no meio do deserto de Sakhir. Desde 2014 a corrida é à noite, sob refletores. A areia que o vento joga na pista deixa o asfalto escorregadio e castiga os pneus traseiros.",
  Baku:
    "Circuito de rua na capital do Azerbaijão, estreou em 2016. Junta uma reta de mais de 2 km na beira do Mar Cáspio com uma passagem estreitíssima pela cidade velha, ao lado das muralhas do castelo. Safety car por lá é quase certo.",
  "Barcelona-Catalunya":
    "Inaugurado em 1991, recebe o GP da Espanha desde então. Por muitos anos foi a pista dos testes de pré-temporada, e as equipes conhecem cada metro dela. Foi ali que Max Verstappen venceu pela primeira vez, em 2016, com 18 anos.",
  "Buenos Aires":
    "O Autódromo Oscar y Juan Gálvez recebeu o GP da Argentina entre 1953 e 1998, com várias pausas. Juan Manuel Fangio, cinco vezes campeão do mundo, venceu em casa quatro anos seguidos, de 1954 a 1957.",
  "Cidade do México":
    "O Autódromo Hermanos Rodríguez homenageia os irmãos pilotos Ricardo e Pedro Rodríguez. A mais de 2.200 m de altitude, o ar rarefeito tira força do motor e da asa. Voltou ao calendário em 2015, e a passagem pelo estádio virou uma festa.",
  Estoril:
    "Recebeu o GP de Portugal de 1984 a 1996. Em 1984 Niki Lauda foi campeão ali por meio ponto sobre Alain Prost. No ano seguinte, debaixo de um temporal, Ayrton Senna conquistou sua primeira vitória na F1, com a Lotus.",
  Hockenheim:
    "Nasceu em 1932 no meio da floresta, perto de Heidelberg. Até 2001 tinha retas enormes cortando a mata; em 2002 foi encurtada e ganhou o trecho do estádio. Em 2000, na chuva, Rubens Barrichello largou em 18º e venceu pela primeira vez.",
  Hungaroring:
    "Em 1986 recebeu o primeiro GP atrás da Cortina de Ferro. Travado e cheio de curvas, é chamado de \"Mônaco sem muros\", porque ultrapassar ali é muito difícil. Fernando Alonso (2003) e Jenson Button (2006) venceram pela primeira vez nessa pista.",
  Imola:
    "O Autodromo Enzo e Dino Ferrari fica a poucos quilômetros de Maranello. Recebeu o GP de San Marino de 1981 a 2006 e ficou marcado pelo fim de semana trágico de 1994, que mudou para sempre a segurança na F1. Voltou ao calendário em 2020.",
  "Indianápolis":
    "A casa das 500 Milhas, com seu oval de 1909. De 2000 a 2007 a F1 correu num traçado misto que usava parte do oval e um trecho interno. Em 2005, um problema com os pneus fez apenas seis carros largarem.",
  Interlagos:
    "Inaugurado em 1940 na zona sul de São Paulo, entre duas represas (daí o nome). Corre no sentido anti-horário, com o S do Senna logo depois da largada. Senna venceu ali em 1991 com o câmbio travado em sexta marcha, e a pista já decidiu vários títulos, como o de 2008.",
  "Istanbul Park":
    "Inaugurado em 2005, no lado asiático de Istambul. Ficou famoso pela curva 8, uma curva longa de quatro tangências feita em altíssima velocidade. Voltou em 2020, numa pista lisa e molhada, e ali Lewis Hamilton garantiu seu sétimo título.",
  "Jacarepaguá":
    "O autódromo do Rio de Janeiro recebeu o GP do Brasil em 1978 e de 1981 a 1989. Nelson Piquet venceu ali em casa em 1983 e 1986, e o autódromo depois ganhou o nome dele. Foi demolido na década de 2010 pra dar lugar ao Parque Olímpico.",
  Jeddah:
    "Estreou em 2021 na orla do Mar Vermelho. É o circuito de rua mais rápido do calendário, com média acima de 250 km/h e uma sequência de curvas cegas entre os muros.",
  Kyalami:
    "Perto de Joanesburgo, recebeu o GP da África do Sul entre 1967 e 1993. A antiga reta principal, em descida, era uma das mais rápidas do mundo. Em 1983 Nelson Piquet conquistou ali o seu segundo título mundial.",
  "Las Vegas":
    "Corrida de madrugada pela Strip, passando na frente dos cassinos, desde 2023. Nos anos 1980 a cidade já tinha recebido a F1, num traçado montado no estacionamento de um hotel. O frio da noite no deserto deixa os pneus difíceis de aquecer.",
  Lusail:
    "Construído em 2004 para o motociclismo, no Catar, recebeu a F1 pela primeira vez em 2021. As curvas são rápidas e encadeadas, e a corrida acontece à noite, sob refletores.",
  Madring:
    "Circuito novo de Madri, que recebe o GP da Espanha a partir de 2026. Mistura ruas e a área do parque de exposições da cidade e tem uma curva inclinada, a \"Monumental\".",
  "Magny-Cours":
    "No interior da França, recebeu o GP francês de 1991 a 2008. Pista lisa e técnica, com o famoso grampo Adelaide. Michael Schumacher venceu ali oito vezes.",
  "Marina Bay":
    "Em 2008 recebeu a primeira corrida noturna da história da F1. Calor e umidade altíssimos, muros colados e muitas curvas fazem dela uma das provas mais cansativas do ano para os pilotos.",
  Miami:
    "Montado em volta do estádio do Miami Dolphins, estreou em 2022 e tem até uma marina de mentira, com a água pintada no chão. Lando Norris conquistou ali sua primeira vitória, em 2024.",
  "Monte Carlo":
    "O GP mais famoso do mundo corre pelas ruas do principado desde 1929. Túnel, porto, o grampo mais lento do campeonato e quase nenhuma chance de ultrapassar: a classificação vale ouro. Ayrton Senna é o recordista, com seis vitórias.",
  Montreal:
    "Na ilha de Notre-Dame, recebe o GP do Canadá desde 1978, ano em que Gilles Villeneuve venceu em casa. A pista depois ganhou o nome dele. O muro da última chicane é o \"Muro dos Campeões\", que já pegou vários campeões mundiais.",
  Monza:
    "Construída em 1922, é uma das pistas mais antigas do mundo e esteve em quase todos os campeonatos desde 1950. O \"templo da velocidade\" tem as maiores médias do ano, e a torcida da Ferrari invade a reta para o pódio.",
  Mugello:
    "Pista da Ferrari nas colinas da Toscana, famosa no motociclismo. Recebeu a F1 uma única vez, em 2020, no GP da Toscana que marcou a milésima corrida da Ferrari, uma prova com duas bandeiras vermelhas.",
  "Nürburgring":
    "O traçado moderno foi inaugurado em 1984, ao lado do lendário Nordschleife, o \"Inferno Verde\" onde Niki Lauda sofreu o acidente de 1976. Recebeu GPs da Europa e da Alemanha até 2013 e voltou ao calendário em 2020.",
  "Paul Ricard":
    "Construído em 1970 pelo empresário Paul Ricard, no sul da França. É famoso pelas áreas de escape listradas de azul e vermelho e pela longa reta Mistral. Recebeu a F1 de 1971 a 1990 e de novo de 2018 a 2022.",
  "Portimão":
    "O Autódromo do Algarve é cheio de subidas e descidas e parece uma montanha-russa. Estreou na F1 em 2020, e ali Lewis Hamilton passou o recorde de 91 vitórias de Michael Schumacher.",
  "Red Bull Ring":
    "Nas montanhas da Áustria, é a versão curta do antigo Österreichring. A volta é rápida, com poucas curvas e subidas fortes. Voltou ao calendário em 2014, já com o nome da Red Bull.",
  Sepang:
    "Na Malásia, recebeu a F1 de 1999 a 2017. Tem duas retas enormes ligadas por um grampo, e as chuvas tropicais da tarde já interromperam corridas, como a de 2009.",
  Silverstone:
    "Antigo aeródromo militar, recebeu a primeira corrida da história do Mundial de F1, em 13 de maio de 1950. A sequência rápida de Maggotts, Becketts e Chapel está entre os trechos mais desafiadores do mundo.",
  Sochi:
    "Construído em volta do Parque Olímpico dos Jogos de Inverno de 2014, recebeu o GP da Rússia de 2014 a 2021. Valtteri Bottas venceu ali sua primeira corrida, em 2017.",
  "Spa-Francorchamps":
    "Nas florestas das Ardenas, na Bélgica, é uma das pistas favoritas dos pilotos. Tem a subida da Eau Rouge e Raidillon e um clima tão instável que pode chover num trecho e não no outro. Michael Schumacher estreou ali em 1991 e venceu pela primeira vez em 1992.",
  Suzuka:
    "Criado em 1962 como pista de testes da Honda, é o único circuito em forma de oito do calendário, com uma ponte por cima da própria pista. Foi palco das brigas entre Senna e Prost em 1989 e 1990, que decidiram títulos.",
  "Watkins Glen":
    "No interior do estado de Nova York, recebeu o GP dos Estados Unidos de 1961 a 1980. Foi ali, em 1970, que Emerson Fittipaldi venceu sua primeira corrida na F1, com a Lotus.",
  Xangai:
    "Inaugurado em 2004, tem o traçado inspirado no ideograma chinês \"shang\" (上). A curva 1 é um caracol que vai fechando, e a reta oposta passa de 1 km.",
  "Yas Marina":
    "Em Abu Dhabi, estreou em 2009 com uma corrida que começa de dia e termina à noite. Passa por baixo de um hotel e muitas vezes encerra a temporada, como na decisão do título de 2021.",
  Zandvoort:
    "Entre as dunas do litoral holandês, recebeu a F1 de 1952 a 1985 e voltou em 2021 com curvas inclinadas, como a última, com 18 graus. As arquibancadas ficam tomadas pela torcida laranja de Max Verstappen.",
};
