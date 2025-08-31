// src/crypto/signal-protocol.js
class SignalProtocol {
  constructor() {
    this.store = new SignalProtocolStore(); // IndexedDB
    this.sessions = new Map();
  }
  
  async initialize() {
    // Generate identity key pair
    this.identityKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey"]
    );
    
    // Generate signed pre key
    this.signedPreKey = await this.generateSignedPreKey();
    
    // Generate 100 one-time pre keys
    this.preKeys = [];
    for (let i = 0; i < 100; i++) {
      this.preKeys.push(await this.generatePreKey(i));
    }
    
    return this.getPublicKeys();
  }
  
  async encryptMessage(recipientId, plaintext) {
    // Get or create session
    let session = this.sessions.get(recipientId);
    
    if (!session) {
      // Fetch recipient's keys from Netlify
      const response = await fetch('/.netlify/functions/get-keys', {
        method: 'POST',
        body: JSON.stringify({ userId: recipientId })
      });
      const recipientKeys = await response.json();
      
      // Build new session using X3DH
      session = await this.buildSession(recipientId, recipientKeys);
      this.sessions.set(recipientId, session);
    }
    
    // Encrypt with Double Ratchet
    const messageKeys = await session.ratchet();
    const encrypted = await this.aesEncrypt(plaintext, messageKeys.messageKey);
    
    return {
      encryptedContent: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
      ephemeralKey: session.currentEphemeralPublic,
      messageNumber: session.messageNumber
    };
  }
  
  async aesEncrypt(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    
    // Prepend IV to ciphertext
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);
    
    return result;
  }
}
