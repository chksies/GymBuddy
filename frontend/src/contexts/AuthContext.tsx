//used react here to store info of user
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi, notificationsApi, setUnauthorizedHandler, tokenStorage } from '../services/api';

interface User {
  id: string;
  email: string;
  username: string;
  friend_code: string;
  profile_pic: string | null;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /** A saved login exists but the server couldn't be reached, so we couldn't confirm it. */
  serverUnreachable: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
  retryConnection: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [serverUnreachable, setServerUnreachable] = useState(false);

  const clearSession = useCallback(async () => {
    try {
      await tokenStorage.remove();
    } catch (e) {
      // Nothing more we can do if storage fails
    }
    setToken(null);
    setUser(null);
  }, []);

  const loadStoredAuth = useCallback(async () => {
    setIsLoading(true);
    setServerUnreachable(false);
    try {
      const storedToken = await tokenStorage.get();
      if (!storedToken) return;
      setToken(storedToken);

      // Only a 401 means the saved login is bad. A flaky connection or a backend that is still
      // starting up must never log the user out, so retry a few times before giving up.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await authApi.me();
          setUser(response.data);
          return;
        } catch (error: any) {
          if (error?.response?.status === 401) {
            await clearSession();
            return;
          }
          if (attempt < 2) await sleep(1500);
        }
      }
      // Keep the saved login: it's probably still valid and we just couldn't reach the server
      setServerUnreachable(true);
    } finally {
      setIsLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    // If any request later finds the login has expired, go back to the sign-in screen
    setUnauthorizedHandler(() => {
      clearSession();
    });
    loadStoredAuth();
    return () => setUnauthorizedHandler(null);
  }, [clearSession, loadStoredAuth]);

  const startSession = async (newToken: string, userData: User) => {
    await tokenStorage.set(newToken);
    setToken(newToken);
    setUser(userData);
    setServerUnreachable(false);
  };

  const login = async (email: string, password: string) => {
    const response = await authApi.login(email.trim(), password);
    await startSession(response.data.token, response.data.user);
  };

  const register = async (email: string, password: string, username: string) => {
    const response = await authApi.register(email.trim(), password, username.trim());
    await startSession(response.data.token, response.data.user);
  };

  const logout = async () => {
    // Stop this account's push notifications from reaching a device someone else may sign in on
    try {
      await notificationsApi.unregisterToken();
    } catch (e) {
      // Offline or already signed out - logging out must still work
    }
    await clearSession();
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, serverUnreachable, login, register, logout, updateUser, retryConnection: loadStoredAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
