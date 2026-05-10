import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { streaksApi } from '../../src/services/api';

interface Streak {
  friendship_id: string;
  friend_id: string;
  friend_username: string;
  friend_profile_pic: string | null;
  streak_count: number;
  streak_active: boolean;
  days_remaining: number;
  user_posted_today: boolean;
  friend_posted_today: boolean;
  last_mutual_post: string | null;
}

export default function StreaksScreen() {
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const loadStreaks = async () => {
    try {
      const response = await streaksApi.getStreaks();
      setStreaks(response.data);
    } catch (error) {
      console.log('Error loading streaks:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadStreaks();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadStreaks();
  };

  const renderStreak = ({ item }: { item: Streak }) => (
    <View style={styles.streakCard}>
      <View style={styles.cardHeader}>
        {item.friend_profile_pic ? (
          <Image source={{ uri: item.friend_profile_pic }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Ionicons name="person" size={24} color="#888" />
          </View>
        )}
        <View style={styles.userInfo}>
          <Text style={styles.username}>@{item.friend_username}</Text>
          <View style={styles.statusRow}>
            {item.streak_active ? (
              <View style={styles.activeBadge}>
                <Ionicons name="flame" size={14} color="#FF6B35" />
                <Text style={styles.activeBadgeText}>
                  {item.days_remaining} day{item.days_remaining !== 1 ? 's' : ''} remaining
                </Text>
              </View>
            ) : (
              <Text style={styles.inactiveText}>No active streak</Text>
            )}
          </View>
        </View>
        <View style={styles.streakCount}>
          <Ionicons name="flame" size={28} color={item.streak_count > 0 ? '#FF6B35' : '#444'} />
          <Text style={[styles.countText, item.streak_count > 0 && styles.activeCount]}>
            {item.streak_count}
          </Text>
        </View>
      </View>

      <View style={styles.todayStatus}>
        <View style={styles.statusItem}>
          <View style={[styles.statusDot, item.user_posted_today && styles.statusDotActive]} />
          <Text style={styles.statusLabel}>You</Text>
          <Text style={styles.statusValue}>
            {item.user_posted_today ? 'Checked in' : 'Not yet'}
          </Text>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusItem}>
          <View style={[styles.statusDot, item.friend_posted_today && styles.statusDotActive]} />
          <Text style={styles.statusLabel}>{item.friend_username}</Text>
          <Text style={styles.statusValue}>
            {item.friend_posted_today ? 'Checked in' : 'Not yet'}
          </Text>
        </View>
      </View>

      {item.user_posted_today && item.friend_posted_today && (
        <View style={styles.bothCheckedIn}>
          <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
          <Text style={styles.bothCheckedInText}>You both posted today! Streak maintained!</Text>
        </View>
      )}
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Ionicons name="flame" size={28} color="#FF6B35" />
        <Text style={styles.headerTitle}>Streaks</Text>
      </View>

      {streaks.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="flame-outline" size={64} color="#444" />
          <Text style={styles.emptyTitle}>No streaks yet</Text>
          <Text style={styles.emptySubtitle}>
            Add friends and start posting gym check-ins together to build streaks!
          </Text>
        </View>
      ) : (
        <FlatList
          data={streaks}
          renderItem={renderStreak}
          keyExtractor={(item) => item.friendship_id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FF6B35"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 10,
  },
  listContent: {
    padding: 16,
  },
  streakCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  username: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 53, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  activeBadgeText: {
    color: '#FF6B35',
    fontSize: 12,
    marginLeft: 4,
  },
  inactiveText: {
    color: '#666',
    fontSize: 12,
  },
  streakCount: {
    alignItems: 'center',
  },
  countText: {
    color: '#444',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 2,
  },
  activeCount: {
    color: '#FF6B35',
  },
  todayStatus: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 12,
  },
  statusItem: {
    flex: 1,
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#444',
    marginBottom: 4,
  },
  statusDotActive: {
    backgroundColor: '#4CAF50',
  },
  statusLabel: {
    color: '#888',
    fontSize: 12,
  },
  statusValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  statusDivider: {
    width: 1,
    backgroundColor: '#2a2a2a',
    marginHorizontal: 12,
  },
  bothCheckedIn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  bothCheckedInText: {
    color: '#4CAF50',
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtitle: {
    color: '#666',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
});
