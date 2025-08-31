const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method not allowed'
    };
  }

  try {
    const { userId } = JSON.parse(event.body);
    
    if (!userId) {
      return {
        statusCode: 400,
        body: 'Missing userId'
      };
    }
    
    const keys = getStore("keys");
    const userKeys = await keys.get(userId);
    
    if (!userKeys) {
      return {
        statusCode: 404,
        body: 'User not found'
      };
    }
    
    let preKey = null;
    if (userKeys.preKeys && userKeys.preKeys.length > 0) {
      preKey = userKeys.preKeys.shift();
      await keys.set(userId, userKeys);
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        identityKey: userKeys.identityKey,
        signedPreKey: userKeys.signedPreKey,
        preKey: preKey
      })
    };
  } catch (error) {
    console.error('Get keys error:', error);
    return {
      statusCode: 500,
      body: 'Internal server error'
    };
  }
};
