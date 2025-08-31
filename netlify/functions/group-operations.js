const { getStore } = require("@netlify/blobs");

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
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
            headers,
            body: JSON.stringify({ error: 'Invalid create request' })
          };
        }
        
        const newGroupId = generateUUID();
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
            ...headers,
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
            headers,
            body: JSON.stringify({ error: 'Invalid add-members request' })
          };
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Group not found' })
          };
        }
        
        const newMembers = members.filter(m => !group.members.includes(m));
        group.members.push(...newMembers);
        group.lastUpdated = Date.now();
        await groups.set(groupId, group);
        
        return {
          statusCode: 200,
          headers: {
            ...headers,
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
            headers,
            body: JSON.stringify({ error: 'Invalid leave request' })
          };
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Group not found' })
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
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ success: true })
        };
      }
      
      case 'get-info': {
        if (!groupId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid get-info request' })
          };
        }
        
        const group = await groups.get(groupId);
        if (!group) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Group not found' })
          };
        }
        
        return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ group })
        };
      }
      
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (error) {
    console.error('Group operation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};
