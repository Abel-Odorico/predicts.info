import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuth = create(
  persist(
    (set) => ({
      user:  null,
      token: null,
      login:  (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
    }),
    { name: 'copa-auth', version: 1 }
  )
);
