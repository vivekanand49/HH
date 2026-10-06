// Holds the Socket.io server so services can push events without importing app code.
// Rooms: user:<id> (a patient's own alerts), hospital:<id> (staff), dispatch (108 / admins).
let io = null;

export function setIo(server) {
  io = server;
}

export function emit(rooms, event, payload) {
  if (!io) return;
  for (const room of [].concat(rooms).filter(Boolean)) io.to(room).emit(event, payload);
}
