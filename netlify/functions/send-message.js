import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { 
      senderId, 
      recipientId, 
      groupId, 
      encryptedContent, 
      ephemeralKey,
      senderKeyId 
    } = await req.json();
    
    // Validate input
    if (!senderId || !encryptedContent) {
      return new Response('Missing required fields', { status: 400 });
    }
    
    if (!recipientId && !groupId) {
      return new Response('Must specify recipient or group', { status: 400 });
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
      // Direct message - store in recipient's inbox
      const inbox = getStore(`inbox_${recipientId}`);
      await inbox.set(messageId, message);
      
      // Store in sender's outbox for delivery confirmation
      const outbox = getStore(`outbox_${senderId}`);
      await outbox.set(messageId, {
        ...message,
        delivered: false
      });
    } else if (groupId) {
      // Group message - store in group's message store
      const groupMessages = getStore(`group_${groupId}`);
      await groupMessages.set(messageId, message);
      
      // Notify each group member
      const groups = getStore("groups");
      const group = await groups.get(groupId);
      
      if (!group) {
        return new Response('Group not found', { status: 404 });
      }
      
      // Add to each member's inbox as a notification
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
    
    return Response.json({ 
      messageId, 
      timestamp,
      success: true 
    });
  } catch (error) {
    console.error('Send message error:', error);
    return new Response('Internal server error', { status: 500 });
  }
};

export const config = {
  path: "/.netlify/functions/send-message"
};
