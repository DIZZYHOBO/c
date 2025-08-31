// netlify/functions/register.js
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const { username, identityKey, signedPreKey, preKeys } = await req.json();
  
  // Store user's public keys only
  const users = getStore("users");
  const keys = getStore("keys");
  
  const userId = crypto.randomUUID();
  
  // Store user info
  await users.set(username, {
    id: userId,
    created: Date.now()
  });
  
  // Store public keys for key exchange
  await keys.set(userId, {
    identityKey,
    signedPreKey,
    preKeys,
    lastUpdated: Date.now()
  });
  
  return Response.json({ userId, success: true });
};
