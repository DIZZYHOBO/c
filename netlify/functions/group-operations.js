import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { action, groupId, userId, members, metadata } = await req.json();
    const groups = getStore("groups");
    
    switch(action) {
      case 'create': {
        if (!userId || !members || !Array.isArray(members)) {
          return new Response('Invalid create request', { status: 400 });
        }
        
        const newGroupId = crypto.randomUUID();
        await groups.set(newGroupId, {
          id: newGroupId,
          creator: userId,
          members: [userId, ...members],
          encryptedMetadata: metadata,
          created: Date.now()
        });
        
        return Response.json({ 
          groupId: newGroupId,
          success: true 
        });
      }
      
      case 'add-members': {
        if (!groupId || !members || !Array.isArray(members)) {
          return new Response('Invalid add-members request', { status: 400 });
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return new Response('Group not found', { status: 404 });
        }
        
        // Add new members
        const newMembers = members.filter(m => !group.members.includes(m));
        group.members.push(...newMembers);
        group.lastUpdated = Date.now();
        await groups.set(groupId, group);
        
        return Response.json({ 
          success: true,
          addedMembers: newMembers 
        });
      }
      
      case 'leave': {
        if (!groupId || !userId) {
          return new Response('Invalid leave request', { status: 400 });
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return new Response('Group not found', { status: 404 });
        }
        
        group.members = group.members.filter(m => m !== userId);
        group.lastUpdated = Date.now();
        
        if (group.members.length === 0) {
          // Delete empty group
          await groups.delete(groupId);
        } else {
          await groups.set(groupId, group);
        }
        
        return Response.json({ success: true });
      }
      
      case 'get-info': {
        if (!groupId) {
          return new Response('Invalid get-info request', { status: 400 });
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return new Response('Group not found', { status: 404 });
        }
        
        return Response.json({ group });
      }
      
      default:
        return new Response('Invalid action', { status: 400 });
    }
  } catch (error) {
    console.error('Group operation error:', error);
    return new Response('Internal server error', { status: 500 });
  }
};

export const config = {
  path: "/.netlify/functions/group-operations"
};
