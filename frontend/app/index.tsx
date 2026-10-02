import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import ErrorState from '../src/components/ErrorState';

export default function Index() {
  const { user, isLoading, serverUnreachable, retryConnection } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !serverUnreachable) {
      if (user) {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/login');
      }
    }
  }, [isLoading, user, serverUnreachable]);

  // Stay signed in and offer a retry instead of bouncing to the login screen
  if (!isLoading && serverUnreachable) {
    return (
      <ErrorState
        title="Can't reach the server"
        message="You're still signed in, but GymBuddy couldn't connect. Check that the backend and MongoDB are running, then try again."
        onRetry={retryConnection}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#FF6B35" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
