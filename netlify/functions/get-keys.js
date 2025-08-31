const { getStore } = require("@netlify/blobs");

// Simple UUID v4 generator (if needed for any operations)
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
    const { userId } = body;
    
    console.log('Fetching keys for user:', userId);
    
    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing userId' })
      };
    }
    
    const keys = getStore("keys");
    const userKeys = await keys.get(userId);
    
    if (!userKeys) {
      console.log('User not found:', userId);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }
    
    // Remove a prekey (one-time use)
    let preKey = null;
    if (userKeys.preKeys && userKeys.preKeys.length > 0) {
      preKey = userKeys.preKeys.shift();
      // Update the user's keys with one prekey removed
      await keys.set(userId, userKeys);
      console.log('Prekey consumed, remaining:', userKeys.preKeys.length);
    }
    
    console.log('Keys retrieved successfully for:', userId);
    
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        identityKey: userKeys.identityKey,
        signedPreKey: userKeys.signedPreKey,
        preKey: preKey
      })
    };
  } catch (error) {
    console.error('Get keys error:', error);
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
