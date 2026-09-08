import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node source tests.
import { cryptoStorageDiagnostic } from "./storage-diagnostics.ts";

test("database diagnostics expose only a bounded error code and category",()=>{
  assert.deepEqual(cryptoStorageDiagnostic({code:"42501",message:"private"}),{code:"42501",kind:"permission_denied"});
  assert.deepEqual(cryptoStorageDiagnostic({code:"PGRST202"}),{code:"PGRST202",kind:"schema_unavailable"});
  for(const error of [null,new Error("private"),{code:"https://secret.invalid?key=private"}]) {
    assert.deepEqual(cryptoStorageDiagnostic(error),{code:null,kind:"storage_unavailable"});
  }
  assert.deepEqual(cryptoStorageDiagnostic({name:"TimeoutError"}),{code:null,kind:"timeout"});
});
