import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { postsApi } from '../../src/services/api';

export default function PostScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const cameraRef = useRef<any>(null);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.7,
        });
        if (photo.base64) {
          setCapturedImage(`data:image/jpeg;base64,${photo.base64}`);
        }
      } catch (error) {
        console.log('Camera error:', error);
        Alert.alert('Error', 'Failed to take picture');
      }
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setCapturedImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const handlePost = async () => {
    if (!capturedImage) {
      Alert.alert('Error', 'Please take or select a photo first');
      return;
    }

    setIsPosting(true);
    try {
      await postsApi.createPost(capturedImage, caption);
      Alert.alert('Success', 'Gym check-in posted!', [
        {
          text: 'OK',
          onPress: () => {
            setCapturedImage(null);
            setCaption('');
            router.push('/(tabs)');
          },
        },
      ]);
    } catch (error: any) {
      console.log('Post error:', error);
      Alert.alert('Error', 'Failed to post. Please try again.');
    } finally {
      setIsPosting(false);
    }
  };

  const toggleCameraFacing = () => {
    setCameraFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  if (!permission) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="camera-outline" size={64} color="#444" />
        <Text style={styles.permissionTitle}>Camera Permission Required</Text>
        <Text style={styles.permissionText}>
          We need camera access to take gym photos
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.galleryButton} onPress={pickImage}>
          <Ionicons name="images-outline" size={20} color="#FF6B35" />
          <Text style={styles.galleryButtonText}>Pick from Gallery</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (capturedImage) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setCapturedImage(null)}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Preview</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={styles.previewContent}>
          <Image source={{ uri: capturedImage }} style={styles.previewImage} />
          
          <View style={styles.captionContainer}>
            <TextInput
              style={styles.captionInput}
              placeholder="Add a caption... (optional)"
              placeholderTextColor="#666"
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={200}
            />
          </View>

          <TouchableOpacity
            style={[styles.postButton, isPosting && styles.postButtonDisabled]}
            onPress={handlePost}
            disabled={isPosting}
          >
            {isPosting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={24} color="#fff" />
                <Text style={styles.postButtonText}>Post Check-In</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ width: 44 }} />
        <Text style={styles.headerTitle}>Gym Check-In</Text>
        <TouchableOpacity onPress={toggleCameraFacing} style={styles.flipButton}>
          <Ionicons name="camera-reverse" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={cameraFacing}
        >
          <View style={styles.cameraOverlay}>
            <View style={styles.frameCorner} />
          </View>
        </CameraView>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.galleryIconButton} onPress={pickImage}>
          <Ionicons name="images" size={28} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
          <View style={styles.captureInner} />
        </TouchableOpacity>

        <View style={{ width: 56 }} />
      </View>

      <Text style={styles.tipText}>
        Take a photo to prove you hit the gym today!
      </Text>
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
    paddingHorizontal: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  permissionText: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
  },
  permissionButton: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  galleryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  galleryButtonText: {
    color: '#FF6B35',
    fontSize: 16,
    marginLeft: 8,
  },
  cameraContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 24,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frameCorner: {
    width: 200,
    height: 200,
    borderWidth: 3,
    borderColor: 'rgba(255, 107, 53, 0.5)',
    borderRadius: 20,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 24,
    paddingHorizontal: 40,
  },
  galleryIconButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  captureInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF6B35',
  },
  tipText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    paddingBottom: 16,
  },
  previewContent: {
    padding: 16,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: '#2a2a2a',
  },
  captionContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginTop: 16,
    padding: 16,
  },
  captionInput: {
    color: '#fff',
    fontSize: 16,
    minHeight: 60,
  },
  postButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF6B35',
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 24,
  },
  postButtonDisabled: {
    opacity: 0.7,
  },
  postButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
});
