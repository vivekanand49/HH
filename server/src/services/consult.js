// Video consult signaling over Socket.io. Media flows directly between the
// two phones (WebRTC); the server only introduces them, relays connection
// details, and translates captions.
import { one } from '../db/index.js';
import { config } from '../config.js';
import { translate } from './ai.js';
import { audit } from './audit.js';

// The patient (or a family member who manages their profile, e.g. a parent
// for a child), or the doctor the appointment is with, may join.
export async function consultAccess(appointmentId, user) {
  const a = await one(
    `SELECT a.id, a.patient_id, a.status, a.visit_type, d.user_id AS doctor_user_id, d.full_name AS doctor_name,
            p.full_name AS patient_name, p.language AS patient_language, du.language AS doctor_language
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users p ON p.id = a.patient_id
       LEFT JOIN users du ON du.id = d.user_id
      WHERE a.id = $1`,
    [appointmentId],
  );
  if (!a || a.status !== 'confirmed') return null;
  if (a.patient_id === user.id) return { ...a, role: 'patient' };
  if (await one(`SELECT 1 FROM family_links WHERE guardian_id = $1 AND member_id = $2`, [user.id, a.patient_id])) return { ...a, role: 'patient' };
  if (a.doctor_user_id && a.doctor_user_id === user.id) return { ...a, role: 'doctor' };
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerConsult(io, socket) {
  const user = socket.data.user;
  const joined = new Map(); // appointmentId -> access info
  let lastCaption = 0;

  socket.on('consult:join', async ({ appointmentId } = {}, ack = () => {}) => {
    if (!UUID.test(String(appointmentId))) return ack({ error: 'Invalid consult' });
    const access = await consultAccess(appointmentId, user);
    if (!access) return ack({ error: 'You cannot join this consultation.' });
    const room = `consult:${appointmentId}`;
    const peers = await io.in(room).fetchSockets();
    if (peers.some((s) => s.data.user.id !== user.id && s.data.consultRole === access.role)) return ack({ error: 'Someone else is already in this call.' });

    socket.data.consultRole = access.role;
    joined.set(appointmentId, access);
    await socket.join(room);
    await audit(user.id, 'join_consult', 'appointment', appointmentId, { role: access.role });

    const others = (await io.in(room).fetchSockets()).filter((s) => s.id !== socket.id);
    ack({
      role: access.role,
      iceServers: config.iceServers,
      peer: access.role === 'patient' ? access.doctor_name : access.patient_name,
      peerPresent: others.length > 0,
    });
    // Both sides present: tell everyone, the doctor then starts the call.
    if (others.length > 0) io.to(room).emit('consult:ready', { appointmentId });
  });

  socket.on('consult:signal', ({ appointmentId, data } = {}) => {
    if (!joined.has(appointmentId) || !data) return;
    socket.to(`consult:${appointmentId}`).emit('consult:signal', { data });
  });

  socket.on('consult:media', ({ appointmentId, video } = {}) => {
    if (!joined.has(appointmentId)) return;
    socket.to(`consult:${appointmentId}`).emit('consult:media', { video: Boolean(video) });
  });

  // A finished sentence from one side: send the original to both, then the
  // translation in the other person's language.
  socket.on('consult:caption', async ({ appointmentId, text } = {}) => {
    const access = joined.get(appointmentId);
    if (!access || typeof text !== 'string' || !text.trim()) return;
    // At most 2 captions a second per person: each one can cost a translation call.
    if (Date.now() - lastCaption < 500) return;
    lastCaption = Date.now();
    const room = `consult:${appointmentId}`;
    const clean = text.trim().slice(0, 500);
    const from = access.role === 'patient' ? access.patient_language : access.doctor_language || 'en';
    const to = access.role === 'patient' ? access.doctor_language || 'en' : access.patient_language;
    const id = `${socket.id}-${Date.now()}`;
    io.to(room).emit('consult:caption', { id, from: access.role, text: clean, lang: from });
    const translated = await translate(clean, from, to);
    if (translated) io.to(room).emit('consult:caption', { id, from: access.role, text: clean, lang: from, translated, translatedLang: to });
  });

  const leave = (appointmentId) => {
    if (!joined.delete(appointmentId)) return;
    socket.to(`consult:${appointmentId}`).emit('consult:peer-left');
    socket.leave(`consult:${appointmentId}`);
  };
  socket.on('consult:leave', ({ appointmentId } = {}) => leave(appointmentId));
  socket.on('disconnect', () => {
    for (const id of joined.keys()) socket.to(`consult:${id}`).emit('consult:peer-left');
  });
}
