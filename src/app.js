<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Secure Messenger App</title>
</head>
<body>
<script>
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
    const tx = this.db.transaction(['identity'], 'readwrite');
    const store = tx.objectStore('identity');
    await store.put({ id: 'self', ...data });
  }
  
  async getIdentity() {
    const tx = this.db.transaction(['identity'], 'readonly');
    const store = tx.objectStore('identity');
    return await this.promisifyRequest(store.get('self'));
  }
  
  async saveMessage(message) {
    const tx = this.db.transaction(['messages'], 'readwrite');
    const store = tx.objectStore('messages');
    message.id = message.id || crypto.randomUUID();
    await store.put(message);
    return message.id;
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
    const tx = this.db.transaction(['conversations'], 'readwrite');
    const store = tx.objectStore('conversations');
    await store.put(conversation);
  }
  
  async getConversations() {
    const tx = this.db.transaction(['conversations'], 'readonly');
    const store = tx.objectStore('conversations');
    return await this.promisifyRequest(store.getAll());
  }
  
  async saveGroup(group) {
    const tx = this.db.transaction(['groups'], 'readwrite');
    const store = tx.objectStore('groups');
    await store.put(group);
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
    const tx = this.db.transaction(['settings'], 'readwrite');
    const store = tx.objectStore('settings');
    await store.put({ key: 'lastSync', value: timestamp });
  }
  
  promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// Main Secure Messenger class
class SecureMessenger {
  constructor() {
    this.protocol = null;
    this.userId = null;
    this.username = null;
    this.db = new LocalDatabase();
    this.pollInterval = null;
    this.currentConversation = null;
    this.onMessageReceived = null;
    this.onStatusUpdate = null;
  }
  
  async init() {
    await this.db.init();
    
    // Check if already registered
    const identity = await this.db.getIdentity();
    if (identity) {
      this.userId = identity.userId;
      this.username = identity.username;
      
      // Load stored protocol keys
      this.protocol = new SignalProtocol();
      // In production, restore keys from identity
      
      this.startPolling();
      return true;
    }
    return false;
  }
  
  async register(username) {
    // Initialize Signal Protocol
    this.protocol = new SignalProtocol();
    const keys = await this.protocol.initialize();
    
    // Register with server
    const response = await fetch('/.netlify/functions/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        ...keys
      })
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Registration failed: ${text}`);
    }
    
    const { userId } = await response.json();
    this.userId = userId;
    this.username = username;
    
    // Save identity locally
    await this.db.saveIdentity({
      userId,
      username,
      registeredAt: Date.now()
    });
    
    // Start polling for messages
    this.startPolling();
    
    return userId;
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
        // In production, fetch user ID from username
        // For now, we'll use username as ID
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
    const tx = this.db.db.transaction(['messages'], 'readwrite');
    const store = tx.objectStore('messages');
    await store.delete(messageId);
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SecureMessenger, LocalDatabase };
}
</script>
</body>
</html>
