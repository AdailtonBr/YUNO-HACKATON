/**
 * Painel do operador da loja — HTML puro, sem build e sem framework.
 *
 * É tela **da loja**, não da Trusted Surface: o merchant mexendo no próprio
 * catálogo.  A aparência é deliberadamente diferente da UI do humano, porque o
 * dono é outro — confundir as duas seria confundir quem manda em quê.
 *
 * Duas alavancas só, preço e estoque, e é o suficiente para ver o agente mudar
 * de ideia: baixe um preço e o mais barato que cabe muda de loja; mexa no preço
 * entre a busca e a compra e o bilhete assinado deixa de casar.
 */

const CSS = `
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { margin:0; background:#f4f4f2; color:#1c1917;
         font:14px/1.5 ui-monospace,"SF Mono",Menlo,monospace }
  header { background:#1c1917; color:#fff; padding:14px 20px;
           display:flex; align-items:baseline; gap:14px; flex-wrap:wrap }
  header b { font-size:15px; letter-spacing:.14em; text-transform:uppercase }
  header span { color:#a8a29e; font-size:12px }
  main { padding:20px; max-width:960px }
  p.lead { color:#57534e; font-size:12.5px; margin:0 0 16px; max-width:66ch }
  table { width:100%; border-collapse:collapse; background:#fff;
          border:1px solid #e7e5e4; border-radius:6px; overflow:hidden }
  th { text-align:left; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
       color:#78716c; font-weight:500; padding:9px 12px; background:#fafaf9;
       border-bottom:1px solid #e7e5e4 }
  td { padding:8px 12px; border-bottom:1px solid #f5f5f4; vertical-align:middle }
  tr:last-child td { border-bottom:0 }
  tr.out { opacity:.45 }
  .name { font-family:ui-sans-serif,system-ui,sans-serif; font-weight:600 }
  .muted { color:#a8a29e; font-size:11.5px }
  input { width:104px; padding:5px 8px; font:13px ui-monospace,monospace;
          border:1px solid #d6d3d1; border-radius:4px; text-align:right }
  input:focus { outline:none; border-color:#1c1917; box-shadow:0 0 0 3px #1c191712 }
  button { padding:5px 10px; border:1px solid #d6d3d1; background:#fff;
           border-radius:4px; cursor:pointer;
           font:600 12px ui-sans-serif,system-ui,sans-serif }
  button:hover { background:#fafaf9 }
  button.on { border-color:#a7f3d0; background:#ecfdf5; color:#065f46 }
  button.off { border-color:#fecaca; background:#fef2f2; color:#991b1b }
  .saved { color:#047857; font-size:11px; margin-left:8px }
`;

const SCRIPT = String.raw`
async function patch(pid, body, el) {
  const r = await fetch('/catalog/' + encodeURIComponent(pid), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.ok && el) { el.textContent = 'saved'; setTimeout(() => (el.textContent = ''), 1200); }
  return r.ok;
}

function rowHtml(i) {
  const attrs = [i.category, i.size && ('size ' + i.size), i.ship_country, i.color, i.brand]
    .filter(Boolean).join(' · ');
  return '<tr class="' + (i.available ? '' : 'out') + '">' +
    '<td><span class="name">' + i.name + '</span><br><span class="muted">' + i.productId + '</span></td>' +
    '<td class="muted">' + attrs + '</td>' +
    '<td style="text-align:right"><input type="number" step="0.01" value="' +
      (i.price / 100).toFixed(2) + '" data-id="' + i.productId + '">' +
      '<span class="saved" data-saved="' + i.productId + '"></span></td>' +
    '<td><button class="' + (i.available ? 'on' : 'off') + '" data-stock="' + i.productId +
      '" data-next="' + (!i.available) + '">' +
      (i.available ? 'in stock' : 'out of stock') + '</button></td>' +
  '</tr>';
}

async function load() {
  const data = await (await fetch('/products')).json();
  document.getElementById('rows').innerHTML = data.items.map(rowHtml).join('');

  document.querySelectorAll('input[data-id]').forEach((el) => {
    const commit = async () => {
      const cents = Math.round(parseFloat(el.value) * 100);
      if (Number.isFinite(cents)) {
        await patch(el.dataset.id, { price: cents },
          document.querySelector('[data-saved="' + el.dataset.id + '"]'));
      }
    };
    el.addEventListener('change', commit);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  });

  document.querySelectorAll('button[data-stock]').forEach((el) => {
    el.addEventListener('click', async () => {
      await patch(el.dataset.stock, { available: el.dataset.next === 'true' });
      load();
    });
  });
}

load();
`;

export function panelHtml(id, name) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${name} — operator</title>
  <style>${CSS}</style>
</head>
<body>
  <header><b>${name}</b><span>${id} · operator panel</span></header>
  <main>
    <p class="lead">
      Change a price and the agent changes its mind: the cheapest option that fits may move to
      the other store, and a price that moves between the search and the purchase makes the
      agent's signed ticket stop matching. Changes live in memory — restarting restores them.
    </p>
    <table>
      <thead>
        <tr>
          <th>Product</th><th>Attributes</th>
          <th style="text-align:right">Price (BRL)</th><th>Stock</th>
        </tr>
      </thead>
      <tbody id="rows"><tr><td colspan="4" class="muted">loading…</td></tr></tbody>
    </table>
  </main>
  <script>${SCRIPT}</script>
</body>
</html>`;
}
