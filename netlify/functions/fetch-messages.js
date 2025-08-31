// netlify/functions/fetch-messages.js
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const { userId, since = 0 } = await req.json();
  
  // Get user's inbox
  const inbox = getStore(`inbox_${userId}`);
  const messages = [];
  
  // Fetch all messages since timestamp
  const { blobs } = await inbox.list();
  
  for (const key of blobs) {
    const message = await inbox.get(key.key);
    if (message.timestamp > since) {
      messages.push(message);
      // Delete after fetching (like Signal's server)
      await inbox.delete(key.key);
    }
  }
  
  return Response.json({ messages });
};
