import mongoose from "mongoose";
import { buildApp } from "./app.js";

const PORT = process.env.PORT ?? 3001;
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/mandato_agentico";

await mongoose.connect(MONGODB_URI);
buildApp().listen(PORT, () => {
  console.log(`Authority listening on :${PORT}  (mongo: ${MONGODB_URI})`);
});
