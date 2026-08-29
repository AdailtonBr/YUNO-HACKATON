import mongoose from "mongoose";
import { buildApp } from "./app.js";
import { seed } from "./seed.js";

const PORT = process.env.PORT ?? 3001;

/**
 * Sem `MONGODB_URI`, a Autoridade sobe com um Mongo em memória e já semeia a
 * allow-list e o agente da demo.  É conveniência de desenvolvimento — nada aqui
 * muda a arquitetura: o mandato continua sendo estado de servidor, escrito só
 * pela Autoridade.  Aponte `MONGODB_URI` para o Atlas quando quiser persistir.
 */
async function connect() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
    return { uri: process.env.MONGODB_URI, ephemeral: false };
  }
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri("mandato_agentico");
  await mongoose.connect(uri);
  return { uri, ephemeral: true };
}

const { uri, ephemeral } = await connect();
await seed();

buildApp().listen(PORT, () => {
  console.log(`Authority listening on :${PORT}`);
  console.log(`  mongo: ${uri}${ephemeral ? "  (in-memory — data is lost on restart)" : ""}`);
  console.log(`  seeded: store_a, store_b (allow-list) + agent_marina`);
});
