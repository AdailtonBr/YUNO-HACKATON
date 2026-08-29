# 08 — Caminho de Escala (modelo de id opaco)

> Este doc responde à pergunta que a banca faz depois de entender a abordagem B: *"e se forem um milhão de compras por minuto?"*. Ele **não muda nada do MVP** — descreve a curva de evolução e o que a torna possível.

O único custo estrutural de B é **uma chamada viva por compra**: a loja precisa perguntar à Autoridade "ainda vale?". Escalar B é, portanto, **absorver ou eliminar essa chamada sem perder a revogação viva** — a propriedade que nos fez escolher B em primeiro lugar (D2 em `docs/06-decision-log.md`).

Tudo abaixo decorre dessa única frase. Cada seção tira mais trabalho do caminho crítico; nenhuma abre mão de que "este mandato morreu" chegue até onde a verificação acontece.

---

## 1. Autoridade stateless + shard por id (o ganho grátis)

`/introspect` faz exatamente duas coisas no banco: um **point lookup** por `_id` e um `findOneAndUpdate` **atômico no mesmo documento**. Não há join, não há scan, não há transação entre documentos. E a Autoridade não guarda estado entre requisições — toda a verdade vive no banco.

Consequência imediata: **N réplicas atrás de um load balancer, sem coordenação entre elas**. Qualquer réplica responde qualquer requisição, e acrescentar réplica não exige acertar nada com as outras.

O gargalo migra para o banco — e o banco escala porque o `mandateId` é um **id opaco de alta entropia** (128 bits). Ids assim se distribuem uniformemente pelo espaço de hash, então, com shard key = `_id`:

- carga **uniforme** entre shards, sem hot shard;
- toda verificação toca **uma única shard** (lookup + update no mesmo documento);
- **zero** cross-shard, zero join, zero scan.

É carga embaraçosamente paralela: dobrar as shards dobra a vazão, sem reescrever nada.

> **Nota que vale citar na defesa:** a chave de particionamento ideal veio **de graça, de uma decisão de segurança**. O id precisava ser imprevisível para impedir enumeração (`docs/05-security-and-ugly-cases.md`); imprevisível é exatamente a propriedade que faz um bom shard key. Não houve trade-off entre segurança e escala aqui — a mesma escolha pagou as duas contas.

---

## 2. Separar o imutável do mutável

Um mandato mistura duas naturezas no mesmo documento:

| Parte | Campos | Muda depois de criado? |
|---|---|---|
| **Imutável** | `constraints`, `humanId`, `agentId`, `mode`, `paymentMethodRef`, `maxUses`, `expiresAt` | **Não.** Mandato não é editado — alargar limite significa criar outro mandato, pela mão do humano na Trusted Surface (D4). |
| **Mutável** | `revoked`, `usedCount` | Sim. |

Isso importa porque a parte **cara** da verificação — casar a lista de constraints contra os atributos, conferir o dono, conferir o teto — usa **só a parte imutável**. E dado imutável é **cacheável para sempre, sem risco de stale**: não existe versão mais nova para ficar defasado em relação a ela.

Num verificador com cache quente, o trabalho vivo se reduz a duas perguntas: *este mandato foi revogado?* e *ainda tem uso disponível?*. Até `expiresAt` sai do caminho vivo — é dado imutável comparado com o relógio local.

Reduzimos "verificar um mandato" a "saber se um id morreu". A seção 3 ataca exatamente esse resíduo.

---

## 3. Inverter a revogação (deny-list propagada)

Compras são muitas; revogações são poucas. Perguntar "ainda vale?" a cada compra é **consultar o estado de milhões de mandatos vivos para descobrir algo sobre um punhado de mandatos mortos** — a pergunta está do lado errado.

Inverta. Mantenha um **conjunto de revogados** — pequeno, justamente porque revogação é rara — replicado para perto de cada verificador. A compra passa a fazer um **teste de pertencimento barato, em memória**:

- **fast path:** um *bloom filter* da deny-list. Se responde "não está", o mandato está definitivamente vivo → aprova **sem chamada de rede** (bloom não tem falso negativo).
- **slow path:** se responde "talvez", confirma contra a lista exata — o custo é pago só nesse caso raro (falso positivo ou revogação real).

E a revogação vira **push, não poll**: quando o humano revoga, a Autoridade publica o id num canal (pub/sub) que **empurra** para a deny-list de todos os verificadores. Ninguém fica perguntando.

Análogos reais, para citar: **CRL** e **OCSP stapling** no TLS, e listas de refresh token revogado em OAuth. É o padrão da indústria para exatamente este problema.

> **Trade-off honesto (nomeie antes que perguntem):** a revogação deixa de ser instantânea e passa a ter **latência de propagação** — sub-segundo a poucos segundos, conforme o fan-out. No hackathon é irrelevante (uma Autoridade, leitura direta, revogação instantânea). Em escala global, é o preço.

---

## 4. TTL como política de risco **por mandato**

Cachear o **resultado** da introspecção por um TTL curto (1–5 s) absorve rajadas do mesmo mandato: um agente que dispara dez tentativas em sequência gera uma verificação, não dez.

Isso reintroduz staleness **de propósito** — e a diferença em relação ao modelo A é decisiva. No JWT, a janela de defasagem é **imposta pela cripto**: o token vale até expirar e não há como encurtá-la sem reemitir. Aqui ela é **um parâmetro tunável, e tunável por mandato**.

Isso encaixa no padrão que já atravessa o sistema: `on_missing`/`on_fail` deixam o mandato decidir a rigidez diante de ausência e de falha (D7); `mode` deixa o mandato decidir se exige aprovação por compra (D11). O TTL é a mesma ideia aplicada à frescura — **o mandato decide quanta defasagem tolera**.

| Perfil do mandato | TTL | Por quê |
|---|---|---|
| Baixo valor, `autonomo`, recorrente | 1–5 s | O prejuízo possível numa janela de segundos é menor que o custo de verificar tudo ao vivo. |
| Alto valor, ou `mode: "aprovacao"` | 0 (sempre ao vivo) | Aqui a revogação precisa valer **agora**; a chamada extra é barata perto do risco. |

A frescura da revogação vira, assim, **uma dimensão do risco** — definida por quem cria o mandato, no mesmo lugar em que define teto e validade.

---

## 5. Convergência com A/AP2 no limite

Empurre as seções 2, 3 e 4 ao extremo e veja onde se chega:

- a parte imutável é cacheável para sempre → por que não **assiná-la** e deixar a loja verificar limites e dono **offline**, sem tocar no banco?
- o resíduo vivo é só a revogação → mantida como deny-list propagada + TTL.

O resultado é **um token assinado com a parte imutável + uma lista de revogação**. Ou seja: **a versão maximamente escalável de B *é* o híbrido A+B.**

E isso não é acidente. A já paga o custo de assinar para verificar offline, e precisa colar um mecanismo de status vivo por cima — que é exatamente o problema secundário do AP2 (D2). B começa com o estado vivo e vai empurrando o imutável para a borda. **Os dois chegam ao mesmo lugar, por lados opostos.**

> **Frase para a defesa:** *"escolhemos B pela revogação viva trivial no MVP; o caminho de escala é assinar o imutável e introspectar só a revogação — que é onde B e o AP2 se encontram."*

Corolário estratégico: escolher B agora **não fecha porta nenhuma**. A migração para o híbrido é aditiva, não uma reescrita.

---

## Trade-off irredutível

Não existe, ao mesmo tempo, **revogação instantânea-global** e **verificação totalmente local com zero coordenação**. A razão é simples e não depende de implementação: para uma verificação recusar um mandato revogado, o fato *"este mandato morreu"* precisa ter **chegado** até onde a verificação acontece. Isso é comunicação, e comunicação tem latência.

Toda a engenharia de escala aqui é escolher um ponto nesta curva:

```
frescura da revogação  <──────────────────────────>  localidade da verificação
(sempre ao vivo,                                     (offline, cacheada,
 uma chamada por compra,                              sem chamada de rede,
 revogação instantânea)                               propagação em segundos)
        ^                                                      ^
   nosso MVP                                        limite de escala (secao 5)
```

O insight do sistema — e o que o torna defensável — é que **esse ponto não precisa ser único**. Como a rigidez (`on_missing`/`on_fail`) e o modo (`autonomo`/`aprovacao`), ele pode ser escolhido **por mandato**, conforme o valor em risco. Um mandato de R$50 recorrente e um de R$50.000 não têm por que comprar a mesma garantia.

---

> **Escopo:** nada nesta página está implementado no MVP, nem deve estar. O MVP roda a versão sem cache, sem deny-list e sem TTL — uma Autoridade, leitura direta, revogação instantânea (`docs/07-build-plan.md`). Este doc existe para responder "e em escala?" com um caminho concreto, não para inflar o build.
