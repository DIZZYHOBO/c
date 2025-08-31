// Use the v7 API with default export
export default async (req, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers
    });
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const body = await req.json();
    const { 
      username, 
      passwordHash,  // Client sends hashed password
      encryptedPrivateKeys,  // Private keys encrypted with password
      identityKey, 
      signedPreKey, 
      preKeys 
    } = body;
    
    console.log('Registration attempt for:', username);
    
    if (!username || !passwordHash || !encryptedPrivateKeys || !identityKey || !signedPreKey || !preKeys) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers
      });
    }
    
    // Use Netlify Blobs
    const users = getStore("users");
    const keys = getStore("keys");
    const accounts = getStore("accounts");
    
    // Check if username exists
    const existingUser = await users.get(username);
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Username already taken' }), {
        status: 409,
        headers
      });
    }
    
    const userId = crypto.randomUUID();
    const timestamp = Date.now();
    
    // Store user account (for login)
    await accounts.set(username, {
      id: userId,
      passwordHash,  // Store hashed password for authentication
      encryptedPrivateKeys,  // Encrypted private keys for multi-device
      created: timestamp
    });
    
    // Store user info
    await users.set(username, {
      id: userId,
      created: timestamp
    });
    
    // Store public keys for others to use
    await keys.set(userId, {
      identityKey,
      signedPreKey,
      preKeys,
      lastUpdated: timestamp
    });
    
    console.log('User registered successfully:', userId);
    
    return new Response(JSON.stringify({ 
      userId, 
      success: true,
      timestamp 
    }), {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      details: error.message 
    }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
};

export const config = {
  path: "/.netlify/functions/register"
};
