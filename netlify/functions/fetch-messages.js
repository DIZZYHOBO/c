import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { userId, since = 0, limit = 50 } = await req.json();
    
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }
    
    const inbox = getStore(`inbox_${userId}`);
    const messages = [];
    
    // List all messages in inbox
    const { blobs } = await inbox.list();
    
    for (const blob of blobs) {
      const message = await inbox.get(blob.key);
      
      if (message && message.timestamp > since) {
        messages.push(message);
        
        // Delete after fetching (forward secrecy)
        await inbox.delete(blob.key);
        
        if (messages.length >= limit) break;
      }
    }
    
    // Sort by timestamp
    messages.sort((a, b) => a.timestamp - b.timestamp);
    
    return Response.json({ 
      messages,
      count: messages.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Fetch messages error:', error);
    return new Response('Internal server error', { status: 500 });
  }
};

export const config = {
  path: "/.netlify/functions/fetch-messages"
};
