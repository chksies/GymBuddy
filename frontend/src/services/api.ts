//gotta research on axios man, ai wrote ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const API_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000').replace(/\/+$/, '');

const TOKEN_KEY = 'auth_token';

// Platform-aware token storage (SecureStore isn't available on web)
export const tokenStorage = {
  get: (): Promise<string | null> =>
    Platform.OS === 'web' ? AsyncStorage.getItem(TOKEN_KEY) : SecureStore.getItemAsync(TOKEN_KEY),
  set: (token: string): Promise<void> =>
    Platform.OS === 'web' ? AsyncStorage.setItem(TOKEN_KEY, token) : SecureStore.setItemAsync(TOKEN_KEY, token),
  remove: (): Promise<void> =>
    Platform.OS === 'web' ? AsyncStorage.removeItem(TOKEN_KEY) : SecureStore.deleteItemAsync(TOKEN_KEY),
};

// Called when a request made with a saved login comes back 401 (e.g. the login expired).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

// The backend stores photos it keeps itself as relative "/api/media/..." paths so they keep working
// from any host. Resolve them against the API we're actually talking to.
const MEDIA_KEYS = new Set(['image', 'profile_pic', 'friend_profile_pic', 'requester_profile_pic']);

function resolveMediaUrls(value: any, key?: string): any {
  if (typeof value === 'string') {
    return key && MEDIA_KEYS.has(key) && value.startsWith('/api/media/') ? `${API_URL}${value}` : value;
  }
  if (Array.isArray(value)) return value.map((item) => resolveMediaUrls(item, key));
  if (value && typeof value === 'object') {
    const resolved: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) resolved[k] = resolveMediaUrls(v, k);
    return resolved;
  }
  return value;
}

/** A message that is safe to show the user for any failed request. */
export function getErrorMessage(error: any, fallback: string): string {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  // Validation errors (422) come back as a list of { msg } objects
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0]?.msg;
    if (typeof first === 'string') return first.replace(/^Value error, /, '');
  }
  if (error?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (!error?.response) {
    return "Can't reach the server. Check your connection and that the backend is running.";
  }
  return fallback;
}

const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 20000,
});

// Add auth token to requests
api.interceptors.request.use(async (config) => {
  const isAuthRequest = config.url?.startsWith('/auth/login') || config.url?.startsWith('/auth/register');
  if (!isAuthRequest) {
    const token = await tokenStorage.get();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    response.data = resolveMediaUrls(response.data);
    return response;
  },
  (error) => {
    if (error?.response?.status === 401 && error.config?.headers?.Authorization) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  register: (email: string, password: string, username: string) =>
    api.post('/auth/register', { email, password, username }),
  me: () => api.get('/auth/me'),
};

// Posts API
export const postsApi = {
  // Photos can be large, so uploading gets more time than a normal request
  createPost: (image: string, caption: string) =>
    api.post('/posts', { image, caption }, { timeout: 60000 }),
  getFeed: () => api.get('/posts/feed'),
  getMyPosts: () => api.get('/posts/my'),
  react: (postId: string, emoji: string) =>
    api.post(`/posts/${postId}/react`, { emoji }),
  removeReaction: (postId: string) =>
    api.delete(`/posts/${postId}/react`),
  deletePost: (postId: string) => api.delete(`/posts/${postId}`),
};

// Friends API
export const friendsApi = {
  sendRequest: (friend_code: string) =>
    api.post('/friends/request', { friend_code }),
  searchUsers: (query: string) =>
    api.get(`/friends/search/${encodeURIComponent(query)}`),
  getFriends: () => api.get('/friends'),
  getRequests: () => api.get('/friends/requests'),
  acceptRequest: (friendship_id: string) =>
    api.post(`/friends/accept/${friendship_id}`),
  declineRequest: (friendship_id: string) =>
    api.post(`/friends/decline/${friendship_id}`),
  removeFriend: (friend_id: string) =>
    api.delete(`/friends/${friend_id}`),
};

// Streaks API
export const streaksApi = {
  getStreaks: () => api.get('/streaks'),
};

// Workouts API
export const workoutsApi = {
  createWorkout: (data: {
    workout_type: string;
    title: string;
    description?: string;
    exercises?: Array<{
      name: string;
      sets?: number;
      reps?: string;
      weight?: string;
      notes?: string;
    }>;
  }) => api.post('/workouts', data),
  getFeed: () => api.get('/workouts/feed'),
  getMyWorkouts: () => api.get('/workouts/my'),
  deleteWorkout: (workout_id: string) =>
    api.delete(`/workouts/${workout_id}`),
};

// Profile API
export const profileApi = {
  updateProfile: (data: { username?: string; profile_pic?: string }) =>
    api.put('/auth/profile', data, { timeout: 60000 }),
};

// Stats API
export const statsApi = {
  getStats: () => api.get('/stats'),
};

// Notifications API
export const notificationsApi = {
  registerToken: (push_token: string) =>
    api.post('/notifications/register', { push_token }),
  // Short timeout: this runs during logout, which must never hang when offline
  unregisterToken: () => api.delete('/notifications/unregister', { timeout: 3000 }),
  getSettings: () => api.get('/notifications/settings'),
  updateSettings: (settings: {
    friend_posts?: boolean;
    streak_warnings?: boolean;
    friend_requests?: boolean;
  }) => api.put('/notifications/settings', settings),
};

export default api;
