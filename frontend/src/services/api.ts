//gotta research on axios man, ai wrote ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Platform-aware storage helper
const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem('auth_token');
  }
  return SecureStore.getItemAsync('auth_token');
};

const api = axios.create({
  baseURL: `${API_URL}/api`,
});

// Add auth token to requests
api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Posts API
export const postsApi = {
  createPost: (image: string, caption: string) => 
    api.post('/posts', { image, caption }),
  getFeed: () => api.get('/posts/feed'),
  getMyPosts: () => api.get('/posts/my'),
};

// Friends API
export const friendsApi = {
  sendRequest: (friend_code: string) => 
    api.post('/friends/request', { friend_code }),
  searchUsers: (query: string) => 
    api.get(`/friends/search/${query}`),
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
    api.put('/auth/profile', data),
};

// Stats API
export const statsApi = {
  getStats: () => api.get('/stats'),
};

// Notifications API
export const notificationsApi = {
  registerToken: (push_token: string) => 
    api.post('/notifications/register', { push_token }),
  unregisterToken: () => api.delete('/notifications/unregister'),
  getSettings: () => api.get('/notifications/settings'),
  updateSettings: (settings: {
    friend_posts?: boolean;
    streak_warnings?: boolean;
    friend_requests?: boolean;
  }) => api.put('/notifications/settings', settings),
};

export default api;
