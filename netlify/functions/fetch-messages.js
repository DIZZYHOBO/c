const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method not allowed'
    };
  }

  try {
    const { userId, since = 0, limit = 50 } = JSON.parse(event.body);
    
    if (!userId) {
      return {
        statusCode: 400,
        body: 'Missing userId'
      };
    }
    
    const inbox = getStore(`inbox_${userId}`);
    const messages = [];
    
    const { blobs } = await inbox.list();
    
    for (const blob of blobs) {
      const message = await inbox.get(blob.key);
      
      if (message && message.timestamp > since) {
        messages.push(message);
        await inbox.delete(blob.key);
        
        if (messages.length >= limit) break;
      }
    }
    
    messages.sort((a, b) => a.timestamp - b.timestamp);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        messages,
        count: messages.length,
        timestamp: Date.now()
      })
    };
  } catch (error) {
    console.error('Fetch messages error:', error);
    return {
      statusCode: 500,
      body: 'Internal server error'
    };
  }
};
