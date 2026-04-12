import crypto from 'crypto';
import logger from './logger.js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypts text using a master password
 * @param {string} text 
 * @param {string} masterPassword 
 * @returns {string} iv:encryptedText
 */
export function encrypt(text, masterPassword) {
  try {
    const key = crypto.scryptSync(masterPassword, 'salt', 32);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final().toString('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (err) {
    logger.error('Encryption failed:', err);
    throw err;
  }
}

/**
 * Decrypts text using a master password
 * @param {string} encryptedBundle 
 * @param {string} masterPassword 
 * @returns {string}
 */
export function decrypt(encryptedBundle, masterPassword) {
  try {
    const [ivHex, encryptedText] = encryptedBundle.split(':');
    const key = crypto.scryptSync(masterPassword, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final().toString('utf8');
    return decrypted;
  } catch (err) {
    logger.error('Decryption failed:', err);
    throw err;
  }
}
