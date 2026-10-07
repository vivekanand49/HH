import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { store, signOut, profileSwitched } from '../store';
import { cacheGet, cacheSet } from './offline';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status; // 0 = network problem
    this.body = body;
  }
}

// Auth header, plus the family member this phone is acting for (checked by the server).
// profileId overrides the one in use: null = the signed-in person.
function authHeaders(profileId) {
  const { token, profile } = store.getState().session;
  const pid = profileId === undefined ? profile?.id : profileId;
  return { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(token && pid ? { 'x-profile-id': pid } : {}) };
}

function checkAuth(res, data) {
  if (res.status === 401 && store.getState().session.token) store.dispatch(signOut());
  // No longer allowed to manage that family member: back to own profile.
  if (res.status === 403 && data.code === 'bad_profile') store.dispatch(profileSwitched(null));
}

export async function api(path, { method = 'GET', body, timeout = 15000, profileId } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...authHeaders(profileId) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    checkAuth(res, data);
    if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.name === 'AbortError' ? 'The network is too slow right now.' : 'No internet connection.', 0);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET with an offline fallback: fresh data when online, the last saved copy
 * (flagged `stale`) when not. Cache keys include the user (or family member) id.
 */
export function useCachedApi(path) {
  const userId = useSelector((s) => s.session.profile?.id ?? s.session.user?.id ?? 'anon');
  const key = `${userId}:${path}`;
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: null, stale: false, savedAt: null });

  const load = useCallback(async () => {
    if (!path) return;
    const cached = await cacheGet(key);
    if (cached) setState({ data: cached.value, loading: true, error: null, stale: true, savedAt: cached.savedAt });
    try {
      const data = await api(path);
      await cacheSet(key, data);
      setState({ data, loading: false, error: null, stale: false, savedAt: Date.now() });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: s.data && error.status === 0 ? null : error }));
    }
  }, [path, key]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

// Upload a file as the raw request body (no multipart: smaller and simpler on 2G).
export async function apiUpload(path, blob, { timeout = 120000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'content-type': blob.type, ...authHeaders() },
      body: blob,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    checkAuth(res, data);
    if (!res.ok) throw new ApiError(data.error || `Upload failed (${res.status})`, res.status, data);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.name === 'AbortError' ? 'The upload took too long. Try again on a better network.' : 'No internet connection.', 0);
  } finally {
    clearTimeout(timer);
  }
}

// POST JSON and get a file back (e.g. spoken audio).
export async function apiBlob(path, body, { timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      checkAuth(res, data);
      throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
    }
    return await res.blob();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.name === 'AbortError' ? 'The network is too slow right now.' : 'No internet connection.', 0);
  } finally {
    clearTimeout(timer);
  }
}

// Files need the sign-in token, so <img src> can't load them directly.
// Returns a URL the page can open: a local blob URL, or a short-lived S3 link.
export async function fileUrl(fileId) {
  const res = await fetch(`/api/files/${fileId}`, { headers: authHeaders() });
  if (!res.ok) throw new ApiError('Could not open the file.', res.status);
  if ((res.headers.get('content-type') || '').includes('application/json')) return (await res.json()).url;
  return URL.createObjectURL(await res.blob());
}
