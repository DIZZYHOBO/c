const { getStore } = require("@netlify/blobs");

// Simple UUID v4 generator (if needed)
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight requests
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
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { userId, since = 0, limit = 50 } = body;
    
    console.log('Fetching messages for user:', userId, 'since:', since);
    
    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing userId' })
      };
    }
    
    const inbox = getStore(`inbox_${userId}`);
    const messages = [];
    
    try {
      // List all messages in inbox
      const { blobs } = await inbox.list();
      
      console.log(`Found ${blobs.length} messages in inbox`);
      
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
          // Continue processing other messages even if one fails
        }
      }
      
      // Sort by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);
      
      console.log(`Returning ${messages.length} messages`);
      
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          messages,
          count: messages.length,
          timestamp: Date.now()
        })
      };
    } catch (error) {
      // If inbox doesn't exist yet, return empty array
      console.log('Inbox might not exist yet:', error.message);
      
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          messages: [],
          count: 0,
          timestamp: Date.now()
        })
      };
    }
  } catch (error) {
    console.error('Fetch messages error:', error);
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
