import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const magic = Buffer.from("SCOPEFLOW-BACKUP-1\n");
function key(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded random 32-byte key");
  return bytes;
}
export function encryptBackup(plain: Buffer, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
}
export function decryptBackup(archive: Buffer, secret: string) {
  if (archive.length < magic.length + 28 || !archive.subarray(0, magic.length).equals(magic)) throw new Error("Unsupported backup archive");
  const offset = magic.length;
  const decipher = createDecipheriv("aes-256-gcm", key(secret), archive.subarray(offset, offset + 12));
  decipher.setAAD(magic);
  decipher.setAuthTag(archive.subarray(offset + 12, offset + 28));
  return Buffer.concat([decipher.update(archive.subarray(offset + 28)), decipher.final()]);
}
