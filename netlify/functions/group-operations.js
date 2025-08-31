const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method not allowed'
    };
  }

  try {
    const { action, groupId, userId, members, metadata } = JSON.parse(event.body);
    const groups = getStore("groups");
    
    switch(action) {
      case 'create': {
        if (!userId || !members || !Array.isArray(members)) {
          return {
            statusCode: 400,
            body: 'Invalid create request'
          };
        }
        
        const newGroupId = crypto.randomUUID();
        await groups.set(newGroupId, {
          id: newGroupId,
          creator: userId,
          members: [userId, ...members],
          encryptedMetadata: metadata,
          created: Date.now()
        });
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            groupId: newGroupId,
            success: true 
          })
        };
      }
      
      case 'add-members': {
        if (!groupId || !members || !Array.isArray(members)) {
          return {
            statusCode: 400,
            body: 'Invalid add-members request'
          };
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return {
            statusCode: 404,
            body: 'Group not found'
          };
        }
        
        const newMembers = members.filter(m => !group.members.includes(m));
        group.members.push(...newMembers);
        group.lastUpdated = Date.now();
        await groups.set(groupId, group);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            success: true,
            addedMembers: newMembers 
          })
        };
      }
      
      case 'leave': {
        if (!groupId || !userId) {
          return {
            statusCode: 400,
            body: 'Invalid leave request'
          };
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return {
            statusCode: 404,
            body: 'Group not found'
          };
        }
        
        group.members = group.members.filter(m => m !== userId);
        group.lastUpdated = Date.now();
        
        if (group.members.length === 0) {
          await groups.delete(groupId);
        } else {
          await groups.set(groupId, group);
        }
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ success: true })
        };
      }
      
      case 'get-info': {
        if (!groupId) {
          return {
            statusCode: 400,
            body: 'Invalid get-info request'
          };
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return {
            statusCode: 404,
            body: 'Group not found'
          };
        }
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ group })
        };
      }
      
      default:
        return {
          statusCode: 400,
          body: 'Invalid action'
        };
    }
  } catch (error) {
    console.error('Group operation error:
