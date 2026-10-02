import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { workoutsApi, getErrorMessage } from '../../src/services/api';
import { useAuth } from '../../src/contexts/AuthContext';
import { useDialog } from '../../src/components/DialogProvider';
import ErrorState from '../../src/components/ErrorState';

interface Exercise {
  name: string;
  sets?: number;
  reps?: string;
  weight?: string;
  notes?: string;
}

interface Workout {
  id: string;
  user_id: string;
  username: string;
  profile_pic: string | null;
  workout_type: string;
  title: string;
  description: string;
  exercises: Exercise[];
  created_at: string;
}

export default function WorkoutsScreen() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [workoutType, setWorkoutType] = useState<'text' | 'structured'>('text');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasWorkoutsRef = useRef(false);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const dialog = useDialog();

  const loadWorkouts = async () => {
    try {
      const response = await workoutsApi.getFeed();
      setWorkouts(response.data);
      hasWorkoutsRef.current = response.data.length > 0;
      setLoadError(null);
    } catch (error) {
      console.log('Error loading workouts:', error);
      const message = getErrorMessage(error, "Couldn't load workouts.");
      setLoadError(message);
      // With nothing on screen the error state says it all; otherwise keep what we have
      if (hasWorkoutsRef.current) dialog.toast(message, 'error');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadWorkouts();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadWorkouts();
  };

  const retry = () => {
    setIsLoading(true);
    loadWorkouts();
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setExercises([]);
    setWorkoutType('text');
  };

  const addExercise = () => {
    setExercises([...exercises, { name: '', sets: undefined, reps: '', weight: '' }]);
  };

  const updateExercise = (index: number, field: keyof Exercise, value: string | number) => {
    const updated = [...exercises];
    updated[index] = { ...updated[index], [field]: value };
    setExercises(updated);
  };

  const removeExercise = (index: number) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };

  const handleCreateWorkout = async () => {
    if (isPosting) return;

    // These run inside the full-screen modal, where a toast would be hidden behind it - use dialogs
    if (!title.trim()) {
      dialog.alert('Missing title', 'Please enter a title for your workout.');
      return;
    }

    if (workoutType === 'structured' && exercises.length === 0) {
      dialog.alert('No exercises yet', 'Please add at least one exercise.');
      return;
    }

    if (workoutType === 'structured') {
      const invalidExercise = exercises.find(e => !e.name.trim());
      if (invalidExercise) {
        dialog.alert('Missing exercise name', 'Please fill in a name for every exercise.');
        return;
      }
    }

    setIsPosting(true);
    try {
      await workoutsApi.createWorkout({
        workout_type: workoutType,
        title: title.trim(),
        description: description.trim(),
        exercises: workoutType === 'structured' ? exercises.map(e => {
          const sets = parseInt(String(e.sets ?? ''), 10);
          return {
            name: e.name.trim(),
            sets: Number.isNaN(sets) ? undefined : sets,
            reps: e.reps?.trim() || undefined,
            weight: e.weight?.trim() || undefined,
          };
        }) : [],
      });
      dialog.toast('Workout shared!', 'success');
      setShowCreateModal(false);
      resetForm();
      loadWorkouts();
    } catch (error) {
      console.log('Share workout error:', error);
      dialog.alert("Couldn't share workout", getErrorMessage(error, 'Failed to share workout'));
    } finally {
      setIsPosting(false);
    }
  };

  const handleDeleteWorkout = async (workoutId: string) => {
    const confirmed = await dialog.confirm({
      title: 'Delete Workout',
      message: 'Are you sure you want to delete this workout?',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await workoutsApi.deleteWorkout(workoutId);
      dialog.toast('Workout deleted', 'success');
      loadWorkouts();
    } catch (error) {
      dialog.toast(getErrorMessage(error, 'Failed to delete workout'), 'error');
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

  const renderWorkout = ({ item }: { item: Workout }) => (
    <View style={styles.workoutCard}>
      <View style={styles.cardHeader}>
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
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteWorkout(item.id)}
          >
            <Ionicons name="trash-outline" size={18} color="#888" />
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.workoutTitle}>{item.title}</Text>
      
      {item.description ? (
        <Text style={styles.workoutDescription}>{item.description}</Text>
      ) : null}

      {item.workout_type === 'structured' && item.exercises.length > 0 && (
        <View style={styles.exerciseList}>
          {item.exercises.map((exercise, index) => (
            <View key={index} style={styles.exerciseItem}>
              <View style={styles.exerciseHeader}>
                <View style={styles.exerciseNumber}>
                  <Text style={styles.exerciseNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.exerciseName}>{exercise.name}</Text>
              </View>
              <View style={styles.exerciseDetails}>
                {/* Ternaries, not `&&`: a stray 0 or "" would render as raw text and crash on phones */}
                {exercise.sets ? (
                  <View style={styles.detailBadge}>
                    <Text style={styles.detailText}>{exercise.sets} sets</Text>
                  </View>
                ) : null}
                {exercise.reps ? (
                  <View style={styles.detailBadge}>
                    <Text style={styles.detailText}>{exercise.reps} reps</Text>
                  </View>
                ) : null}
                {exercise.weight ? (
                  <View style={styles.detailBadge}>
                    <Text style={styles.detailText}>{exercise.weight}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.cardFooter}>
        <View style={styles.typeTag}>
          <Ionicons
            name={item.workout_type === 'structured' ? 'list' : 'document-text'}
            size={14}
            color="#FF6B35"
          />
          <Text style={styles.typeTagText}>
            {item.workout_type === 'structured' ? 'Routine' : 'Tip'}
          </Text>
        </View>
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

  if (loadError && workouts.length === 0) {
    return <ErrorState message={loadError} onRetry={retry} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="barbell" size={28} color="#FF6B35" />
          <Text style={styles.headerTitle}>Workouts</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowCreateModal(true)}
        >
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {workouts.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="barbell-outline" size={64} color="#444" />
          <Text style={styles.emptyTitle}>No workouts shared yet</Text>
          <Text style={styles.emptySubtitle}>
            Share your workout routines and tips with your gym buddies!
          </Text>
          <TouchableOpacity
            style={styles.emptyButton}
            onPress={() => setShowCreateModal(true)}
          >
            <Text style={styles.emptyButtonText}>Share Workout</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={workouts}
          renderItem={renderWorkout}
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

      <Modal visible={showCreateModal} animationType="slide">
        <KeyboardAvoidingView
          style={[styles.modalContainer, { paddingTop: insets.top }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setShowCreateModal(false);
                resetForm();
              }}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Share Workout</Text>
            <TouchableOpacity
              onPress={handleCreateWorkout}
              disabled={isPosting}
            >
              {isPosting ? (
                <ActivityIndicator size="small" color="#FF6B35" />
              ) : (
                <Text style={styles.postText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.typeSelector}>
              <TouchableOpacity
                style={[styles.typeButton, workoutType === 'text' && styles.typeButtonActive]}
                onPress={() => setWorkoutType('text')}
              >
                <Ionicons
                  name="document-text"
                  size={20}
                  color={workoutType === 'text' ? '#fff' : '#888'}
                />
                <Text style={[styles.typeButtonText, workoutType === 'text' && styles.typeButtonTextActive]}>
                  Quick Tip
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeButton, workoutType === 'structured' && styles.typeButtonActive]}
                onPress={() => setWorkoutType('structured')}
              >
                <Ionicons
                  name="list"
                  size={20}
                  color={workoutType === 'structured' ? '#fff' : '#888'}
                />
                <Text style={[styles.typeButtonText, workoutType === 'structured' && styles.typeButtonTextActive]}>
                  Workout Routine
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Title</Text>
              <TextInput
                style={styles.textInput}
                placeholder={workoutType === 'text' ? 'e.g., Pro tip for deadlifts' : 'e.g., Push Day'}
                placeholderTextColor="#666"
                value={title}
                onChangeText={setTitle}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                {workoutType === 'text' ? 'Your Tip' : 'Notes (optional)'}
              </Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                placeholder={workoutType === 'text' ? 'Share your gym wisdom...' : 'Any notes about this workout...'}
                placeholderTextColor="#666"
                value={description}
                onChangeText={setDescription}
                multiline
              />
            </View>

            {workoutType === 'structured' && (
              <View style={styles.exercisesSection}>
                <View style={styles.exercisesHeader}>
                  <Text style={styles.inputLabel}>Exercises</Text>
                  <TouchableOpacity style={styles.addExerciseButton} onPress={addExercise}>
                    <Ionicons name="add" size={20} color="#FF6B35" />
                    <Text style={styles.addExerciseText}>Add Exercise</Text>
                  </TouchableOpacity>
                </View>

                {exercises.map((exercise, index) => (
                  <View key={index} style={styles.exerciseForm}>
                    <View style={styles.exerciseFormHeader}>
                      <Text style={styles.exerciseFormTitle}>Exercise {index + 1}</Text>
                      <TouchableOpacity onPress={() => removeExercise(index)}>
                        <Ionicons name="trash-outline" size={18} color="#f44336" />
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.exerciseInput}
                      placeholder="Exercise name"
                      placeholderTextColor="#666"
                      value={exercise.name}
                      onChangeText={(v) => updateExercise(index, 'name', v)}
                    />
                    <View style={styles.exerciseRow}>
                      <TextInput
                        style={[styles.exerciseInput, styles.smallInput]}
                        placeholder="Sets"
                        placeholderTextColor="#666"
                        value={exercise.sets?.toString() || ''}
                        onChangeText={(v) => updateExercise(index, 'sets', v)}
                        keyboardType="number-pad"
                      />
                      <TextInput
                        style={[styles.exerciseInput, styles.smallInput]}
                        placeholder="Reps"
                        placeholderTextColor="#666"
                        value={exercise.reps || ''}
                        onChangeText={(v) => updateExercise(index, 'reps', v)}
                      />
                      <TextInput
                        style={[styles.exerciseInput, styles.smallInput]}
                        placeholder="Weight"
                        placeholderTextColor="#666"
                        value={exercise.weight || ''}
                        onChangeText={(v) => updateExercise(index, 'weight', v)}
                      />
                    </View>
                  </View>
                ))}

                {exercises.length === 0 && (
                  <View style={styles.noExercises}>
                    <Text style={styles.noExercisesText}>Tap "Add Exercise" to build your routine</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
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
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 16,
  },
  workoutCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  username: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  timestamp: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  deleteButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  workoutDescription: {
    color: '#ccc',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  exerciseList: {
    marginTop: 8,
  },
  exerciseItem: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  exerciseNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  exerciseNumberText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  exerciseName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  exerciseDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginLeft: 34,
  },
  detailBadge: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 4,
  },
  detailText: {
    color: '#888',
    fontSize: 13,
  },
  cardFooter: {
    flexDirection: 'row',
    marginTop: 12,
  },
  typeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 53, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  typeTagText: {
    color: '#FF6B35',
    fontSize: 13,
    marginLeft: 6,
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
  emptyButton: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  postText: {
    color: '#FF6B35',
    fontSize: 16,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  typeSelector: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginHorizontal: 4,
  },
  typeButtonActive: {
    backgroundColor: '#FF6B35',
  },
  typeButtonText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  exercisesSection: {
    marginTop: 8,
  },
  exercisesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  addExerciseButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addExerciseText: {
    color: '#FF6B35',
    fontSize: 14,
    marginLeft: 4,
  },
  exerciseForm: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  exerciseFormHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  exerciseFormTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  exerciseInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    marginBottom: 8,
  },
  exerciseRow: {
    flexDirection: 'row',
  },
  smallInput: {
    flex: 1,
    marginRight: 8,
    marginBottom: 0,
  },
  noExercises: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  noExercisesText: {
    color: '#666',
    fontSize: 14,
  },
});
