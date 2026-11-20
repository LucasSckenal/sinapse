# Sinapse com o dataset do professor (5:47, sem som, para narrar por cima)

Vídeo final: `sinapse-produtividade-codigo.mp4` (o app intercalado com o código). Os tempos estão em `sinapse-produtividade-codigo.cenas.json`.

Como refazer:
1. `node scripts/video-produtividade.mjs <dataset.csv> video/sinapse-produtividade.mp4` grava o app.
2. `node scripts/video-codigo.mjs <pasta>` grava as telas de código (video/codigo.html com o código real de src/core e os testes rodando na hora).
3. `node scripts/video-montar.mjs video/sinapse-produtividade.mp4 video/sinapse-produtividade.cenas.json <pasta> video/sinapse-produtividade-codigo.mp4` junta tudo.

Dataset: `dataset.csv`, 179 linhas. Entradas: sementes por m² e nitrogênio em kg/ha. Saída: produtividade em kg/ha.
Configuração: 2 → 4 Tanh → 1 Linear, taxa 0,05, até 1000 épocas, paciência 50, divisão 70/15/15 (semente 42), Min-Max.

## Como narrar

- **Não leiam.** Cada cena tem tópicos: o que dizer e o **porquê**. Expliquem com as palavras de vocês, como explicariam a um colega.
- O **porquê** é o que mostra domínio do código. Não pulem.
- A voz **A** fala do app; a **B** fala do código. Podem dividir entre mais pessoas, uma por cena.
- Gravem cada cena num áudio separado (cena01.m4a, cena02.m4a…). Eu encaixo cada um na sua cena, corto silêncios e coloco legenda.

## Cenas

| Tempo | Cena | Voz | O que aparece | O que dizer | Por quê (não pulem) |
|---|---|---|---|---|---|
| 0:00 | Abertura | A | Tela inicial, uma rede aprendendo ao vivo | MLP escrita do zero, em TypeScript, sem biblioteca de IA · dataset de produtividade | Sem biblioteca: cada conta da rede é código nosso, e vamos mostrar |
| 0:07 | Dados | A | O CSV entra; colunas, divisão, normalização, prévia | 179 linhas · entradas: sementes e nitrogênio · saída: produtividade · 70/15/15 com semente · Min-Max | Validação escolhe quando parar; teste fica guardado para medir no fim. Semente: o resultado se repete |
| 0:30 | Código: divisão e normalização | B | `dataset.ts`, 4 destaques | Embaralha com a semente e corta nos percentuais · conjuntos não se misturam · normalização só com o treino · saídas numéricas também | Calcular a normalização com o teste seria "espiar a prova". Sem escala, uma coluna de 300 apagaria uma de 60 |
| 0:55 | Arquitetura | A | 2 → 4 Tanh → 1 Linear, com a prévia | Arquitetura configurável · 4 neurônios Tanh · saída Linear · pesos iniciais Xavier | Linear porque produtividade não tem teto. Xavier para o sinal não sumir nem explodir entre camadas |
| 1:08 | Código: neurônio e ativações | B | `neuron.ts` e `activations.ts` | z = Σ w·x + b · saída = f(z) · ajuste w ← w − η·δ·x · cada ativação tem função e derivada | A derivada diz quanto a saída muda quando z muda; é ela que a retropropagação usa |
| 1:42 | Um exemplo | A | Rede em 2D; um exemplo passa; tabela do passo | Um passo do treino com números reais: ida, erro, deltas, pesos que mais mudaram | Mostra que o treino não é mágica: é essa conta repetida milhares de vezes |
| 2:10 | Código: retropropagação | B | `network.ts`, 5 destaques | Ida camada por camada · delta da saída (o − t)·f′ · ocultas de trás para frente · só depois os pesos mudam | Se um peso mudasse antes, o delta da camada anterior usaria um peso que não gerou a saída: gradiente errado |
| 2:40 | Treinando | A | Para na época 409, volta à 359; curva; mapa | Linha cheia = treino, tracejada = validação · 50 épocas sem melhorar → para · mapa: mais claro = mais produtividade | Mostra que a rede aprendeu um padrão real: cai com sementes demais e nitrogênio alto |
| 3:06 | Código: treino | B | `trainer.ts` e `loss.ts` | Embaralha a cada época · um exemplo por vez (SGD) · mede MSE de treino e validação · guarda os melhores pesos | Embaralhar evita aprender a ordem. Parada antecipada: quando a validação piora, a rede começou a decorar |
| 3:40 | Resultados | A | Erro do teste nas duas escalas; explicação | MSE do teste normalizado e em kg/ha · a explicação resume o treino | O dado tem ruído: mesmo acertando a média exata de cada ponto, o MSE seria ~20.700. O teste deu ~14.500: a rede chegou no limite do que o dado permite |
| 4:02 | Código: testes | B | Teste do gradiente; os 35 testes passando | Retropropagação comparada com a derivada numérica · batem até a 5ª casa · 35 testes passam | É a prova de que a matemática está certa, em todas as ativações, e não só "parece funcionar" |
| 4:41 | Prever | A | 250 sementes e 60 kg de N; linhas reais | Prevê ~2.700 kg/ha · com uma linha real dá para comparar | A média real nesse ponto é ~2.780: o erro é pequeno perto do ruído |
| 5:10 | Salvar | A | Botão Salvar → JSON | A rede treinada vai para um JSON | Treinar de novo daria outra rede; salvar garante a mesma previsão depois |
| 5:15 | Código: previsão e JSON | B | `predict.ts` e `persistence.ts` | Confere a quantidade de valores · normaliza como no treino · só a ida · desfaz a escala · JSON com arquitetura, pesos, vieses e normalização | Sem os parâmetros de normalização no JSON, a rede receberia números numa escala que nunca viu |
| 5:41 | Fechamento | A | Tela final | MLP configurável, treinada e testada com o dataset do trabalho | — |

Total: 5:47.
