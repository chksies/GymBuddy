import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { friendsApi } from '../../src/services/api';
import { useAuth } from '../../src/contexts/AuthContext';

interface Friend {
  id: string;
  friend_id: string;
  friend_username: string;
  friend_profile_pic: string | null;
  status: string;
  streak_count: number;
}

interface FriendRequest {
  id: string;
  requester_id: string;
  requester_username: string;
  requester_profile_pic: string | null;
  created_at: string;
}

interface SearchResult {
  id: string;
  username: string;
  friend_code: string;
  profile_pic: string | null;
  friendship_status: string;
}

export default function FriendsScreen() {
  const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'add'>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [friendCode, setFriendCode] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const loadFriends = async () => {
    try {
      const response = await friendsApi.getFriends();
      setFriends(response.data);
    } catch (error) {
      console.log('Error loading friends:', error);
    }
  };

  const loadRequests = async () => {
    try {
      const response = await friendsApi.getRequests();
      setRequests(response.data);
    } catch (error) {
      console.log('Error loading requests:', error);
    }
  };

  const loadData = async () => {
    await Promise.all([loadFriends(), loadRequests()]);
    setIsLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const response = await friendsApi.searchUsers(searchQuery.trim());
      setSearchResults(response.data);
    } catch (error) {
      console.log('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddFriend = async (code: string) => {
    if (!code.trim()) {
      Alert.alert('Error', 'Please enter a friend code');
      return;
    }
    try {
      await friendsApi.sendRequest(code.trim().toUpperCase());
      Alert.alert('Success', 'Friend request sent!');
      setFriendCode('');
      setSearchQuery('');
      setSearchResults([]);
    } catch (error: any) {
      const message = error?.response?.data?.detail || 'Failed to send request';
      Alert.alert('Error', message);
    }
  };

  const handleAcceptRequest = async (friendshipId: string) => {
    try {
      await friendsApi.acceptRequest(friendshipId);
      loadData();
    } catch (error) {
      Alert.alert('Error', 'Failed to accept request');
    }
  };

  const handleDeclineRequest = async (friendshipId: string) => {
    try {
      await friendsApi.declineRequest(friendshipId);
      loadData();
    } catch (error) {
      Alert.alert('Error', 'Failed to decline request');
    }
  };

  const handleRemoveFriend = (friendId: string, username: string) => {
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove @${username}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await friendsApi.removeFriend(friendId);
              loadData();
            } catch (error) {
              Alert.alert('Error', 'Failed to remove friend');
            }
          },
        },
      ]
    );
  };

  const renderFriend = ({ item }: { item: Friend }) => (
    <View style={styles.friendCard}>
      {item.friend_profile_pic ? (
        <Image source={{ uri: item.friend_profile_pic }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="person" size={24} color="#888" />
        </View>
      )}
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>@{item.friend_username}</Text>
        <View style={styles.streakBadge}>
          <Ionicons name="flame" size={14} color="#FF6B35" />
          <Text style={styles.streakText}>{item.streak_count} streak</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.removeButton}
        onPress={() => handleRemoveFriend(item.friend_id, item.friend_username)}
      >
        <Ionicons name="person-remove" size={20} color="#888" />
      </TouchableOpacity>
    </View>
  );

  const renderRequest = ({ item }: { item: FriendRequest }) => (
    <View style={styles.requestCard}>
      {item.requester_profile_pic ? (
        <Image source={{ uri: item.requester_profile_pic }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="person" size={24} color="#888" />
        </View>
      )}
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>@{item.requester_username}</Text>
        <Text style={styles.requestText}>Wants to be your gym buddy</Text>
      </View>
      <View style={styles.requestActions}>
        <TouchableOpacity
          style={styles.acceptButton}
          onPress={() => handleAcceptRequest(item.id)}
        >
          <Ionicons name="checkmark" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.declineButton}
          onPress={() => handleDeclineRequest(item.id)}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSearchResult = ({ item }: { item: SearchResult }) => (
    <View style={styles.searchCard}>
      {item.profile_pic ? (
        <Image source={{ uri: item.profile_pic }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="person" size={24} color="#888" />
        </View>
      )}
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>@{item.username}</Text>
        <Text style={styles.codeText}>{item.friend_code}</Text>
      </View>
      {item.friendship_status === 'none' ? (
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => handleAddFriend(item.friend_code)}
        >
          <Ionicons name="person-add" size={20} color="#fff" />
        </TouchableOpacity>
      ) : (
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>
            {item.friendship_status === 'accepted' ? 'Friends' : 'Pending'}
          </Text>
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
        <View style={styles.headerLeft}>
          <Ionicons name="people" size={28} color="#FF6B35" />
          <Text style={styles.headerTitle}>Friends</Text>
        </View>
        <TouchableOpacity
          style={styles.qrButton}
          onPress={() => setShowQRModal(true)}
        >
          <Ionicons name="qr-code" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
          onPress={() => setActiveTab('friends')}
        >
          <Text style={[styles.tabText, activeTab === 'friends' && styles.activeTabText]}>
            Friends ({friends.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'requests' && styles.activeTab]}
          onPress={() => setActiveTab('requests')}
        >
          <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>
            Requests {requests.length > 0 ? `(${requests.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'add' && styles.activeTab]}
          onPress={() => setActiveTab('add')}
        >
          <Text style={[styles.tabText, activeTab === 'add' && styles.activeTabText]}>
            Add
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'friends' && (
        friends.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={64} color="#444" />
            <Text style={styles.emptyTitle}>No friends yet</Text>
            <Text style={styles.emptySubtitle}>Add friends to start building gym streaks together!</Text>
          </View>
        ) : (
          <FlatList
            data={friends}
            renderItem={renderFriend}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
            }
          />
        )
      )}

      {activeTab === 'requests' && (
        requests.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="mail-outline" size={64} color="#444" />
            <Text style={styles.emptyTitle}>No pending requests</Text>
            <Text style={styles.emptySubtitle}>Friend requests will appear here</Text>
          </View>
        ) : (
          <FlatList
            data={requests}
            renderItem={renderRequest}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B35" />
            }
          />
        )
      )}

      {activeTab === 'add' && (
        <View style={styles.addContent}>
          <View style={styles.addByCode}>
            <Text style={styles.sectionTitle}>Add by Friend Code</Text>
            <View style={styles.codeInputRow}>
              <TextInput
                style={styles.codeInput}
                placeholder="Enter friend code"
                placeholderTextColor="#666"
                value={friendCode}
                onChangeText={setFriendCode}
                autoCapitalize="characters"
                maxLength={6}
              />
              <TouchableOpacity
                style={styles.addCodeButton}
                onPress={() => handleAddFriend(friendCode)}
              >
                <Ionicons name="add" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.searchSection}>
            <Text style={styles.sectionTitle}>Search Users</Text>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by username..."
                placeholderTextColor="#666"
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearch}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
                {isSearching ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="search" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {searchResults.length > 0 && (
            <FlatList
              data={searchResults}
              renderItem={renderSearchResult}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.searchResults}
            />
          )}
        </View>
      )}

      <Modal visible={showQRModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Your Friend Code</Text>
              <TouchableOpacity onPress={() => setShowQRModal(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.codeDisplay}>
              <Text style={styles.bigCode}>{user?.friend_code}</Text>
              <Text style={styles.codeHint}>Share this code with friends</Text>
            </View>

            <View style={styles.qrPlaceholder}>
              <Ionicons name="qr-code" size={120} color="#FF6B35" />
              <Text style={styles.qrHint}>Scan to add as friend</Text>
            </View>
          </View>
        </View>
      </Modal>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 10,
  },
  qrButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#FF6B35',
  },
  tabText: {
    color: '#666',
    fontSize: 15,
    fontWeight: '500',
  },
  activeTabText: {
    color: '#FF6B35',
  },
  listContent: {
    padding: 16,
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendInfo: {
    flex: 1,
    marginLeft: 12,
  },
  friendName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  streakText: {
    color: '#FF6B35',
    fontSize: 13,
    marginLeft: 4,
  },
  removeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  requestText: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  requestActions: {
    flexDirection: 'row',
  },
  acceptButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  declineButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f44336',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  codeText: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    color: '#888',
    fontSize: 12,
  },
  addContent: {
    flex: 1,
    padding: 16,
  },
  addByCode: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  codeInputRow: {
    flexDirection: 'row',
  },
  codeInput: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    letterSpacing: 4,
  },
  addCodeButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2a2a2a',
  },
  dividerText: {
    color: '#666',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  searchSection: {
    marginBottom: 16,
  },
  searchRow: {
    flexDirection: 'row',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    color: '#fff',
    fontSize: 16,
  },
  searchButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  searchResults: {
    paddingTop: 8,
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
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  codeDisplay: {
    alignItems: 'center',
    marginBottom: 32,
  },
  bigCode: {
    color: '#FF6B35',
    fontSize: 40,
    fontWeight: 'bold',
    letterSpacing: 8,
  },
  codeHint: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
  },
  qrPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderRadius: 16,
    padding: 24,
  },
  qrHint: {
    color: '#888',
    fontSize: 14,
    marginTop: 12,
  },
});
