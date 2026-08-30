import mongoose from "mongoose";
import dns from "node:dns";
import { buildApp } from "./app.js";
import { seed } from "./seed.js";

const PORT = process.env.PORT ?? 3001;

// Aceita os dois nomes: o do repo e o que aparece em projetos Node por aí.
const uriFromEnv = () => process.env.MONGODB_URI || process.env.MONGO_URL || null;

/**
 * `mongodb+srv://` resolve o cluster por registro SRV, e há redes domésticas
 * (e alguns provedores) cujo DNS não devolve esse tipo de registro — a conexão
 * falha com "querySrv ENOTFOUND" mesmo com a string correta.  Apontar o
 * resolver do processo para um DNS público contorna isso.
 *
 * Só mexemos no DNS quando a URI é `+srv`, e dá para desligar com
 * `MONGODB_DNS_SERVERS=""` em redes que exijam o resolver interno.
 */
function fixSrvDns(uri) {
  if (!uri?.startsWith("mongodb+srv://")) return;
  const servers = (process.env.MONGODB_DNS_SERVERS ?? "1.1.1.1,8.8.8.8")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) dns.setServers(servers);
}

/**
 * Sem `MONGODB_URI`, a Autoridade sobe com um Mongo em memória e já semeia a
 * allow-list e o agente da demo.  É conveniência de desenvolvimento — nada aqui
 * muda a arquitetura: o mandato continua sendo estado de servidor, escrito só
 * pela Autoridade.  Aponte `MONGODB_URI` para o Atlas quando quiser persistir.
 */
async function memoryDb() {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri("mandato_agentico"));
  return { ephemeral: true };
}

async function connect() {
  const uri = uriFromEnv();
  if (!uri) return memoryDb();

  fixSrvDns(uri);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    return { ephemeral: false };
  } catch (e) {
    // Cair em memória em vez de morrer: uma demo não pode acabar porque o IP
    // saiu do allowlist do Atlas.  O aviso é barulhento de propósito — dado que
    // some no restart é uma escolha, não algo para se descobrir depois.
    console.warn(`\n!!  Could not reach the configured MongoDB: ${e.message.split(".")[0]}.`);
    console.warn("!!  Falling back to an in-memory database — DATA WILL NOT PERSIST.");
    console.warn("!!  If this is Atlas, add your IP under Network Access.\n");
    return memoryDb();
  }
}

const { ephemeral } = await connect();
await seed();

buildApp().listen(PORT, () => {
  console.log(`Authority listening on :${PORT}`);
  // Nunca imprimimos a URI: ela carrega usuário e senha.
  console.log(`  mongo: ${ephemeral ? "in-memory (data is lost on restart)" : "connected"}`);
  console.log(`  seeded: store_a, store_b (allow-list) + agent_michael`);
});
