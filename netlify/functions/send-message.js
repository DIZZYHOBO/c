const { getStore } = require("@netlify/blobs");

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: 'Method not allowed'
    };
  }

  try {
    const { 
      senderId, 
      recipientId, 
      groupId, 
      encryptedContent, 
      ephemeralKey,
      senderKeyId 
    } = JSON.parse(event.body);
    
    if (!senderId || !encryptedContent) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }
    
    if (!recipientId && !groupId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Must specify recipient or group' })
      };
    }
    
    const messageId = generateUUID();
    const timestamp = Date.now();
    
    const message = {
      id: messageId,
      senderId,
      recipientId,
      groupId,
      encryptedContent,
      ephemeralKey,
      senderKeyId,
      timestamp
    };
    
    if (recipientId) {
      const inbox = getStore(`inbox_${recipientId}`);
      await inbox.set(messageId, message);
      
      const outbox = getStore(`outbox_${senderId}`);
      await outbox.set(messageId, {
        ...message,
        delivered: false
      });
    } else if (groupId) {
      const groupMessages = getStore(`group_${groupId}`);
      await groupMessages.set(messageId, message);
      
      const groups = getStore("groups");
      const group = await groups.get(groupId);
      
      if (!group) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Group not found' })
        };
      }
      
      for (const memberId of group.members) {
        if (memberId !== senderId) {
          const memberInbox = getStore(`inbox_${memberId}`);
          await memberInbox.set(`${messageId}_notif`, {
            type: 'group_message',
            groupId,
            messageId,
            timestamp
          });
        }
      }
    }
    
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        messageId, 
        timestamp,
        success: true 
      })
    };
  } catch (error) {
    console.error('Send message error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};
