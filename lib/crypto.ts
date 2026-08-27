import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// Resolved lazily (inside encrypt/decrypt) rather than at module scope so that
// `docker build` -- which has no ENCRYPTION_KEY and never calls encrypt/decrypt,
// only the runtime container does -- keeps working.
function requireEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Set it explicitly before encrypting or ' +
      'decrypting (scripts/setup-env.js generates one for local dev).'
    );
  }
  return key;
}

/**
 * Encrypt a string using AES-256-CBC
 * @param text - Plain text to encrypt
 * @returns Encrypted text with IV (format: iv:encryptedText)
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(requireEncryptionKey().slice(0, 64), 'hex'),
    iv
  );

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a string encrypted with AES-256-CBC
 * @param text - Encrypted text (format: iv:encryptedText)
 * @returns Decrypted plain text
 */
export function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift()!, 'hex');
  const encryptedText = parts.join(':');

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(requireEncryptionKey().slice(0, 64), 'hex'),
    iv
  );

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
