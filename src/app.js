// src/app.js
class SecureMessenger {
  constructor() {
    this.protocol = new SignalProtocol();
    this.userId = null;
    this.db = new LocalDatabase(); // IndexedDB wrapper
    this.pollInterval = null;
  }
  
  async register(username) {
    // Generate all keys locally
    const keys = await this.protocol.initialize();
    
    // Register with Netlify backend
    const response = await fetch('/.netlify/functions/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        ...keys
      })
    });
    
    const { userId } = await response.json();
    this.userId = userId;
    
    // Save identity locally
    await this.db.saveIdentity({
      userId,
      username,
      identityKeyPair: this.protocol.identityKeyPair
    });
    
    // Start polling for messages
    this.startPolling();
  }
  
  async sendMessage(recipientId, text) {
    // Encrypt locally
    const encrypted = await this.protocol.encryptMessage(recipientId, text);
    
    // Send to Netlify
    await fetch('/.netlify/functions/send-message', {
      method: 'POST',
      body: JSON.stringify({
        senderId: this.userId,
        recipientId,
        ...encrypted
      })
    });
    
    // Save to local database
    await this.db.saveMessage({
      recipientId,
      text,
      sent: true,
      timestamp: Date.now()
    });
  }
  
  async createGroup(name, memberIds) {
    // Generate group key
    const groupKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    
    const groupId = crypto.randomUUID();
    
    // Send group key to each member via 1-1 encrypted message
    for (const memberId of memberIds) {
      const encryptedGroupKey = await this.protocol.encryptMessage(
        memberId,
        JSON.stringify({
          type: 'group_invite',
          groupId,
          groupName: name,
          groupKey: await crypto.subtle.exportKey("jwk", groupKey)
        })
      );
      
      await fetch('/.netlify/functions/send-message', {
        method: 'POST',
        body: JSON.stringify({
          senderId: this.userId,
          recipientId: memberId,
          ...encryptedGroupKey
        })
      });
    }
    
    // Store group locally
    await this.db.saveGroup({
      groupId,
      name,
      groupKey,
      members: memberIds
    });
    
    return groupId;
  }
  
  startPolling() {
    // Poll for new messages every 2 seconds
    this.pollInterval = setInterval(async () => {
      const lastSync = await this.db.getLastSync();
      
      const response = await fetch('/.netlify/functions/fetch-messages', {
        method: 'POST',
        body: JSON.stringify({
          userId: this.userId,
          since: lastSync
        })
      });
      
      const { messages } = await response.json();
      
      for (const message of messages) {
        // Decrypt and process
        await this.processIncomingMessage(message);
      }
      
      await this.db.setLastSync(Date.now());
    }, 2000);
  }
  
  async processIncomingMessage(message) {
    if (message.type === 'group_message') {
      // Fetch actual message from group store
      const groupMessage = await this.fetchGroupMessage(message.groupId, message.messageId);
      await this.decryptGroupMessage(groupMessage);
    } else {
      // Direct message - decrypt with Signal protocol
      const decrypted = await this.protocol.decryptMessage(
        message.senderId,
        message.encryptedContent,
        message.ephemeralKey
      );
      
      await this.db.saveMessage({
        senderId: message.senderId,
        text: decrypted,
        received: true,
        timestamp: message.timestamp
      });
      
      // Update UI
      this.onMessageReceived?.(decrypted, message.senderId);
    }
  }
}
