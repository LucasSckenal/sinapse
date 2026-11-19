# Sinapse com o dataset do professor (2:40, sem som, para narrar por cima)

Vídeo: `sinapse-produtividade.mp4`. Gravado com `node scripts/video-produtividade.mjs <dataset.csv> <saida.mp4>`.
Dataset: `dataset.csv`, 179 linhas. Entradas: sementes por m² e nitrogênio em kg/ha. Saída: produtividade em kg/ha.
Configuração: 2 → 4 Tanh → 1 Linear, taxa 0,05, até 1000 épocas, paciência 50, divisão 70/15/15 (semente 42), Min-Max.
As vozes **A** e **B** se alternam a cada cena.

| Tempo | Cena | Voz | O que aparece | Fala sugerida |
|---|---|---|---|---|
| 0:00 | Abertura | A | Tela inicial com uma rede aprendendo ao vivo | "O Sinapse é uma rede neural MLP escrita do zero, sem biblioteca de IA. Vamos usar o dataset de produtividade." |
| 0:07 | Dados | B | O CSV entra; colunas, divisão, normalização e a prévia de como o arquivo foi lido | "O arquivo tem 179 linhas. Sementes e nitrogênio são as entradas, a produtividade é a saída. A divisão é 70% treino, 15% validação e 15% teste, com semente. A normalização Min-Max é calculada só com o treino, nas entradas e também na saída." |
| 0:30 | Arquitetura | A | 2 entradas → 4 neurônios Tanh → 1 saída Linear, com a prévia | "A arquitetura não é fixa: aqui são 2 entradas, uma camada oculta com 4 neurônios Tanh e uma saída Linear, porque a produtividade é um número. Os pesos começam com Xavier." |
| 0:43 | Um exemplo | B | Rede em 2D; um exemplo passa; a tabela do passo a passo | "O treino é por exemplo, não por lote. Um exemplo vai para frente, o erro volta com os deltas, e só depois de calcular todos os deltas os pesos mudam: w recebe w menos taxa vezes delta vezes a entrada." |
| 1:11 | Treinando | A | Treino com paciência 50; para na época 409 e volta à 359; curva do erro; mapa da rede | "A cada época os exemplos são embaralhados. A linha cheia é o erro do treino e a tracejada, da validação, que só mede. Ela ficou 50 épocas sem melhorar, então o treino parou na 409 e voltou aos pesos da 359. No mapa, quanto mais claro, maior a produtividade prevista: ela cai com sementes demais e com nitrogênio alto." |
| 1:37 | Resultados | B | Erro de treino, validação e teste, também na unidade do arquivo; a explicação | "O erro do teste fica na escala normalizada e também na unidade do arquivo. A explicação mostra a divisão, o treino e o ajuste dos pesos, e a faixa da saída: de 1.700 a 3.160 kg/ha vira 0 a 1, e a previsão desfaz a conta." |
| 1:59 | Prever | A | 250 sementes e 60 kg de N; depois linhas reais do dataset | "Para prever, a rede confere se vieram dois valores, aplica a mesma normalização e faz só a propagação direta. Com 250 sementes e 60 kg de nitrogênio, ela prevê perto de 2.700 kg/ha. Com uma linha real, dá para comparar com o valor esperado." |
| 2:28 | Salvar | B | Botão Salvar: a rede vai para um JSON | "A rede treinada vai inteira para um JSON: arquitetura, pesos, vieses e os parâmetros de normalização. Aberta de novo, dá as mesmas previsões." |
| 2:34 | Fechamento | A | Tela final | "É isso: uma MLP configurável, treinada e testada com o dataset do trabalho." |
