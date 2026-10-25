import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'

// File layout: MAGIC(4) | salt(16) | iv(12) | tag(16) | ciphertext
const MAGIC = Buffer.from('LSB1')
const ITERATIONS = 210_000

function key(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, ITERATIONS, 32, 'sha256')
}

export function encryptBackup(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(passphrase, salt), iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body])
}

export function decryptBackup(file: Buffer, passphrase: string): Buffer {
  if (file.length < 48 || !file.subarray(0, 4).equals(MAGIC)) throw new Error('Not a Life System backup')
  const salt = file.subarray(4, 20)
  const iv = file.subarray(20, 32)
  const tag = file.subarray(32, 48)
  const decipher = createDecipheriv('aes-256-gcm', key(passphrase, salt), iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(file.subarray(48)), decipher.final()])
  } catch {
    throw new Error('Wrong passphrase or damaged backup')
  }
}
