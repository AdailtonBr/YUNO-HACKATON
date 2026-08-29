/** Sobe as tres lojas da demo (A, B e a nao-registrada) em portas separadas. */

import { buildStore } from "./store.js";
import { STORES } from "./catalogs.js";

const AUTHORITY_URL = process.env.AUTHORITY_URL ?? "http://127.0.0.1:3001";

for (const s of Object.values(STORES)) {
  buildStore({ ...s, authorityUrl: AUTHORITY_URL }).listen(s.port, () => {
    console.log(`${s.name} listening on :${s.port}`);
  });
}
