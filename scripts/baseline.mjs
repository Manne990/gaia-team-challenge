import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { openDatabase, resetDatabase, seedDatabase, defaultDatabasePath } from "../src/db/database.mjs";

const command = process.argv[2];
const productContract = new URL("../docs/product-contract.md", import.meta.url);

if (!readFileSync(productContract, "utf8").includes("Northstar CRM V1")) {
  throw new Error("The frozen product contract is missing");
}

if (command === "db-reset") {
  resetDatabase(defaultDatabasePath).close();
  console.log("database reset: PASS");
  process.exit(0);
}

if (command === "db-seed") {
  const db = openDatabase(defaultDatabasePath);
  seedDatabase(db);
  db.close();
  console.log("database seed: PASS");
  process.exit(0);
}

if (["ci", "build"].includes(command)) {
  console.log(`baseline ${command}: PASS (product implementation still required)`);
  process.exit(0);
}

if (command === "dev") {
  const hostIndex = process.argv.indexOf("--host");
  const portIndex = process.argv.indexOf("--port");
  const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : "127.0.0.1";
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : "4173");
  createServer((_request, response) => {
    response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
    response.end("Northstar CRM product implementation is not complete.\n");
  }).listen(port, host, () => console.log(`baseline listening on http://${host}:${port}`));
} else {
  throw new Error(`Unknown baseline command: ${command ?? "missing"}`);
}
