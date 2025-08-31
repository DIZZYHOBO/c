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
      headers
    });
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const body = await req.json();
    const { username, passwordHash } = body;
    
    if (!username || !passwordHash) {
      return new Response(JSON.stringify({ error: 'Missing credentials' }), {
        status: 400,
        headers
      });
    }
    
    const accounts = getStore("accounts");
    const users = getStore("users");
    const keys = getStore("keys");
    
    // Get account
    const account = await accounts.get(username);
    if (!account) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers
      });
    }
    
    // Verify password hash
    if (account.passwordHash !== passwordHash) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers
      });
    }
    
    // Get user info
    const user = await users.get(username);
    const publicKeys = await keys.get(account.id);
    
    // Return encrypted private keys so user can decrypt locally
    return new Response(JSON.stringify({ 
      userId: account.id,
      username,
      encryptedPrivateKeys: account.encryptedPrivateKeys,
      publicKeys,
      success: true
    }), {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      details: error.message 
    }), {
      status: 500,
      headers
    });
  }
};

export const config = {
  path: "/.netlify/functions/login"
};
