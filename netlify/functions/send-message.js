// netlify/functions/send-message.js
export default async (req, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const body = await req.json();
    const { 
      senderId, 
      recipientId, 
      groupId, 
      encryptedContent, 
      ephemeralKey,
      mac,
      senderKeyId 
    } = body;
    
    if (!senderId || !encryptedContent) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    if (!recipientId && !groupId) {
      return new Response(JSON.stringify({ error: 'Must specify recipient or group' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
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
      mac,
      senderKeyId,
      timestamp
    };
    
    if (recipientId) {
      // Direct message
      const inbox = getStore(`inbox_${recipientId}`);
      await inbox.set(messageId, message);
      
      // Store in sender's outbox for delivery confirmation
      const outbox = getStore(`outbox_${senderId}`);
      await outbox.set(messageId, {
        ...message,
        delivered: false
      });
      
      console.log('Direct message sent:', messageId);
    } else if (groupId) {
      // Group message
      const groupMessages = getStore(`group_${groupId}`);
      await groupMessages.set(messageId, message);
      
      // Get group members
      const groups = getStore("groups");
      const group = await groups.get(groupId);
      
      if (!group) {
        return new Response(JSON.stringify({ error: 'Group not found' }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      // Notify each member (except sender)
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
      
      console.log('Group message sent:', messageId);
    }
    
    return new Response(JSON.stringify({ 
      messageId, 
      timestamp,
      success: true 
    }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Send message error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: "/.netlify/functions/send-message"
};
