import test from 'node:test';
import assert from 'node:assert/strict';
import { listConversations, setConversationImportant } from '../src/controllers/conversation.controller';
import Conversation from '../src/models/Conversation';
import Message from '../src/models/Message';
import Listing from '../src/models/Listing';

const actor = '507f1f77bcf86cd799439011';
const chatId = '507f1f77bcf86cd799439012';
function response() { return { body: null as any, json(body: unknown) { this.body = body; return this; } }; }
function chain(data: unknown) {
  const query: any = {};
  for (const method of ['select', 'sort', 'skip', 'limit', 'populate']) query[method] = () => query;
  query.lean = async () => data;
  return query;
}

test('inbox filters apply before pagination, scope membership, and hide other users flags', async () => {
  const originals = { find: Conversation.find, count: Conversation.countDocuments, listings: Listing.find, distinct: Message.distinct };
  let query: any;
  (Conversation as any).find = (filter: any) => { query = filter; return chain([{ _id: chatId, kind: 'listing', targetId: chatId, importantBy: [actor] }]); };
  (Conversation as any).countDocuments = async () => 21;
  (Listing as any).find = () => chain([{ _id: chatId, coverImage: 'photo.jpg' }]);
  (Message as any).distinct = async (_field: string, filter: any) => { assert.equal(filter.senderId.$ne, actor); assert.equal(filter.readAt, null); return [chatId]; };
  try {
    for (const filter of ['all', 'buying', 'selling', 'important', 'unread']) {
      const res = response();
      await listConversations({ userId: actor, query: { filter, page: '2' } } as any, res as any);
      assert.equal(query.participants, actor);
      if (filter === 'buying') assert.equal(query.initiatorId, actor);
      if (filter === 'selling') assert.equal(query.ownerId, actor);
      if (filter === 'important') assert.equal(query.importantBy, actor);
      if (filter === 'unread') assert.deepEqual(query._id, { $in: [chatId] });
      assert.equal(res.body.pages, 2);
      assert.equal(res.body.data[0].important, true);
      assert.equal(res.body.data[0].importantBy, undefined);
      assert.equal(res.body.data[0].coverImage, 'photo.jpg');
    }
  } finally { Conversation.find = originals.find; Conversation.countDocuments = originals.count; Listing.find = originals.listings; Message.distinct = originals.distinct; }
});

test('important updates are membership scoped and change only the current users flag', async () => {
  const original = Conversation.findOneAndUpdate;
  let captured: any;
  (Conversation as any).findOneAndUpdate = (filter: unknown, update: unknown) => { captured = { filter, update }; return { select: async () => ({ _id: chatId }) }; };
  try {
    for (const important of [true, false]) {
      const res = response();
      await setConversationImportant({ userId: actor, params: { conversationId: chatId }, body: { important, userId: 'someone-else' } } as any, res as any);
      assert.equal(captured.filter.participants, actor);
      assert.equal(String(captured.update[important ? '$addToSet' : '$pull'].importantBy), actor);
      assert.equal(res.body.important, important);
    }
    await assert.rejects(() => setConversationImportant({ userId: actor, body: { important: 'yes' } } as any, response() as any), /whether/);
    (Conversation as any).findOneAndUpdate = () => ({ select: async () => null });
    await assert.rejects(() => setConversationImportant({ userId: actor, params: { conversationId: chatId }, body: { important: true } } as any, response() as any), /not found/);
  } finally { Conversation.findOneAndUpdate = original; }
});
