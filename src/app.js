// src/app.js
// Complete Secure Messenger with Multi-Device Account Support

// Local Database wrapper for IndexedDB
class LocalDatabase {
  constructor() {
    this.dbName = 'SecureMessenger';
    this.version = 1;
    this.db = null;
  }
  
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Identity store
        if (!db.objectStoreNames.contains('identity')) {
          db.createObjectStore('identity', { keyPath: 'id' });
        }
        
        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const messages = db.createObjectStore('messages', { keyPath: 'id' });
          messages.createIndex('conversationId', 'conversationId', { unique: false });
          messages.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        // Conversations store
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id' });
        }
        
        // Groups store
        if (!db.objectStoreNames.contains('groups')) {
          db.createObjectStore('groups', { keyPath: 'groupId' });
        }
        
        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }
  
  async saveIdentity(data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['identity'], 'readwrite');
      const store = tx.objectStore('identity');
      const request = store.put({ id: 'self', ...data });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  
  async getIdentity() {
    const tx = this.db.transaction(['identity'], 'readonly');
    const store = tx.objectStore('identity');
    return await this.promisifyRequest(store.get('self'));
  }
  
  async saveMessage(message) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['messages'], 'readwrite');
      const store = tx.objectStore('messages');
      message.id = message.id || crypto.randomUUID();
      const request = store.put(message);
      
      request.onsuccess = () => resolve(message.id);
      request.onerror = () => reject(request.error);
    });
  }
  
  async getMessages(conversationId, limit = 50) {
    const tx = this.db.transaction(['messages'], 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('conversationId');
    
    const messages = [];
    const cursor = index.openCursor(IDBKeyRange.only(conversationId));
    
    return new Promise((resolve) => {
      cursor.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && messages.length < limit) {
          messages.push(cursor.value);
          cursor.continue();
        } else {
          resolve(messages.sort((a, b) => a.timestamp - b.timestamp));
        }
      };
    });
  }
  
  async saveConversation(conversation) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['conversations'], 'readwrite');
      const store = tx.objectStore('conversations');
      const request = store.put(conversation);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getConversations() {
    const tx = this.db.transaction(['conversations'], 'readonly');
    const store = tx.objectStore('conversations');
    return await this.promisifyRequest(store.getAll());
  }
  
  async saveGroup(group) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['groups'], 'readwrite');
      const store = tx.objectStore('groups');
      const request = store.put(group);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getGroup(groupId) {
    const tx = this.db.transaction(['groups'], 'readonly');
    const store = tx.objectStore('groups');
    return await this.promisifyRequest(store.get(groupId));
  }
  
  async getGroups() {
    const tx = this.db.transaction(['groups'], 'readonly');
    const store = tx.objectStore('groups');
    return await this.promisifyRequest(store.getAll());
  }
  
  async getLastSync() {
    const tx = this.db.transaction(['settings'], 'readonly');
    const store = tx.objectStore('settings');
    const result = await this.promisifyRequest(store.get('lastSync'));
    return result ? result.value : 0;
  }
  
  async setLastSync(timestamp) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['settings'], 'readwrite');
      const store = tx.objectStore('settings');
      const request = store.put({ key: 'lastSync', value: timestamp });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async saveSession(session) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['settings'], 'readwrite');
      const store = tx.objectStore('settings');
      const request = store.put({ key: 'session', ...session });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getSession() {
    const tx = this.db.transaction(['settings'], 'readonly');
    const store = tx.objectStore('settings');
    return await this.promisifyRequest(store.get('session'));
  }
  
  async clearSession() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['settings'], 'readwrite');
      const store = tx.objectStore('settings');
      const request = store.delete('session');
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// Main Secure Messenger class with Account Support
class SecureMessenger {
  constructor() {
    this.protocol = null;
    this.userId = null;
    this.username = null;
    this.passwordKey = null;
    this.db = new LocalDatabase();
    this.pollInterval = null;
    this.currentConversation = null;
    this.onMessageReceived = null;
    this.onStatusUpdate = null;
  }
  
  async init() {
    await this.db.init();
    
    // Check if already logged in
    const session = await this.db.getSession();
    if (session && session.userId) {
      this.userId = session.userId;
      this.username = session.username;
      
      // Restore protocol with saved keys
      this.protocol = new SignalProtocol();
      await this.protocol.restoreFromStorage(session.privateKeys);
      
      this.startPolling();
      return true;
    }
    return false;
  }
  
  // Derive encryption key from password
  async derivePasswordKey(password, salt) {
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    
    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    // Derive key using PBKDF2
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }
  
  // Hash password for authentication
  async hashPassword(password, username) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + username);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
  }
  
  // Encrypt private keys with password
  async encryptPrivateKeys(privateKeys, passwordKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(privateKeys));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      passwordKey,
      encoded
    );
    
    return {
      iv: btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
    };
  }
  
  // Decrypt private keys with password
  async decryptPrivateKeys(encryptedKeys, passwordKey) {
    const iv = Uint8Array.from(atob(encryptedKeys.iv), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(encryptedKeys.data), c => c.charCodeAt(0));
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      passwordKey,
      data
    );
    
    const decoded = new TextDecoder().decode(decrypted);
    return JSON.parse(decoded);
  }
  
  async register(username, password) {
    // Initialize Signal Protocol
    this.protocol = new SignalProtocol();
    const keys = await this.protocol.initialize();
    
    // Derive password key for encrypting private keys
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordKey = await this.derivePasswordKey(password, salt);
    const passwordHash = await this.hashPassword(password, username);
    
    // Get private keys from protocol
    const privateKeys = await this.protocol.exportPrivateKeys();
    
    // Encrypt private keys with password
    const encryptedPrivateKeys = await this.encryptPrivateKeys(privateKeys, passwordKey);
    
    // Register with server
    const response = await fetch('/.netlify/functions/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        passwordHash,
        encryptedPrivateKeys: {
          ...encryptedPrivateKeys,
          salt: btoa(String.fromCharCode(...salt))
        },
        ...keys
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }
    
    const { userId } = await response.json();
    this.userId = userId;
    this.username = username;
    this.passwordKey = passwordKey;
    
    // Save session locally
    await this.db.saveSession({
      userId,
      username,
      privateKeys,
      salt: btoa(String.fromCharCode(...salt))
    });
    
    // Start polling for messages
    this.startPolling();
    
    return userId;
  }
  
  async login(username, password) {
    // Hash password for authentication
    const passwordHash = await this.hashPassword(password, username);
    
    // Login to server
    const response = await fetch('/.netlify/functions/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        passwordHash
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }
    
    const { userId, encryptedPrivateKeys, publicKeys } = await response.json();
    
    // Derive password key
    const salt = Uint8Array.from(atob(encryptedPrivateKeys.salt), c => c.charCodeAt(0));
    const passwordKey = await this.derivePasswordKey(password, salt);
    
    // Decrypt private keys
    const privateKeys = await this.decryptPrivateKeys(encryptedPrivateKeys, passwordKey);
    
    // Restore Signal Protocol with keys
    this.protocol = new SignalProtocol();
    await this.protocol.restoreFromKeys(privateKeys, publicKeys);
    
    this.userId = userId;
    this.username = username;
    this.passwordKey = passwordKey;
    
    // Save session locally
    await this.db.saveSession({
      userId,
      username,
      privateKeys,
      salt: btoa(String.fromCharCode(...salt))
    });
    
    // Start polling for messages
    this.startPolling();
    
    return userId;
  }
  
  async logout() {
    this.stopPolling();
    await this.db.clearSession();
    this.userId = null;
    this.username = null;
    this.protocol = null;
    this.passwordKey = null;
  }
  
  async sendMessage(recipientId, text, options = {}) {
    try {
      // Encrypt message
      const encrypted = await this.protocol.encryptMessage(recipientId, text);
      
      // Send to server
      const response = await fetch('/.netlify/functions/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: this.userId,
          recipientId,
          ...encrypted,
          ...options
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to send message');
      }
      
      const { messageId, timestamp } = await response.json();
      
      // Save to local database
      await this.db.saveMessage({
        id: messageId,
        conversationId: recipientId,
        recipientId,
        text,
        sent: true,
        timestamp,
        delivered: false,
        read: false
      });
      
      // Save conversation if new
      await this.db.saveConversation({
        id: recipientId,
        name: recipientId,
        lastMessage: text,
        lastMessageTime: timestamp,
        unreadCount: 0
      });
      
      return { messageId, timestamp };
    } catch (error) {
      console.error('Send message error:', error);
      throw error;
    }
  }
  
  async sendGroupMessage(groupId, text) {
    try {
      // Get group info
      const group = await this.db.getGroup(groupId);
      if (!group) {
        throw new Error('Group not found');
      }
      
      // Encrypt with group key
      const encrypted = await this.encryptWithGroupKey(text, group.groupKey);
      
      // Send to server
      const response = await fetch('/.netlify/functions/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: this.userId,
          groupId,
          encryptedContent: encrypted.content,
          senderKeyId: encrypted.keyId
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to send group message');
      }
      
      const { messageId, timestamp } = await response.json();
      
      // Save to local database
      await this.db.saveMessage({
        id: messageId,
        conversationId: groupId,
        groupId,
        text,
        sent: true,
        timestamp
      });
      
      return { messageId, timestamp };
    } catch (error) {
      console.error('Send group message error:', error);
      throw error;
    }
  }
  
  async createGroup(name, memberUsernames) {
    try {
      // Generate group key
      const groupKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      
      const groupId = crypto.randomUUID();
      const exportedGroupKey = await crypto.subtle.exportKey("jwk", groupKey);
      
      // For each member, encrypt the group key with their public key
      const memberIds = [];
      for (const username of memberUsernames) {
        memberIds.push(username);
        
        // Send encrypted group key via 1-1 message
        const groupInvite = {
          type: 'group_invite',
          groupId,
          groupName: name,
          groupKey: exportedGroupKey
        };
        
        await this.sendMessage(username, JSON.stringify(groupInvite), {
          isSystemMessage: true
        });
      }
      
      // Create group on server
      const response = await fetch('/.netlify/functions/group-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          userId: this.userId,
          members: memberIds,
          metadata: await this.encryptMetadata({ name }, groupKey)
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create group');
      }
      
      const { groupId: serverGroupId } = await response.json();
      
      // Save group locally
      await this.db.saveGroup({
        groupId: serverGroupId || groupId,
        name,
        groupKey: exportedGroupKey,
        members: [this.userId, ...memberIds],
        createdAt: Date.now()
      });
      
      return serverGroupId || groupId;
    } catch (error) {
      console.error('Create group error:', error);
      throw error;
    }
  }
  
  async encryptWithGroupKey(plaintext, groupKeyJwk) {
    const groupKey = await crypto.subtle.importKey(
      "jwk",
      groupKeyJwk,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      groupKey,
      encoded
    );
    
    return {
      content: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
      iv: btoa(String.fromCharCode(...iv)),
      keyId: 'group_key_v1'
    };
  }
  
  async decryptWithGroupKey(encryptedContent, iv, groupKeyJwk) {
    const groupKey = await crypto.subtle.importKey(
      "jwk",
      groupKeyJwk,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    
    const encryptedBytes = Uint8Array.from(atob(encryptedContent), c => c.charCodeAt(0));
    const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      groupKey,
      encryptedBytes
    );
    
    return new TextDecoder().decode(decrypted);
  }
  
  async encryptMetadata(metadata, groupKey) {
    const json = JSON.stringify(metadata);
    const encrypted = await this.encryptWithGroupKey(json, 
      await crypto.subtle.exportKey("jwk", groupKey));
    return encrypted.content;
  }
  
  startPolling() {
    // Poll every 2 seconds for new messages
    this.pollInterval = setInterval(() => {
      this.fetchMessages();
    }, 2000);
    
    // Fetch immediately
    this.fetchMessages();
  }
  
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
  
  async fetchMessages() {
    try {
      const lastSync = await this.db.getLastSync();
      
      const response = await fetch('/.netlify/functions/fetch-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.userId,
          since: lastSync
        })
      });
      
      if (!response.ok) {
        console.error('Failed to fetch messages');
        return;
      }
      
      const { messages } = await response.json();
      
      for (const message of messages) {
        await this.processIncomingMessage(message);
      }
      
      if (messages.length > 0) {
        await this.db.setLastSync(Date.now());
      }
    } catch (error) {
      console.error('Fetch messages error:', error);
    }
  }
  
  async processIncomingMessage(message) {
    try {
      if (message.type === 'group_message') {
        // Fetch the actual group message
        await this.processGroupMessage(message);
      } else {
        // Direct message
        const decrypted = await this.protocol.decryptMessage(
          message.senderId,
          message.encryptedContent,
          message.ephemeralKey,
          message.mac
        );
        
        // Check if it's a system message
        let parsedMessage = decrypted;
        let isSystemMessage = false;
        
        try {
          const parsed = JSON.parse(decrypted);
          if (parsed.type === 'group_invite') {
            // Handle group invite
            await this.handleGroupInvite(parsed);
            isSystemMessage = true;
          }
          parsedMessage = parsed;
        } catch (e) {
          // Not JSON, regular message
        }
        
        if (!isSystemMessage) {
          // Save regular message
          await this.db.saveMessage({
            id: message.id,
            conversationId: message.senderId,
            senderId: message.senderId,
            text: parsedMessage,
            received: true,
            timestamp: message.timestamp,
            read: false
          });
          
          // Update conversation
          await this.db.saveConversation({
            id: message.senderId,
            name: message.senderId,
            lastMessage: parsedMessage,
            lastMessageTime: message.timestamp,
            unreadCount: 1
          });
          
          // Notify UI
          if (this.onMessageReceived) {
            this.onMessageReceived(parsedMessage, message.senderId);
          }
        }
      }
    } catch (error) {
      console.error('Process message error:', error);
    }
  }
  
  async processGroupMessage(notification) {
    try {
      // Fetch actual message from group store
      const response = await fetch('/.netlify/functions/group-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get-message',
          groupId: notification.groupId,
          messageId: notification.messageId
        })
      });
      
      if (!response.ok) {
        console.error('Failed to fetch group message');
        return;
      }
      
      const { message } = await response.json();
      
      // Get group info
      const group = await this.db.getGroup(notification.groupId);
      if (!group) {
        console.error('Unknown group:', notification.groupId);
        return;
      }
      
      // Decrypt with group key
      const decrypted = await this.decryptWithGroupKey(
        message.encryptedContent,
        message.iv,
        group.groupKey
      );
      
      // Save message
      await this.db.saveMessage({
        id: message.id,
        conversationId: notification.groupId,
        groupId: notification.groupId,
        senderId: message.senderId,
        text: decrypted,
        received: true,
        timestamp: message.timestamp,
        read: false
      });
      
      // Notify UI
      if (this.onMessageReceived) {
        this.onMessageReceived(decrypted, message.senderId, notification.groupId);
      }
    } catch (error) {
      console.error('Process group message error:', error);
    }
  }
  
  async handleGroupInvite(invite) {
    // Save group
    await this.db.saveGroup({
      groupId: invite.groupId,
      name: invite.groupName,
      groupKey: invite.groupKey,
      joinedAt: Date.now()
    });
    
    // Notify UI
    if (this.onStatusUpdate) {
      this.onStatusUpdate(`Joined group: ${invite.groupName}`);
    }
  }
  
  async getConversations() {
    return await this.db.getConversations();
  }
  
  async getMessages(conversationId, limit = 50) {
    return await this.db.getMessages(conversationId, limit);
  }
  
  async getGroups() {
    return await this.db.getGroups();
  }
  
  async generateSafetyNumber(recipientId) {
    // Fetch recipient's public key
    const response = await fetch('/.netlify/functions/get-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: recipientId })
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch recipient keys');
    }
    
    const recipientKeys = await response.json();
    
    // Generate safety number from combined keys
    const myKey = await crypto.subtle.exportKey('raw', this.protocol.identityKeyPair.publicKey);
    const theirKey = recipientKeys.identityKey;
    
    // Combine and hash
    const combined = new TextEncoder().encode(JSON.stringify({
      mine: Array.from(new Uint8Array(myKey)),
      theirs: theirKey
    }));
    
    const hash = await crypto.subtle.digest('SHA-256', combined);
    const hashArray = Array.from(new Uint8Array(hash));
    
    // Format as readable number groups
    const numbers = hashArray
      .slice(0, 20)
      .map(b => b.toString().padStart(3, '0'))
      .join('')
      .match(/.{1,5}/g)
      .join(' ');
    
    return numbers;
  }
  
  async setDisappearingMessages(conversationId, ttlSeconds) {
    // Store setting
    await this.db.saveConversation({
      id: conversationId,
      disappearingMessages: ttlSeconds,
      updatedAt: Date.now()
    });
  }
  
  async deleteMessage(messageId) {
    // Delete from local database
    return new Promise((resolve, reject) => {
      const tx = this.db.db.transaction(['messages'], 'readwrite');
      const store = tx.objectStore('messages');
      const request = store.delete(messageId);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
