import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptBackup, encryptBackup } from "@/lib/backup-crypto";

test("backups encrypt and authenticate the entire archive without embedding plaintext or the key", () => {
  const key = randomBytes(32).toString("base64"), data = Buffer.from("private customer database contents");
  const encrypted = encryptBackup(data, key);
  assert.equal(encrypted.includes(data), false);
  assert.equal(encrypted.includes(key), false);
  assert.deepEqual(decryptBackup(encrypted, key), data);
  assert.notDeepEqual(encryptBackup(data, key), encrypted);
});
test("altered backups, wrong keys, unsupported archives and invalid keys fail before restore", () => {
  const key = randomBytes(32).toString("base64");
  const encrypted = encryptBackup(Buffer.from("customer data"), key);
  const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptBackup(tampered, key));
  assert.throws(() => decryptBackup(encrypted, randomBytes(32).toString("base64")));
  assert.throws(() => decryptBackup(Buffer.from("not a backup"), key), /Unsupported/);
  assert.throws(() => encryptBackup(Buffer.from("data"), "weak-key"), /32-byte/);
});
