import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { statsApi, getErrorMessage } from '../../src/services/api';
import { useDialog } from '../../src/components/DialogProvider';
import ErrorState from '../../src/components/ErrorState';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Stats {
  total_checkins: number;
  week_checkins: number;
  month_checkins: number;
  active_streaks: number;
  best_streak: number;
  total_streak_days: number;
  consistency_percentage: number;
  friends_count: number;
  checkins_by_day: Array<{ day: string; count: number }>;
  weekly_history: Array<{ week: string; checkins: number }>;
  member_since: string;
}

export default function StatsScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const dialog = useDialog();

  const loadStats = async () => {
    try {
      const response = await statsApi.getStats();
      setStats(response.data);
      setLoadError(null);
    } catch (error) {
      console.log('Error loading stats:', error);
      const message = getErrorMessage(error, "Couldn't load your stats.");
      setLoadError(message);
      // Without stats on screen the error state says it all; otherwise keep the old numbers
      if (stats) dialog.toast(message, 'error');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadStats();
  };

  const retry = () => {
    setIsLoading(true);
    loadStats();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  };

  const getMaxBarValue = (data: Array<{ count?: number; checkins?: number }>) => {
    const values = data.map(d => d.count || d.checkins || 0);
    return Math.max(...values, 1);
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  if (!stats) {
    return <ErrorState message={loadError ?? "Couldn't load your stats."} onRetry={retry} />;
  }

  const maxDayCount = getMaxBarValue(stats.checkins_by_day);
  const maxWeekCount = getMaxBarValue(stats.weekly_history);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Ionicons name="stats-chart" size={28} color="#FF6B35" />
        <Text style={styles.headerTitle}>Progress</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FF6B35"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Summary Cards */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Ionicons name="fitness" size={24} color="#FF6B35" />
            <Text style={styles.summaryValue}>{stats.total_checkins}</Text>
            <Text style={styles.summaryLabel}>Total Check-ins</Text>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="flame" size={24} color="#FF6B35" />
            <Text style={styles.summaryValue}>{stats.best_streak}</Text>
            <Text style={styles.summaryLabel}>Best Streak</Text>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Ionicons name="calendar" size={24} color="#FF6B35" />
            <Text style={styles.summaryValue}>{stats.week_checkins}</Text>
            <Text style={styles.summaryLabel}>This Week</Text>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="trending-up" size={24} color="#FF6B35" />
            <Text style={styles.summaryValue}>{stats.consistency_percentage}%</Text>
            <Text style={styles.summaryLabel}>Consistency</Text>
          </View>
        </View>

        {/* Active Streaks */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current Status</Text>
          <View style={styles.statusCard}>
            <View style={styles.statusItem}>
              <View style={styles.statusIcon}>
                <Ionicons name="flame" size={20} color="#FF6B35" />
              </View>
              <View>
                <Text style={styles.statusValue}>{stats.active_streaks}</Text>
                <Text style={styles.statusLabel}>Active Streaks</Text>
              </View>
            </View>
            <View style={styles.statusDivider} />
            <View style={styles.statusItem}>
              <View style={styles.statusIcon}>
                <Ionicons name="people" size={20} color="#FF6B35" />
              </View>
              <View>
                <Text style={styles.statusValue}>{stats.friends_count}</Text>
                <Text style={styles.statusLabel}>Gym Buddies</Text>
              </View>
            </View>
            <View style={styles.statusDivider} />
            <View style={styles.statusItem}>
              <View style={styles.statusIcon}>
                <Ionicons name="calendar-outline" size={20} color="#FF6B35" />
              </View>
              <View>
                <Text style={styles.statusValue}>{stats.month_checkins}</Text>
                <Text style={styles.statusLabel}>This Month</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Check-ins by Day */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Check-ins by Day</Text>
          <View style={styles.chartCard}>
            <View style={styles.barChart}>
              {stats.checkins_by_day.map((item, index) => (
                <View key={index} style={styles.barContainer}>
                  <View style={styles.barWrapper}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: `${(item.count / maxDayCount) * 100}%`,
                          backgroundColor: item.count > 0 ? '#FF6B35' : '#2a2a2a',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.barLabel}>{item.day}</Text>
                  <Text style={styles.barValue}>{item.count}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Weekly History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weekly History</Text>
          <View style={styles.chartCard}>
            <View style={styles.weeklyChart}>
              {stats.weekly_history.map((item, index) => (
                <View key={index} style={styles.weekItem}>
                  <View style={styles.weekBarWrapper}>
                    <View
                      style={[
                        styles.weekBar,
                        {
                          width: `${(item.checkins / maxWeekCount) * 100}%`,
                          backgroundColor: item.checkins > 0 ? '#FF6B35' : '#2a2a2a',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.weekLabel}>{item.week}</Text>
                  <Text style={styles.weekValue}>{item.checkins}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Member Since */}
        <View style={styles.memberSince}>
          <Ionicons name="time-outline" size={16} color="#666" />
          <Text style={styles.memberSinceText}>
            Member since {formatDate(stats.member_since)}
          </Text>
        </View>
      </ScrollView>
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
  errorText: {
    color: '#666',
    fontSize: 16,
    marginTop: 16,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  summaryValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 8,
  },
  summaryLabel: {
    color: '#888',
    fontSize: 13,
    marginTop: 4,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  statusCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 107, 53, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  statusValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  statusLabel: {
    color: '#888',
    fontSize: 11,
  },
  statusDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#2a2a2a',
    marginHorizontal: 8,
  },
  chartCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
  },
  barChart: {
    flexDirection: 'row',
    height: 150,
    alignItems: 'flex-end',
  },
  barContainer: {
    flex: 1,
    alignItems: 'center',
  },
  barWrapper: {
    width: 24,
    height: 100,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 12,
    minHeight: 4,
  },
  barLabel: {
    color: '#888',
    fontSize: 11,
    marginTop: 8,
  },
  barValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  weeklyChart: {
    gap: 8,
  },
  weekItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weekLabel: {
    color: '#888',
    fontSize: 12,
    width: 50,
  },
  weekBarWrapper: {
    flex: 1,
    height: 20,
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  weekBar: {
    height: '100%',
    borderRadius: 10,
    minWidth: 4,
  },
  weekValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    width: 24,
    textAlign: 'right',
  },
  memberSince: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  memberSinceText: {
    color: '#666',
    fontSize: 13,
    marginLeft: 6,
  },
});
