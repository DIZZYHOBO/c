import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { username, identityKey, signedPreKey, preKeys } = await req.json();
    
    // Validate input
    if (!username || !identityKey || !signedPreKey || !preKeys) {
      return new Response('Missing required fields', { status: 400 });
    }
    
    const users = getStore("users");
    const keys = getStore("keys");
    
    // Check if username exists
    const existingUser = await users.get(username);
    if (existingUser) {
      return new Response('Username already taken', { status: 409 });
    }
    
    const userId = crypto.randomUUID();
    const timestamp = Date.now();
    
    // Store user info
    await users.set(username, {
      id: userId,
      created: timestamp
    });
    
    // Store public keys for key exchange
    await keys.set(userId, {
      identityKey,
      signedPreKey,
      preKeys,
      lastUpdated: timestamp
    });
    
    return Response.json({ 
      userId, 
      success: true,
      timestamp 
    });
  } catch (error) {
    console.error('Registration error:', error);
    return new Response('Internal server error', { status: 500 });
  }
};

export const config = {
  path: "/.netlify/functions/register"
};
