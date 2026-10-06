import { configureStore, createSlice } from '@reduxjs/toolkit';

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — the session just won't persist */
  }
}

// profile: the family member this phone is acting for (null = the signed-in person).
// family: people this account manages, kept so switching works offline too.
const session = createSlice({
  name: 'session',
  initialState: { token: load('token'), user: load('user'), profile: load('profile'), family: load('family') ?? [] },
  reducers: {
    signedIn(state, { payload }) {
      state.token = payload.token;
      state.user = payload.user;
      state.profile = null;
      state.family = [];
    },
    userUpdated(state, { payload }) {
      state.user = payload;
    },
    familyLoaded(state, { payload }) {
      state.family = payload;
      // Removed from the family (or they removed us): stop acting for them.
      if (state.profile) state.profile = payload.find((m) => m.id === state.profile.id) ?? null;
    },
    profileSwitched(state, { payload }) {
      state.profile = payload && payload.id !== state.user?.id ? payload : null;
    },
    // Details of the profile in use were edited.
    activeUpdated(state, { payload }) {
      if (state.profile && payload.id === state.profile.id) {
        state.profile = { ...state.profile, ...payload };
        state.family = state.family.map((m) => (m.id === payload.id ? { ...m, ...payload } : m));
      } else state.user = payload;
    },
    signOut(state) {
      state.token = null;
      state.user = null;
      state.profile = null;
      state.family = [];
    },
  },
});

const network = createSlice({
  name: 'network',
  initialState: { online: typeof navigator === 'undefined' ? true : navigator.onLine },
  reducers: {
    setOnline(state, { payload }) {
      state.online = payload;
    },
  },
});

export const { signedIn, userUpdated, familyLoaded, profileSwitched, activeUpdated, signOut } = session.actions;
export const { setOnline } = network.actions;

export const store = configureStore({
  reducer: { session: session.reducer, network: network.reducer },
});

store.subscribe(() => {
  const { token, user, profile, family } = store.getState().session;
  save('token', token);
  save('user', user);
  save('profile', profile);
  save('family', family.length ? family : null);
});

// The person the patient pages are about: a family member, or the signed-in person.
export const selectActive = (s) => s.session.profile ?? s.session.user;

export const STAFF_ROLES = ['hospital_staff', 'doctor', 'dispatcher', 'admin'];
export const ADMIN_ROLES = ['hospital_admin', 'admin'];
