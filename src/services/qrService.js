// Servicio de generación y gestión de tokens seguros y códigos QR
const crypto = require('crypto');
const qrcode = require('qrcode');
const env = require('../config/env');

/**
 * Genera un token criptográficamente seguro de 32 bytes (64 caracteres hexadecimales).
 */
function generarTokenSeguro() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Construye la URL canónica de acceso para una mesa con su token secreto.
 */
function construirUrlMesa(numero, tokenSecreto) {
  return `${env.BASE_URL}/mesa/${numero}?token=${tokenSecreto}`;
}

/**
 * Genera un código QR en formato DataURL (base64) para una URL dada.
 */
async function generarQrDataUrl(url) {
  return await qrcode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 300
  });
}

module.exports = {
  generarTokenSeguro,
  construirUrlMesa,
  generarQrDataUrl
};
