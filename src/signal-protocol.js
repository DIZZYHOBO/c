// Complete Signal Protocol Implementation
class SignalProtocolStore {
  constructor() {
    this.store = {};
  }
  
  async get(key) {
    return this.store[key];
  }
  
  async put(key, value) {
    this.store[key] = value;
  }
  
  async remove(key) {
    delete this.store[key];
  }
}

class SignalProtocol {
  constructor() {
    this.store = new SignalProtocolStore();
    this.sessions = new Map();
    this.identityKeyPair = null;
    this.signedPreKey = null;
    this.preKeys = [];
  }
  
  async initialize() {
    // Generate identity key pair (long-term)
    this.identityKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
    
    // Generate signed pre key (medium-term, rotated weekly)
    this.signedPreKey = await this.generateSignedPreKey();
    
    // Generate 100 one-time pre keys
    this.preKeys = [];
    for (let i = 0; i < 100; i++) {
      this.preKeys.push(await this.generatePreKey(i));
    }
    
    // Store identity in IndexedDB
    await this.storeIdentity();
    
    return this.getPublicKeys();
  }
  
  async generateSignedPreKey() {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
    
    const publicKeyData = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const signature = await this.signKey(publicKeyData);
    
    return {
      keyId: 1,
      keyPair,
      signature,
      timestamp: Date.now()
    };
  }
  
  async generatePreKey(keyId) {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
    
    return {
      keyId,
      keyPair
    };
  }
  
  async signKey(data) {
    // In real Signal, this uses Ed25519. We'll use ECDSA for browser compatibility
    const key = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key.privateKey,
      data
    );
    
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }
  
  async getPublicKeys() {
    const identityKey = await crypto.subtle.exportKey("jwk", this.identityKeyPair.publicKey);
    const signedPreKey = {
      keyId: this.signedPreKey.keyId,
      publicKey: await crypto.subtle.exportKey("jwk", this.signedPreKey.keyPair.publicKey),
      signature: this.signedPreKey.signature
    };
    
    const preKeys = [];
    for (const preKey of this.preKeys) {
      preKeys.push({
        keyId: preKey.keyId,
        publicKey: await crypto.subtle.exportKey("jwk", preKey.keyPair.publicKey)
      });
    }
    
    return {
      identityKey,
      signedPreKey,
      preKeys
    };
  }
  
  async buildSession(recipientId, recipientKeys) {
    // X3DH Key Agreement
    const session = new Session();
    
    // Import recipient's identity key
    const theirIdentityKey = await crypto.subtle.importKey(
      "jwk",
      recipientKeys.identityKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    
    // Import their signed pre key
    const theirSignedPreKey = await crypto.subtle.importKey(
      "jwk",
      recipientKeys.signedPreKey.publicKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    
    // Import their one-time pre key (if available)
    let theirPreKey = null;
    if (recipientKeys.preKey) {
      theirPreKey = await crypto.subtle.importKey(
        "jwk",
        recipientKeys.preKey.publicKey,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
      );
    }
    
    // Generate ephemeral key pair
    const ephemeralKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
    
    // Perform X3DH
    const dh1 = await crypto.subtle.deriveBits(
      { name: "ECDH", public: theirSignedPreKey },
      this.identityKeyPair.privateKey,
      256
    );
    
    const dh2 = await crypto.subtle.deriveBits(
      { name: "ECDH", public: theirIdentityKey },
      ephemeralKeyPair.privateKey,
      256
    );
    
    const dh3 = await crypto.subtle.deriveBits(
      { name: "ECDH", public: theirSignedPreKey },
      ephemeralKeyPair.privateKey,
      256
    );
    
    let dh4 = new Uint8Array(32);
    if (theirPreKey) {
      const bits = await crypto.subtle.deriveBits(
        { name: "ECDH", public: theirPreKey },
        ephemeralKeyPair.privateKey,
        256
      );
      dh4 = new Uint8Array(bits);
    }
    
    // Combine DH outputs
    const sharedSecret = new Uint8Array(32 * 4);
    sharedSecret.set(new Uint8Array(dh1), 0);
    sharedSecret.set(new Uint8Array(dh2), 32);
    sharedSecret.set(new Uint8Array(dh3), 64);
    sharedSecret.set(dh4, 96);
    
    // Derive root key and chain keys
    session.rootKey = await this.kdf(sharedSecret, "Signal_Root_Key");
    session.chainKey = await this.kdf(sharedSecret, "Signal_Chain_Key");
    session.ephemeralKeyPair = ephemeralKeyPair;
    session.theirIdentityKey = theirIdentityKey;
    
    return session;
  }
  
  async kdf(input, info) {
    const key = await crypto.subtle.importKey(
      "raw",
      input,
      { name: "HKDF" },
      false,
      ["deriveKey", "deriveBits"]
    );
    
    return await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(32),
        info: new TextEncoder().encode(info)
      },
      key,
      256
    );
  }
  
  async encryptMessage(recipientId, plaintext) {
    let session = this.sessions.get(recipientId);
    
    if (!session) {
      // Fetch recipient's keys
      const response = await fetch('/.netlify/functions/get-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: recipientId })
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch recipient keys');
      }
      
      const recipientKeys = await response.json();
      session = await this.buildSession(recipientId, recipientKeys);
      this.sessions.set(recipientId, session);
    }
    
    // Ratchet forward
    const messageKeys = await session.ratchet();
    
    // Encrypt message
    const encrypted = await this.aesEncrypt(plaintext, messageKeys.encryptionKey);
    
    // MAC
    const mac = await this.computeMAC(encrypted, messageKeys.macKey);
    
    return {
      encryptedContent: btoa(String.fromCharCode(...encrypted)),
      mac: btoa(String.fromCharCode(...mac)),
      ephemeralKey: await crypto.subtle.exportKey("jwk", session.ephemeralKeyPair.publicKey),
      messageNumber: session.messageNumber
    };
  }
  
  async decryptMessage(senderId, encryptedContent, ephemeralKey, mac) {
    let session = this.sessions.get(senderId);
    
    if (!session) {
      throw new Error('No session established');
    }
    
    // Import ephemeral key
    const theirEphemeralKey = await crypto.subtle.importKey(
      "jwk",
      ephemeralKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    
    // Ratchet to match
    await session.ratchetToMatch(theirEphemeralKey);
    
    // Get message keys
    const messageKeys = await session.getMessageKeys();
    
    // Verify MAC
    const encryptedBytes = Uint8Array.from(atob(encryptedContent), c => c.charCodeAt(0));
    const macBytes = Uint8Array.from(atob(mac), c => c.charCodeAt(0));
    const computedMac = await this.computeMAC(encryptedBytes, messageKeys.macKey);
    
    if (!this.constantTimeCompare(macBytes, computedMac)) {
      throw new Error('MAC verification failed');
    }
    
    // Decrypt
    const decrypted = await this.aesDecrypt(encryptedBytes, messageKeys.encryptionKey);
    return new TextDecoder().decode(decrypted);
  }
  
  async aesEncrypt(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );
    
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      encoded
    );
    
    // Prepend IV to ciphertext
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);
    
    return result;
  }
  
  async aesDecrypt(ciphertext, key) {
    // Extract IV
    const iv = ciphertext.slice(0, 12);
    const encrypted = ciphertext.slice(12);
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      encrypted
    );
    
    return new Uint8Array(decrypted);
  }
  
  async computeMAC(data, key) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const signature = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      data
    );
    
    return new Uint8Array(signature);
  }
  
  constantTimeCompare(a, b) {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }
  
  async storeIdentity() {
    // Store in IndexedDB
    const db = await this.openDB();
    const tx = db.transaction(['identity'], 'readwrite');
    const store = tx.objectStore('identity');
    
    await store.put({
      id: 'self',
      identityKeyPair: await this.exportKeyPair(this.identityKeyPair),
      signedPreKey: {
        keyId: this.signedPreKey.keyId,
        keyPair: await this.exportKeyPair(this.signedPreKey.keyPair),
        signature: this.signedPreKey.signature,
        timestamp: this.signedPreKey.timestamp
      },
      preKeys: await Promise.all(this.preKeys.map(async pk => ({
        keyId: pk.keyId,
        keyPair: await this.exportKeyPair(pk.keyPair)
      })))
    });
  }
  
  async exportKeyPair(keyPair) {
    return {
      publicKey: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
      privateKey: await crypto.subtle.exportKey("jwk", keyPair.privateKey)
    };
  }
  
  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SignalProtocol', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('identity')) {
          db.createObjectStore('identity', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
      };
    });
  }
}

class Session {
  constructor() {
    this.rootKey = null;
    this.chainKey = null;
    this.ephemeralKeyPair = null;
    this.theirIdentityKey = null;
    this.messageNumber = 0;
    this.receivedMessages = new Map();
  }
  
  async ratchet() {
    // Symmetric-key ratchet
    const messageKey = await this.deriveMessageKey(this.chainKey);
    this.chainKey = await this.deriveNextChainKey(this.chainKey);
    this.messageNumber++;
    
    return {
      encryptionKey: messageKey.slice(0, 32),
      macKey: messageKey.slice(32)
    };
  }
  
  async ratchetToMatch(theirEphemeralKey) {
    // DH ratchet when receiving
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: "ECDH", public: theirEphemeralKey },
      this.ephemeralKeyPair.privateKey,
      256
    );
    
    // Update chain key
    this.chainKey = await this.kdf(sharedSecret, "Signal_Chain_Key");
  }
  
  async getMessageKeys() {
    return await this.ratchet();
  }
  
  async deriveMessageKey(chainKey) {
    const key = await crypto.subtle.importKey(
      "raw",
      chainKey,
      { name: "HKDF" },
      false,
      ["deriveBits"]
    );
    
    return await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(32),
        info: new TextEncoder().encode("MessageKeys")
      },
      key,
      512
    );
  }
  
  async deriveNextChainKey(chainKey) {
    const key = await crypto.subtle.importKey(
      "raw",
      chainKey,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const nextKey = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode("Chain")
    );
    
    return new Uint8Array(nextKey);
  }
  
  async kdf(input, info) {
    const key = await crypto.subtle.importKey(
      "raw",
      input,
      { name: "HKDF" },
      false,
      ["deriveBits"]
    );
    
    return await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(32),
        info: new TextEncoder().encode(info)
      },
      key,
      256
    );
  }
}
