// netlify/functions/get-keys.js
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
    const { userId } = body;
    
    console.log('Fetching keys for user:', userId);
    
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    const keys = getStore("keys");
    const userKeys = await keys.get(userId);
    
    if (!userKeys) {
      console.log('User keys not found:', userId);
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // Remove a prekey (one-time use)
    let preKey = null;
    if (userKeys.preKeys && userKeys.preKeys.length > 0) {
      preKey = userKeys.preKeys.shift();
      await keys.set(userId, userKeys);
      console.log('Prekey consumed, remaining:', userKeys.preKeys.length);
    }
    
    console.log('Keys retrieved successfully for:', userId);
    
    return new Response(JSON.stringify({
      identityKey: userKeys.identityKey,
      signedPreKey: userKeys.signedPreKey,
      preKey: preKey
    }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get keys error:', error);
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
  path: "/.netlify/functions/get-keys"
};
