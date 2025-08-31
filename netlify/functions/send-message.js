const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
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
        body: 'Missing required fields'
      };
    }
    
    if (!recipientId && !groupId) {
      return {
        statusCode: 400,
        body: 'Must specify recipient or group'
      };
    }
    
    const messageId = crypto.randomUUID();
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
          body: 'Group not found'
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
      body: 'Internal server error'
    };
  }
};
