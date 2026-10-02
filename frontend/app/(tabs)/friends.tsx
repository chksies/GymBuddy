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
  Image,
  Modal,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { friendsApi, getErrorMessage } from '../../src/services/api';
import { useAuth } from '../../src/contexts/AuthContext';
import { useDialog } from '../../src/components/DialogProvider';
import ErrorState from '../../src/components/ErrorState';

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
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const dialog = useDialog();

  const loadData = async () => {
    try {
      const [friendsResponse, requestsResponse] = await Promise.all([
        friendsApi.getFriends(),
        friendsApi.getRequests(),
      ]);
      setFriends(friendsResponse.data);
      setRequests(requestsResponse.data);
      setLoadError(null);
    } catch (error) {
      console.log('Error loading friends:', error);
      setLoadError(getErrorMessage(error, "Couldn't load your friends."));
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
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

  const retry = () => {
    setIsLoading(true);
    loadData();
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;
    setIsSearching(true);
    try {
      const response = await friendsApi.searchUsers(query);
      setSearchResults(response.data);
      setHasSearched(true);
    } catch (error) {
      console.log('Search error:', error);
      dialog.toast(getErrorMessage(error, 'Search failed. Please try again.'), 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddFriend = async (code: string) => {
    if (!code.trim()) {
      dialog.toast('Please enter a friend code', 'error');
      return;
    }
    if (isAdding) return;
    setIsAdding(true);
    try {
      const normalized = code.trim().toUpperCase();
      await friendsApi.sendRequest(normalized);
      dialog.toast('Friend request sent!', 'success');
      setFriendCode('');
      // Keep any search results on screen, but show this person as pending
      setSearchResults((results) =>
        results.map((r) => (r.friend_code === normalized ? { ...r, friendship_status: 'pending' } : r))
      );
      setShowScanModal(false);
      setScanned(false);
    } catch (error: any) {
      dialog.alert("Couldn't send request", getErrorMessage(error, 'Failed to send request'));
      setScanned(false);
    } finally {
      setIsAdding(false);
    }
  };

  const handleAcceptRequest = async (friendshipId: string) => {
    try {
      await friendsApi.acceptRequest(friendshipId);
      dialog.toast('Friend request accepted!', 'success');
      loadData();
    } catch (error) {
      dialog.toast(getErrorMessage(error, 'Failed to accept request'), 'error');
    }
  };

  const handleDeclineRequest = async (friendshipId: string) => {
    try {
      await friendsApi.declineRequest(friendshipId);
      loadData();
    } catch (error) {
      dialog.toast(getErrorMessage(error, 'Failed to decline request'), 'error');
    }
  };

  const handleRemoveFriend = async (friendId: string, username: string) => {
    const confirmed = await dialog.confirm({
      title: 'Remove Friend',
      message: `Are you sure you want to remove @${username}? Your streak with them will be lost.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await friendsApi.removeFriend(friendId);
      dialog.toast(`Removed @${username}`, 'success');
      loadData();
    } catch (error) {
      dialog.toast(getErrorMessage(error, 'Failed to remove friend'), 'error');
    }
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    // Check if it's a valid friend code (6 alphanumeric characters)
    const codeMatch = data.match(/^[A-Z0-9]{6}$/i);
    if (codeMatch) {
      handleAddFriend(data.toUpperCase());
    } else {
      dialog
        .alert('Invalid QR Code', 'This QR code does not contain a valid friend code')
        .then(() => setScanned(false));
    }
  };

  const openScanner = async () => {
    // Web can't scan QR codes (the scanner modal explains that), so don't ask for the camera there
    if (Platform.OS !== 'web' && !permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        dialog.alert('Permission Required', 'Camera permission is needed to scan QR codes');
        return;
      }
    }
    setScanned(false);
    setShowScanModal(true);
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
          style={[styles.addButton, isAdding && { opacity: 0.6 }]}
          onPress={() => handleAddFriend(item.friend_code)}
          disabled={isAdding}
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

  if (loadError && friends.length === 0 && requests.length === 0) {
    return <ErrorState message={loadError} onRetry={retry} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="people" size={28} color="#FF6B35" />
          <Text style={styles.headerTitle}>Friends</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={openScanner}
          >
            <Ionicons name="scan" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowQRModal(true)}
          >
            <Ionicons name="qr-code" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
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
                onSubmitEditing={() => handleAddFriend(friendCode)}
                autoCapitalize="characters"
                maxLength={6}
              />
              <TouchableOpacity
                style={[styles.addCodeButton, isAdding && { opacity: 0.6 }]}
                onPress={() => handleAddFriend(friendCode)}
                disabled={isAdding}
              >
                {isAdding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="add" size={24} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.scanButton} onPress={openScanner}>
            <Ionicons name="scan" size={24} color="#fff" />
            <Text style={styles.scanButtonText}>Scan QR Code</Text>
          </TouchableOpacity>

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
                onChangeText={(text) => {
                  setSearchQuery(text);
                  setHasSearched(false);
                }}
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

          {hasSearched && searchResults.length === 0 && (
            <Text style={styles.noResultsText}>No users found for "{searchQuery.trim()}"</Text>
          )}
        </View>
      )}

      {/* QR Code Display Modal */}
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

            <View style={styles.qrContainer}>
              {user?.friend_code && (
                <QRCode
                  value={user.friend_code}
                  size={200}
                  color="#FF6B35"
                  backgroundColor="#1a1a1a"
                />
              )}
              <Text style={styles.qrHint}>Scan to add as friend</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* QR Scanner Modal */}
      <Modal visible={showScanModal} animationType="slide">
        <View style={[styles.scannerContainer, { paddingTop: insets.top }]}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity onPress={() => setShowScanModal(false)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan Friend Code</Text>
            <View style={{ width: 28 }} />
          </View>

          {Platform.OS === 'web' ? (
            <View style={styles.webFallback}>
              <Ionicons name="scan-outline" size={64} color="#444" />
              <Text style={styles.webFallbackText}>
                QR scanning is only available on mobile devices
              </Text>
              <Text style={styles.webFallbackHint}>
                Use the manual code entry instead
              </Text>
            </View>
          ) : (
            <CameraView
              style={styles.scanner}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            >
              <View style={styles.scannerOverlay}>
                <View style={styles.scannerFrame}>
                  <View style={[styles.corner, styles.topLeft]} />
                  <View style={[styles.corner, styles.topRight]} />
                  <View style={[styles.corner, styles.bottomLeft]} />
                  <View style={[styles.corner, styles.bottomRight]} />
                </View>
                <Text style={styles.scannerHint}>
                  Point camera at a GymBuddy QR code
                </Text>
              </View>
            </CameraView>
          )}
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
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
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
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
  noResultsText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
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
    marginBottom: 24,
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
  qrContainer: {
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
  },
  qrHint: {
    color: '#888',
    fontSize: 14,
    marginTop: 16,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  scannerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scanner: {
    flex: 1,
  },
  scannerOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#FF6B35',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  scannerHint: {
    color: '#fff',
    fontSize: 16,
    marginTop: 32,
    textAlign: 'center',
  },
  webFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  webFallbackText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
  },
  webFallbackHint: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});
