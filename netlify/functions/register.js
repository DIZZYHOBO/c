const { getStore } = require("@netlify/blobs");

// Simple UUID v4 generator
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

  // Handle preflight
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
      body: 'Method not allowed'
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { username, identityKey, signedPreKey, preKeys } = body;
    
    console.log('Registration attempt for:', username);
    
    if (!username || !identityKey || !signedPreKey || !preKeys) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }
    
    const users = getStore("users");
    const keys = getStore("keys");
    
    // Check if username exists
    const existingUser = await users.get(username);
    if (existingUser) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'Username already taken' })
      };
    }
    
    const userId = generateUUID();
    const timestamp = Date.now();
    
    // Store user info
    await users.set(username, {
      id: userId,
      created: timestamp
    });
    
    // Store public keys
    await keys.set(userId, {
      identityKey,
      signedPreKey,
      preKeys,
      lastUpdated: timestamp
    });
    
    console.log('User registered successfully:', userId);
    
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        userId, 
        success: true,
        timestamp 
      })
    };
  } catch (error) {
    console.error('Registration error:', error);
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
