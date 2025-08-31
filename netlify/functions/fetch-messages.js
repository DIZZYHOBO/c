// netlify/functions/fetch-messages.js
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
    const { userId, since = 0, limit = 50 } = body;
    
    console.log('Fetching messages for user:', userId, 'since:', since);
    
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    const inbox = getStore(`inbox_${userId}`);
    const messages = [];
    
    try {
      // List all messages in inbox
      const { blobs } = await inbox.list();
      
      console.log(`Found ${blobs ? blobs.length : 0} items in inbox`);
      
      if (blobs) {
        for (const blob of blobs) {
          try {
            const message = await inbox.get(blob.key);
            
            if (message && message.timestamp > since) {
              messages.push(message);
              
              // Delete after fetching (forward secrecy)
              await inbox.delete(blob.key);
              
              if (messages.length >= limit) break;
            }
          } catch (err) {
            console.error('Error processing message:', blob.key, err);
          }
        }
      }
      
      // Sort by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);
      
      console.log(`Returning ${messages.length} messages`);
      
      return new Response(JSON.stringify({ 
        messages,
        count: messages.length,
        timestamp: Date.now()
      }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } catch (error) {
      // Inbox might not exist yet
      console.log('Inbox might not exist yet:', error.message);
      
      return new Response(JSON.stringify({ 
        messages: [],
        count: 0,
        timestamp: Date.now()
      }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Fetch messages error:', error);
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
  path: "/.netlify/functions/fetch-messages"
};
