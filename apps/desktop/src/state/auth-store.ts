import { create } from 'zustand';
import type { AuthUser } from '@attendance/shared';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  setUser: (user: AuthUser) => void;
  setUnauthenticated: () => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  setUser: (user) => set({ user, status: 'authenticated' }),
  setUnauthenticated: () => set({ user: null, status: 'unauthenticated' }),
  clear: () => set({ user: null, status: 'unauthenticated' }),
}));
