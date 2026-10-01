import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
  Modal,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useAuth } from '../../src/contexts/AuthContext';
import { profileApi, notificationsApi } from '../../src/services/api';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

interface NotificationSettings {
  friend_posts: boolean;
  streak_warnings: boolean;
  friend_requests: boolean;
}

export default function ProfileScreen() {
  const { user, logout, updateUser } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>({
    friend_posts: true,
    streak_warnings: true,
    friend_requests: true,
  });
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const loadNotificationSettings = async () => {
    try {
      const response = await notificationsApi.getSettings();
      setNotifSettings(response.data);
    } catch (error) {
      console.log('Error loading notification settings:', error);
    }
  };

  const checkPushPermissions = async () => {
    if (Platform.OS === 'web') return;
    
    const { status } = await Notifications.getPermissionsAsync();
    setPushEnabled(status === 'granted');
  };

  useFocusEffect(
    useCallback(() => {
      checkPushPermissions();
    }, [])
  );

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleChangePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setIsUpdating(true);
      try {
        const response = await profileApi.updateProfile({
          profile_pic: `data:image/jpeg;base64,${result.assets[0].base64}`,
        });
        updateUser(response.data);
        Alert.alert('Success', 'Profile photo updated!');
      } catch (error) {
        Alert.alert('Error', 'Failed to update profile photo');
      } finally {
        setIsUpdating(false);
      }
    }
  };

  const openNotificationSettings = async () => {
    setShowNotifModal(true);
    setLoadingSettings(true);
    await loadNotificationSettings();
    setLoadingSettings(false);
  };

  const handleToggleSetting = async (key: keyof NotificationSettings, value: boolean) => {
    setNotifSettings(prev => ({ ...prev, [key]: value }));
    try {
      await notificationsApi.updateSettings({ [key]: value });
    } catch (error) {
      console.log('Error updating setting:', error);
      // Revert on error
      setNotifSettings(prev => ({ ...prev, [key]: !value }));
    }
  };

  const enablePushNotifications = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Push notifications are only available on mobile devices');
      return;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable notifications in your device settings');
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      Alert.alert(
        'Setup Needed',
        'This app is not linked to an EAS project yet, so it cannot generate a push token. Run `eas init` and rebuild.'
      );
      return;
    }

    try {
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      await notificationsApi.registerToken(token.data);
      setPushEnabled(true);
      Alert.alert('Success', 'Push notifications enabled!');
    } catch (error) {
      console.log('Push token error:', error);
      Alert.alert('Error', 'Failed to enable push notifications');
    }
  };

  const disablePushNotifications = async () => {
    try {
      await notificationsApi.unregisterToken();
      setPushEnabled(false);
      Alert.alert('Success', 'Push notifications disabled');
    } catch (error) {
      console.log('Disable push error:', error);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Ionicons name="person" size={28} color="#FF6B35" />
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileSection}>
          <TouchableOpacity style={styles.avatarContainer} onPress={handleChangePhoto} disabled={isUpdating}>
            {user?.profile_pic ? (
              <Image source={{ uri: user.profile_pic }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={48} color="#888" />
              </View>
            )}
            <View style={styles.editBadge}>
              {isUpdating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="camera" size={16} color="#fff" />
              )}
            </View>
          </TouchableOpacity>

          <Text style={styles.username}>@{user?.username}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        <View style={styles.codeSection}>
          <Text style={styles.sectionTitle}>Your Friend Code</Text>
          <View style={styles.codeCard}>
            <Text style={styles.codeText}>{user?.friend_code}</Text>
            <Text style={styles.codeHint}>Share this with friends to connect</Text>
          </View>
        </View>

        <View style={styles.menuSection}>
          <TouchableOpacity style={styles.menuItem} onPress={openNotificationSettings}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="notifications-outline" size={22} color="#FF6B35" />
            </View>
            <Text style={styles.menuText}>Notifications</Text>
            <View style={styles.menuRight}>
              {pushEnabled && (
                <View style={styles.enabledBadge}>
                  <Text style={styles.enabledText}>ON</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={20} color="#666" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="shield-outline" size={22} color="#FF6B35" />
            </View>
            <Text style={styles.menuText}>Privacy</Text>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="help-circle-outline" size={22} color="#FF6B35" />
            </View>
            <Text style={styles.menuText}>Help & Support</Text>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuIconContainer}>
              <Ionicons name="information-circle-outline" size={22} color="#FF6B35" />
            </View>
            <Text style={styles.menuText}>About</Text>
            <Ionicons name="chevron-forward" size={20} color="#666" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color="#f44336" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

        <Text style={styles.version}>GymBuddy v1.1.0</Text>
      </ScrollView>

      {/* Notification Settings Modal */}
      <Modal visible={showNotifModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Notifications</Text>
              <TouchableOpacity onPress={() => setShowNotifModal(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            {loadingSettings ? (
              <ActivityIndicator size="large" color="#FF6B35" style={{ marginVertical: 40 }} />
            ) : (
              <>
                {/* Push Notifications Toggle */}
                <View style={styles.notifSection}>
                  <Text style={styles.notifSectionTitle}>Push Notifications</Text>
                  <View style={styles.notifItem}>
                    <View style={styles.notifItemInfo}>
                      <Ionicons name="phone-portrait-outline" size={20} color="#FF6B35" />
                      <View style={styles.notifItemText}>
                        <Text style={styles.notifItemTitle}>Enable Push</Text>
                        <Text style={styles.notifItemDesc}>Receive notifications on your device</Text>
                      </View>
                    </View>
                    {Platform.OS === 'web' ? (
                      <Text style={styles.webOnly}>Mobile only</Text>
                    ) : (
                      <Switch
                        value={pushEnabled}
                        onValueChange={(value) => {
                          if (value) enablePushNotifications();
                          else disablePushNotifications();
                        }}
                        trackColor={{ false: '#2a2a2a', true: 'rgba(255, 107, 53, 0.4)' }}
                        thumbColor={pushEnabled ? '#FF6B35' : '#666'}
                      />
                    )}
                  </View>
                </View>

                {/* Notification Types */}
                <View style={styles.notifSection}>
                  <Text style={styles.notifSectionTitle}>Notification Types</Text>
                  
                  <View style={styles.notifItem}>
                    <View style={styles.notifItemInfo}>
                      <Ionicons name="camera-outline" size={20} color="#FF6B35" />
                      <View style={styles.notifItemText}>
                        <Text style={styles.notifItemTitle}>Friend Posts</Text>
                        <Text style={styles.notifItemDesc}>When friends check in at the gym</Text>
                      </View>
                    </View>
                    <Switch
                      value={notifSettings.friend_posts}
                      onValueChange={(value) => handleToggleSetting('friend_posts', value)}
                      trackColor={{ false: '#2a2a2a', true: 'rgba(255, 107, 53, 0.4)' }}
                      thumbColor={notifSettings.friend_posts ? '#FF6B35' : '#666'}
                    />
                  </View>

                  <View style={styles.notifItem}>
                    <View style={styles.notifItemInfo}>
                      <Ionicons name="flame-outline" size={20} color="#FF6B35" />
                      <View style={styles.notifItemText}>
                        <Text style={styles.notifItemTitle}>Streak Warnings</Text>
                        <Text style={styles.notifItemDesc}>When a streak is about to expire</Text>
                      </View>
                    </View>
                    <Switch
                      value={notifSettings.streak_warnings}
                      onValueChange={(value) => handleToggleSetting('streak_warnings', value)}
                      trackColor={{ false: '#2a2a2a', true: 'rgba(255, 107, 53, 0.4)' }}
                      thumbColor={notifSettings.streak_warnings ? '#FF6B35' : '#666'}
                    />
                  </View>

                  <View style={styles.notifItem}>
                    <View style={styles.notifItemInfo}>
                      <Ionicons name="person-add-outline" size={20} color="#FF6B35" />
                      <View style={styles.notifItemText}>
                        <Text style={styles.notifItemTitle}>Friend Requests</Text>
                        <Text style={styles.notifItemDesc}>When someone sends you a request</Text>
                      </View>
                    </View>
                    <Switch
                      value={notifSettings.friend_requests}
                      onValueChange={(value) => handleToggleSetting('friend_requests', value)}
                      trackColor={{ false: '#2a2a2a', true: 'rgba(255, 107, 53, 0.4)' }}
                      thumbColor={notifSettings.friend_requests ? '#FF6B35' : '#666'}
                    />
                  </View>
                </View>
              </>
            )}
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
  content: {
    padding: 20,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#0a0a0a',
  },
  username: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
  },
  email: {
    color: '#888',
    fontSize: 15,
    marginTop: 4,
  },
  codeSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  codeCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  codeText: {
    color: '#FF6B35',
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 6,
  },
  codeHint: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
  },
  menuSection: {
    marginBottom: 24,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 107, 53, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuText: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  menuRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  enabledBadge: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 8,
  },
  enabledText: {
    color: '#4CAF50',
    fontSize: 11,
    fontWeight: '600',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(244, 67, 54, 0.15)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  logoutText: {
    color: '#f44336',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  version: {
    color: '#444',
    fontSize: 13,
    textAlign: 'center',
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
    maxHeight: '80%',
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
  notifSection: {
    marginBottom: 24,
  },
  notifSectionTitle: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  notifItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  notifItemInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  notifItemText: {
    marginLeft: 12,
    flex: 1,
  },
  notifItemTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  notifItemDesc: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  webOnly: {
    color: '#666',
    fontSize: 12,
  },
});
