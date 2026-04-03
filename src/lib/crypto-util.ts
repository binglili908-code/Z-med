import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getEncKey(): Buffer {
  const hex = process.env.API_KEY_ENCRYPTION_SECRET || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Missing or invalid API_KEY_ENCRYPTION_SECRET (expect 64-hex)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptText(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", getEncKey(), iv);
  let encrypted = cipher.update(plain, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decryptText(token: string): string {
  const [ivHex, dataHex] = token.split(":");
  if (!ivHex || !dataHex) throw new Error("Invalid encrypted payload");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", getEncKey(), iv);
  let decrypted = decipher.update(dataHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
