import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { userId } = await req.json();
    
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }
    
    const keys = getStore("keys");
    const userKeys = await keys.get(userId);
    
    if (!userKeys) {
      return new Response('User not found', { status: 404 });
    }
    
    // Remove a prekey (one-time use)
    let preKey = null;
    if (userKeys.preKeys && userKeys.preKeys.length > 0) {
      preKey = userKeys.preKeys.shift();
      await keys.set(userId, userKeys);
    }
    
    return Response.json({
      identityKey: userKeys.identityKey,
      signedPreKey: userKeys.signedPreKey,
      preKey: preKey
    });
  } catch (error) {
    console.error('Get keys error:', error);
    return new Response('Internal server error', { status: 500 });
  }
};

export const config = {
  path: "/.netlify/functions/get-keys"
};
