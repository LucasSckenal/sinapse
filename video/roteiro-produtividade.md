# Sinapse com o dataset do professor (sem som, para narrar por cima)

Dataset: `dataset.csv`, 179 linhas. Entradas: sementes por m² e nitrogênio em kg/ha. Saída: produtividade em kg/ha.
Configuração: 2 → 4 Tanh → 1 Linear, taxa 0,05, até 1000 épocas, paciência 50, divisão 70/15/15, Min-Max.
As vozes **A** e **B** se alternam a cada cena. Os tempos de cada cena estão em `sinapse-produtividade.cenas.json`.

| Cena | Voz | O que aparece | Fala sugerida |
|---|---|---|---|
| Abertura | A | Tela inicial com uma rede aprendendo ao vivo | "O Sinapse é uma rede neural MLP escrita do zero, sem biblioteca de IA. Vamos usar o dataset de produtividade." |
| Dados | B | O CSV entra; a prévia mostra como foi lido; entradas, saída, divisão e normalização | "O arquivo tem 179 linhas. Sementes e nitrogênio são as entradas, a produtividade é a saída. A divisão é 70% treino, 15% validação e 15% teste, com semente. A normalização Min-Max é calculada só com o treino, nas entradas e também na saída." |
| Arquitetura | A | 2 entradas → 4 neurônios Tanh → 1 saída Linear, com a prévia | "A arquitetura não é fixa: aqui são 2 entradas, uma camada oculta com 4 neurônios Tanh e uma saída Linear, porque a produtividade é um número. Os pesos começam com Xavier." |
| Um exemplo | B | Rede em 2D; um exemplo passa; as contas de um passo | "O treino é por exemplo, não por lote. Um exemplo vai para frente, o erro volta com os deltas, e só depois de calcular todos os deltas os pesos mudam: w recebe w menos taxa vezes delta vezes a entrada." |
| Treinando | A | 1000 épocas, paciência 50; curva do erro de treino e validação | "A cada época os exemplos são embaralhados. A linha cheia é o erro do treino e a tracejada, da validação. A validação só mede, não ajusta. Se ela ficar 50 épocas sem melhorar, o treino para e volta para os melhores pesos." |
| Resultados | B | Erro do teste, normalizado e em kg/ha²; a explicação de como foi feito | "O erro do teste fica na escala normalizada e também na unidade do arquivo. A explicação mostra a faixa da saída: de 1.700 a 3.160 kg/ha vira 0 a 1, e a previsão desfaz a conta." |
| Prever | A | 250 sementes e 60 kg de N; depois linhas reais do dataset | "Para prever, a rede confere se vieram dois valores, aplica a mesma normalização e faz só a propagação direta. Com 250 sementes e 60 kg de nitrogênio, ela prevê perto de 2.700 kg/ha. Com uma linha real, dá para comparar com o valor de verdade." |
| Salvar | B | Botão Salvar: a rede vai para um JSON | "A rede treinada vai inteira para um JSON: arquitetura, pesos, vieses e os parâmetros de normalização. Aberta de novo, dá as mesmas previsões." |
| Fechamento | A | Tela final | "É isso: uma MLP configurável, treinada e testada com o dataset do trabalho." |
