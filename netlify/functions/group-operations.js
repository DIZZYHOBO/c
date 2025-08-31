// netlify/functions/group-operations.js
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const { action, groupId, userId, members, metadata } = await req.json();
  const groups = getStore("groups");
  
  switch(action) {
    case 'create':
      const newGroupId = crypto.randomUUID();
      await groups.set(newGroupId, {
        id: newGroupId,
        creator: userId,
        members: [userId, ...members],
        encryptedMetadata: metadata, // Name, avatar etc encrypted
        created: Date.now()
      });
      return Response.json({ groupId: newGroupId });
      
    case 'add-members':
      const group = await groups.get(groupId);
      group.members.push(...members);
      await groups.set(groupId, group);
      return Response.json({ success: true });
      
    case 'leave':
      const grp = await groups.get(groupId);
      grp.members = grp.members.filter(m => m !== userId);
      await groups.set(groupId, grp);
      return Response.json({ success: true });
  }
};
