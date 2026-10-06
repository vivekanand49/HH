import { io } from 'socket.io-client';
import { store } from '../store';

let socket = null;
let socketToken = null;

// One live connection per signed-in user (alert updates, staff queue).
export function getSocket() {
  const { token } = store.getState().session;
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  socketToken = token;
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}
