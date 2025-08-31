const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method not allowed'
    };
  }

  try {
    const { username, identityKey, signedPreKey, preKeys } = JSON.parse(event.body);
    
    if (!username || !identityKey || !signedPreKey || !preKeys) {
      return {
        statusCode: 400,
        body: 'Missing required fields'
      };
    }
    
    const users = getStore("users");
    const keys = getStore("keys");
    
    const existingUser = await users.get(username);
    if (existingUser) {
      return {
        statusCode: 409,
        body: 'Username already taken'
      };
    }
    
    const userId = crypto.randomUUID();
    const timestamp = Date.now();
    
    await users.set(username, {
      id: userId,
      created: timestamp
    });
    
    await keys.set(userId, {
      identityKey,
      signedPreKey,
      preKeys,
      lastUpdated: timestamp
    });
    
    return {
      statusCode: 200,
      headers: {
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
      body: 'Internal server error'
    };
  }
};
