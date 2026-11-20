# Sinapse com o dataset do professor (5:02, sem som, para narrar por cima)

Vídeo final: `sinapse-produtividade-codigo.mp4` (o app intercalado com o código). Os tempos estão em `sinapse-produtividade-codigo.cenas.json`.

Como refazer:
1. `node scripts/video-produtividade.mjs <dataset.csv> video/sinapse-produtividade.mp4` grava o app.
2. `node scripts/video-codigo.mjs <pasta>` grava as telas de código (video/codigo.html com o código real de src/core).
3. `node scripts/video-montar.mjs video/sinapse-produtividade.mp4 video/sinapse-produtividade.cenas.json <pasta> video/sinapse-produtividade-codigo.mp4` junta tudo.

Dataset: `dataset.csv`, 179 linhas. Entradas: sementes por m² e nitrogênio em kg/ha. Saída: produtividade em kg/ha.
Configuração: 2 → 4 Tanh → 1 Linear, taxa 0,05, até 1000 épocas, paciência 50, divisão 70/15/15 (semente 42), Min-Max.
As vozes **A** e **B** se alternam: A fala do app, B fala do código.

| Tempo | Cena | Voz | O que aparece | Fala sugerida |
|---|---|---|---|---|
| 0:00 | Abertura | A | Tela inicial com uma rede aprendendo ao vivo | "O Sinapse é uma rede neural MLP escrita do zero, em TypeScript, sem biblioteca de IA. Vamos usar o dataset de produtividade." |
| 0:07 | Dados | A | O CSV entra; colunas, divisão, normalização e a prévia | "O arquivo tem 179 linhas. Sementes e nitrogênio são as entradas, a produtividade é a saída. A divisão é 70% treino, 15% validação e 15% teste, com semente, e a normalização é Min-Max." |
| 0:30 | Código: divisão e normalização | B | `dataset.ts`, 4 destaques | "No código, os índices são embaralhados com a semente e cortados nos percentuais. Os três conjuntos nunca se misturam. A normalização é calculada só com o treino, nas entradas e também nas saídas numéricas, que vão para a faixa da ativação de saída." |
| 0:55 | Arquitetura | A | 2 entradas → 4 Tanh → 1 Linear, com a prévia | "A arquitetura não é fixa: aqui são 2 entradas, uma camada oculta com 4 neurônios Tanh e uma saída Linear, porque a produtividade é um número. Os pesos começam com Xavier." |
| 1:08 | Código: neurônio e ativações | B | `neuron.ts` e `activations.ts` | "O neurônio faz a soma ponderada, z igual à soma de w vezes x mais o viés, e aplica a ativação. O ajuste é w menos taxa vezes delta vezes x. Cada ativação traz a função e a derivada: na sigmoid, f vezes 1 menos f; na tanh, 1 menos f ao quadrado; na ReLU, 1 ou 0." |
| 1:42 | Um exemplo | A | Rede em 2D; um exemplo passa; a tabela do passo | "O botão Um exemplo mostra um passo do treino com os números de verdade: a ida, o erro, os deltas e os pesos que mais mudaram." |
| 2:09 | Código: retropropagação | B | `network.ts`, 5 destaques | "Para frente, a saída de cada camada vira a entrada da próxima. Na saída, delta é o menos t vezes a derivada. Nas ocultas, de trás para frente, delta é a derivada vezes a soma dos pesos vezes os deltas seguintes, ainda com os pesos antigos. Só depois de calcular todos os deltas os pesos mudam." |
| 2:39 | Treinando | A | Treino com paciência 50; para na época 409 e volta à 359; curva; mapa | "A linha cheia é o erro do treino e a tracejada, da validação. A validação ficou 50 épocas sem melhorar, então o treino parou na 409 e voltou aos pesos da 359. No mapa, mais claro é mais produtividade: ela cai com sementes demais e com nitrogênio alto." |
| 3:05 | Código: treino | B | `trainer.ts` e `loss.ts` | "Cada época embaralha os exemplos e treina um de cada vez, então o ajuste é por exemplo, não por lote. No fim da época mede o MSE do treino e da validação, guarda os melhores pesos e para se a validação não melhorar. O MSE é a média de o menos t ao quadrado, e só mede." |
| 3:34 | Resultados | A | Erro do teste nas duas escalas; a explicação | "O erro do teste aparece na escala normalizada e também na unidade do arquivo. A explicação resume a divisão, o treino e o ajuste dos pesos." |
| 3:56 | Prever | A | 250 sementes e 60 kg de N; depois linhas reais | "Com 250 sementes e 60 kg de nitrogênio, a rede prevê perto de 2.700 kg/ha. Com uma linha real do dataset, dá para comparar com o valor esperado." |
| 4:25 | Salvar | A | Botão Salvar: a rede vai para um JSON | "A rede treinada é salva num JSON." |
| 4:31 | Código: previsão e JSON | B | `predict.ts` e `persistence.ts` | "A previsão confere se vieram os valores certos, normaliza como no treino, faz só a propagação direta e desfaz a escala da saída. O JSON guarda a arquitetura, os pesos, os vieses e os parâmetros de normalização, para prever igual depois." |
| 4:56 | Fechamento | A | Tela final | "É isso: uma MLP configurável, treinada e testada com o dataset do trabalho." |
