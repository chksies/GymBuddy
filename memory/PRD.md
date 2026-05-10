# GymBuddy - Product Requirements Document

## Overview
GymBuddy is a social fitness accountability app inspired by Locket and Snapchat, designed specifically for gym-goers. The app helps friends stay accountable to their fitness goals by sharing gym check-in photos and maintaining streaks.

## Core Features

### 1. Authentication (JWT-based)
- Email/password registration and login
- Secure token storage (SecureStore on mobile, AsyncStorage on web)
- Auto-generated unique 6-character friend codes

### 2. Gym Check-In Posts
- Camera integration for taking gym photos
- Gallery picker for selecting existing photos
- Images stored in base64 format
- Optional captions for posts
- Real-time feed of friends' check-ins

### 3. Friend System
- **Add by Friend Code**: Enter 6-character alphanumeric code
- **Search by Username**: Find users by their username
- **QR Code**: Share your code visually (planned feature)
- Friend request flow (send/accept/decline)
- Remove friends functionality

### 4. Streak System
- Streaks start when BOTH friends post on the same day
- Streaks continue as long as both post within 3 days
- Visual indicators showing:
  - Current streak count
  - Days remaining before streak expires
  - Who posted today (you vs friend)

### 5. Workout Sharing
- **Quick Tips**: Text-based workout advice and tips
- **Structured Routines**: 
  - Exercise name
  - Sets and reps
  - Weight
  - Notes
- Feed of friends' shared workouts

### 6. Profile Management
- Profile photo upload
- View friend code
- Settings menu (Notifications, Privacy, Help)
- Logout functionality

## Technical Architecture

### Backend (FastAPI + MongoDB)
- **Database Collections**: users, posts, friendships, workouts
- **Authentication**: JWT tokens with 7-day expiration
- **API Prefix**: All routes under `/api/`

### Frontend (Expo React Native)
- **Navigation**: Tab-based with 6 tabs
- **State Management**: React Context for auth
- **Storage**: Platform-aware (SecureStore/AsyncStorage)
- **Camera**: expo-camera for photos

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile

### Posts
- `POST /api/posts` - Create gym check-in
- `GET /api/posts/feed` - Get friends' posts
- `GET /api/posts/my` - Get own posts

### Friends
- `POST /api/friends/request` - Send friend request
- `GET /api/friends/search/{query}` - Search users
- `GET /api/friends` - List friends
- `GET /api/friends/requests` - Get pending requests
- `POST /api/friends/accept/{id}` - Accept request
- `POST /api/friends/decline/{id}` - Decline request
- `DELETE /api/friends/{id}` - Remove friend

### Streaks
- `GET /api/streaks` - Get all streaks with friends

### Workouts
- `POST /api/workouts` - Share workout
- `GET /api/workouts/feed` - Get friends' workouts
- `GET /api/workouts/my` - Get own workouts
- `DELETE /api/workouts/{id}` - Delete workout

## Future Enhancements
- Push notifications for friend posts and streak warnings
- QR code scanning for adding friends
- Workout templates library
- Progress tracking with stats
- Direct messaging between friends
