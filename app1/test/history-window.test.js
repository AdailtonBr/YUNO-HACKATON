/**
 * Testes da janela do histórico.
 *
 * Este arquivo existe por causa de um erro visto em uso:
 *
 *   openai_400: messages with role 'tool' must be a response to a
 *   preceeding message with 'tool_calls'   (param: messages.[1].role)
 *
 * A janela era `slice(-24)`, um corte por contagem.  Mas o pedido de uma tool e
 * a resposta dela formam um par, e o corte cego cai no meio: fica um `tool`
 * órfão no topo do histórico guardado.  Como é o histórico GUARDADO que
 * quebrou, toda mensagem seguinte reenvia o mesmo array inválido — a conversa
 * não se recupera sozinha.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { windowHistory } from "../src/agent/llm.js";

/** Um turno: usuário, assistente pedindo N tools, as N respostas, resposta final. */
const turn = (i, tools = 1) => [
  { role: "user", content: `pedido ${i}` },
  {
    role: "assistant",
    content: null,
    tool_calls: Array.from({ length: tools }, (_, k) => ({
      id: `call_${i}_${k}`,
      function: { name: "search_catalog", arguments: "{}" },
    })),
  },
  ...Array.from({ length: tools }, (_, k) => ({
    role: "tool",
    tool_call_id: `call_${i}_${k}`,
    content: "[]",
  })),
  { role: "assistant", content: `resposta ${i}` },
];

/** A invariante que a API exige: todo `tool` responde a um `tool_calls` anterior. */
function valid(messages) {
  const answered = new Set();
  for (const m of messages) {
    if (m.role === "tool") {
      if (!answered.has(m.tool_call_id)) return false;
    }
    for (const c of m.tool_calls ?? []) answered.add(c.id);
  }
  return true;
}

test("O BUG: o corte por contagem deixa um `tool` orfao no topo", () => {
  const history = [...turn(1, 3), ...turn(2, 3)]; // 12 mensagens
  const ingenuo = history.slice(-10); // cai no meio das respostas do turno 1
  assert.equal(ingenuo[0].role, "tool");
  assert.equal(valid(ingenuo), false); // e a API recusa o array inteiro
});

test("O CONSERTO: a janela recua ate uma fronteira valida", () => {
  const history = [...turn(1, 3), ...turn(2, 3)];
  const janela = windowHistory(history, 10);
  assert.notEqual(janela[0].role, "tool");
  assert.equal(valid(janela), true);
  assert.ok(janela.length < 10); // menor que o pedido -- e correta
});

test("historico ja quebrado se cura na leitura", () => {
  // Exatamente o que estava gravado quando o erro apareceu.
  const gravado = [{ role: "tool", tool_call_id: "call_x", content: "[]" }, { role: "assistant", content: "oi" }];
  const janela = windowHistory(gravado);
  assert.equal(valid(janela), true);
  assert.equal(janela.length, 1);
});

test("historico que ja cabe na janela passa intacto", () => {
  const history = turn(1, 2);
  assert.deepEqual(windowHistory(history, 24), history);
});

test("historico vazio, e historico so de tools, nao explodem", () => {
  assert.deepEqual(windowHistory([], 24), []);
  assert.deepEqual(windowHistory([{ role: "tool", tool_call_id: "a", content: "[]" }], 24), []);
});

test("o corte nunca separa um `tool_calls` das suas respostas", () => {
  // Varre TODOS os tamanhos de janela sobre um historico longo: nenhum deles
  // pode produzir um array que a API recuse.
  const history = [1, 2, 3, 4].flatMap((i) => turn(i, (i % 3) + 1));
  for (let size = 1; size <= history.length + 2; size++) {
    assert.equal(valid(windowHistory(history, size)), true, `janela de ${size} ficou invalida`);
  }
});
