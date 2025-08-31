// netlify/functions/send-message.js
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const { senderId, recipientId, groupId, encryptedContent, ephemeralKey } = await req.json();
  
  const messages = getStore("messages");
  const messageId = crypto.randomUUID();
  const timestamp = Date.now();
  
  // Store encrypted blob
  const message = {
    id: messageId,
    senderId,
    recipientId,
    groupId,
    encryptedContent, // Already encrypted on client
    ephemeralKey, // For Signal protocol
    timestamp
  };
  
  if (recipientId) {
    // Direct message - store in recipient's inbox
    const inbox = getStore(`inbox_${recipientId}`);
    await inbox.set(messageId, message);
  } else if (groupId) {
    // Group message - store in group's message store
    const groupMessages = getStore(`group_${groupId}`);
    await groupMessages.set(messageId, message);
    
    // Also notify each group member
    const groups = getStore("groups");
    const group = await groups.get(groupId);
    for (const memberId of group.members) {
      const memberInbox = getStore(`inbox_${memberId}`);
      await memberInbox.set(`${messageId}_notification`, {
        type: 'group_message',
        groupId,
        messageId,
        timestamp
      });
    }
  }
  
  return Response.json({ messageId, timestamp });
};
