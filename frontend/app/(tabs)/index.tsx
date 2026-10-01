import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { postsApi } from '../../src/services/api';
import { useAuth } from '../../src/contexts/AuthContext';

interface Post {
  id: string;
  user_id: string;
  username: string;
  profile_pic: string | null;
  image: string;
  caption: string;
  created_at: string;
  reaction_counts: Record<string, number>;
  my_reaction: string | null;
}

const REACTION_EMOJIS = ['🔥', '💪', '👏', '😮'];

export default function FeedScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const loadPosts = async () => {
    try {
      const response = await postsApi.getFeed();
      setPosts(response.data);
    } catch (error) {
      console.log('Error loading feed:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadPosts();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadPosts();
  };

  const handleReact = async (post: Post, emoji: string) => {
    const isRemoving = post.my_reaction === emoji;

    // Optimistic update
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== post.id) return p;
        const counts = { ...p.reaction_counts };
        if (p.my_reaction) {
          counts[p.my_reaction] = Math.max(0, (counts[p.my_reaction] || 1) - 1);
          if (counts[p.my_reaction] === 0) delete counts[p.my_reaction];
        }
        if (!isRemoving) {
          counts[emoji] = (counts[emoji] || 0) + 1;
        }
        return { ...p, reaction_counts: counts, my_reaction: isRemoving ? null : emoji };
      })
    );

    try {
      if (isRemoving) {
        await postsApi.removeReaction(post.id);
      } else {
        await postsApi.react(post.id, emoji);
      }
    } catch (error) {
      console.log('Reaction error:', error);
      loadPosts(); // revert to server state
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const renderPost = ({ item }: { item: Post }) => (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.userInfo}>
          {item.profile_pic ? (
            <Image source={{ uri: item.profile_pic }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={20} color="#888" />
            </View>
          )}
          <View>
            <Text style={styles.username}>@{item.username}</Text>
            <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
          </View>
        </View>
        {item.user_id === user?.id && (
          <View style={styles.myPostBadge}>
            <Text style={styles.myPostText}>You</Text>
          </View>
        )}
      </View>
      
      <Image source={{ uri: item.image }} style={styles.postImage} />
      
      {item.caption ? (
        <Text style={styles.caption}>{item.caption}</Text>
      ) : null}
      
      <View style={styles.postFooter}>
        <View style={styles.actionRow}>
          <Ionicons name="fitness" size={20} color="#FF6B35" />
          <Text style={styles.checkedInText}>Checked in at the gym</Text>
        </View>
      </View>

      <View style={styles.reactionRow}>
        {REACTION_EMOJIS.map((emoji) => {
          const count = item.reaction_counts?.[emoji] || 0;
          const isMine = item.my_reaction === emoji;
          return (
            <TouchableOpacity
              key={emoji}
              style={[styles.reactionButton, isMine && styles.reactionButtonActive]}
              onPress={() => handleReact(item, emoji)}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              {count > 0 && (
                <Text style={[styles.reactionCount, isMine && styles.reactionCountActive]}>
                  {count}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
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
        <Ionicons name="fitness" size={28} color="#FF6B35" />
        <Text style={styles.headerTitle}>GymBuddy</Text>
      </View>

      {posts.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="images-outline" size={64} color="#444" />
          <Text style={styles.emptyTitle}>No posts yet</Text>
          <Text style={styles.emptySubtitle}>
            Be the first to check in or add friends to see their gym sessions!
          </Text>
        </View>
      ) : (
        <FlatList
          data={posts}
          renderItem={renderPost}
          keyExtractor={(item) => item.id}
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
  postCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  username: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  timestamp: {
    color: '#666',
    fontSize: 13,
    marginTop: 2,
  },
  myPostBadge: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  myPostText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  postImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#2a2a2a',
  },
  caption: {
    color: '#fff',
    fontSize: 15,
    padding: 12,
    paddingBottom: 0,
  },
  postFooter: {
    padding: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkedInText: {
    color: '#888',
    fontSize: 14,
    marginLeft: 8,
  },
  reactionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  reactionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reactionButtonActive: {
    backgroundColor: '#FF6B35',
  },
  reactionEmoji: {
    fontSize: 16,
  },
  reactionCount: {
    color: '#aaa',
    fontSize: 13,
    marginLeft: 4,
    fontWeight: '600',
  },
  reactionCountActive: {
    color: '#fff',
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
