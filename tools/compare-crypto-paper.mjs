/** Offline only. Input must contain frozen choices joined to verified episode
 * exports, explicit costs/delay/liquidity, and a chronological evaluation window.
 * This tool never infers a missing model decision or makes a provider request. */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { compareFrozenCryptoModels } from "../lib/crypto/research-comparison.ts";

const file = process.argv[2];
if (!file || !isAbsolute(file)) throw new Error("Provide an absolute local comparison JSON path.");
if ((await stat(file)).size > 10_000_000) throw new Error("Comparison file exceeds the 10 MB offline bound.");
const input = JSON.parse(await readFile(file,"utf8"));
if (!Array.isArray(input.episodes) || !input.policy || !input.window) throw new Error("Expected episodes, policy and window.");
console.log(JSON.stringify(compareFrozenCryptoModels(input.episodes,input.policy,input.window),null,2));
