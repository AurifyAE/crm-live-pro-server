import crypto from "crypto";
import "dotenv/config";

// Define your encryption settings
const algorithm = "aes-256-cbc";
const secretKey = Buffer.from(process.env.ENCRYPTION_KEY, "base64");

// Function to encrypt the password
export const encryptPassword = (password) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(password), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    encryptedData: encrypted.toString("hex"),
  };
};

// Function to decrypt the password
export const decryptPassword = (encryptedPassword, ivHex) => {
  try {
    const iv = Buffer.from(ivHex, "hex");
    const encryptedText = Buffer.from(encryptedPassword, "hex");
    const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
    const decrypted = Buffer.concat([
      decipher.update(encryptedText),
      decipher.final(),
    ]);
    return decrypted.toString();
  } catch (error) {
    console.error("Decryption error:", error);
    throw error; // Re-throw the error for proper handling in the calling function
  }
};
