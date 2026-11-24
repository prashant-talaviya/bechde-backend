import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { WebSocket, WebSocketServer } from 'ws';
import User from '../models/User';

const changes = new EventEmitter();
export function notifyUnreadChanged(userId: string) { changes.emit('unread', userId); }

export function attachChatEvents(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, handleProtocols: protocols => protocols.has('bechde.events') ? 'bechde.events' : false });
  const clients = new Map<string, Set<WebSocket>>();
  const alive = new WeakSet<WebSocket>();
  const notify = (userId: string) => {
    for (const client of clients.get(userId) || []) {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'unread.changed' }));
    }
  };
  changes.on('unread', notify);
  server.on('upgrade', async (request, socket, head) => {
    socket.on('error', () => {});
    if (request.url?.split('?')[0] !== '/api/events') { socket.destroy(); return; }
    try {
      // Credentials travel in the upgrade header, never the request URL/access log.
      const protocols = request.headers['sec-websocket-protocol']?.split(',').map(value => value.trim()) || [];
      const token = protocols.find(value => value.startsWith('auth.'))?.slice(5);
      if (!token || !protocols.includes('bechde.events') || !process.env.JWT_SECRET) throw new Error('Unauthorized');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (typeof decoded === 'string' || decoded.purpose !== 'access' || typeof decoded.userId !== 'string' || !mongoose.isValidObjectId(decoded.userId) || typeof decoded.exp !== 'number') throw new Error('Unauthorized');
      const user = await User.findById(decoded.userId).select('_id accountStatus').maxTimeMS(5000).lean();
      if (!user || user.accountStatus !== 'active' || socket.destroyed) throw new Error('Unauthorized');
      const userId = String(user._id);
      const expiresIn = decoded.exp * 1000 - Date.now();
      if (expiresIn <= 0) throw new Error('Unauthorized');
      wss.handleUpgrade(request, socket, head, client => {
        const group = clients.get(userId) || new Set<WebSocket>();
        group.add(client); clients.set(userId, group); alive.add(client);
        const expiry = setTimeout(() => client.close(4001, 'Session expired'), Math.min(expiresIn, 2147483647));
        expiry.unref();
        client.on('pong', () => alive.add(client));
        client.on('error', () => {});
        client.on('close', () => { clearTimeout(expiry); group.delete(client); if (!group.size) clients.delete(userId); });
        client.send(JSON.stringify({ type: 'ready' }));
      });
    } catch {
      if (!socket.destroyed) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); }
    }
  });
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!alive.has(client)) { client.terminate(); continue; }
      alive.delete(client); client.ping();
    }
  }, 30000);
  heartbeat.unref();
  server.once('close', () => { clearInterval(heartbeat); changes.off('unread', notify); for (const client of wss.clients) client.terminate(); wss.close(); });
  return wss;
}
