// netlify/functions/group-operations.js
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
    const { action, groupId, userId, members, metadata } = body;
    
    const groups = getStore("groups");
    
    switch(action) {
      case 'create': {
        if (!userId || !members || !Array.isArray(members)) {
          return new Response(JSON.stringify({ error: 'Invalid create request' }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        const newGroupId = crypto.randomUUID();
        await groups.set(newGroupId, {
          id: newGroupId,
          creator: userId,
          members: [userId, ...members],
          encryptedMetadata: metadata,
          created: Date.now()
        });
        
        console.log('Group created:', newGroupId);
        
        return new Response(JSON.stringify({ 
          groupId: newGroupId,
          success: true 
        }), {
          status: 200,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      case 'add-members': {
        if (!groupId || !members || !Array.isArray(members)) {
          return new Response(JSON.stringify({ error: 'Invalid add-members request' }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return new Response(JSON.stringify({ error: 'Group not found' }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        const newMembers = members.filter(m => !group.members.includes(m));
        group.members.push(...newMembers);
        group.lastUpdated = Date.now();
        await groups.set(groupId, group);
        
        console.log('Members added to group:', groupId);
        
        return new Response(JSON.stringify({ 
          success: true,
          addedMembers: newMembers 
        }), {
          status: 200,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      case 'leave': {
        if (!groupId || !userId) {
          return new Response(JSON.stringify({ error: 'Invalid leave request' }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return new Response(JSON.stringify({ error: 'Group not found' }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        group.members = group.members.filter(m => m !== userId);
        group.lastUpdated = Date.now();
        
        if (group.members.length === 0) {
          await groups.delete(groupId);
          console.log('Group deleted (empty):', groupId);
        } else {
          await groups.set(groupId, group);
          console.log('User left group:', userId, groupId);
        }
        
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      case 'get-info': {
        if (!groupId) {
          return new Response(JSON.stringify({ error: 'Invalid get-info request' }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return new Response(JSON.stringify({ error: 'Group not found' }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        return new Response(JSON.stringify({ group }), {
          status: 200,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      case 'get-message': {
        if (!groupId || !body.messageId) {
          return new Response(JSON.stringify({ error: 'Invalid get-message request' }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        const groupMessages = getStore(`group_${groupId}`);
        const message = await groupMessages.get(body.messageId);
        
        if (!message) {
          return new Response(JSON.stringify({ error: 'Message not found' }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        return new Response(JSON.stringify({ message }), {
          status: 200,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('Group operation error:', error);
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
  path: "/.netlify/functions/group-operations"
};
