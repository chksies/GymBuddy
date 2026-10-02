import React, { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// React Native's Alert.alert does nothing on web, which silently broke every confirm
// dialog and error message there. This gives the whole app one API that works everywhere:
// native alerts on phones (they also appear over open modals), an in-app dialog on web.

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

type ToastType = 'success' | 'error' | 'info';

interface DialogApi {
  alert: (title: string, message?: string) => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, type?: ToastType) => void;
}

interface DialogRequest extends ConfirmOptions {
  hideCancel?: boolean;
  resolve: (confirmed: boolean) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [toastState, setToastState] = useState<{ message: string; type: ToastType } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        if (Platform.OS !== 'web') {
          Alert.alert(
            options.title,
            options.message,
            [
              { text: options.cancelText ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              {
                text: options.confirmText ?? 'OK',
                style: options.destructive ? 'destructive' : 'default',
                onPress: () => resolve(true),
              },
            ],
            { cancelable: true, onDismiss: () => resolve(false) }
          );
          return;
        }
        setQueue((current) => [...current, { ...options, resolve }]);
      }),
    []
  );

  const alert = useCallback(
    (title: string, message?: string) =>
      new Promise<void>((resolve) => {
        if (Platform.OS !== 'web') {
          Alert.alert(title, message, [{ text: 'OK', onPress: () => resolve() }], {
            cancelable: true,
            onDismiss: () => resolve(),
          });
          return;
        }
        setQueue((current) => [...current, { title, message, hideCancel: true, resolve: () => resolve() }]);
      }),
    []
  );

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState({ message, type });
    toastTimer.current = setTimeout(() => setToastState(null), type === 'error' ? 4500 : 2500);
  }, []);

  const api = useMemo(() => ({ alert, confirm, toast }), [alert, confirm, toast]);

  const current = queue[0];
  const closeCurrent = (confirmed: boolean) => {
    if (!current) return;
    current.resolve(confirmed);
    setQueue((items) => items.slice(1));
  };

  return (
    <DialogContext.Provider value={api}>
      {children}

      {current && (
        <Modal transparent animationType="fade" visible onRequestClose={() => closeCurrent(false)}>
          <View style={styles.backdrop}>
            <View style={styles.card}>
              <Text style={styles.title}>{current.title}</Text>
              {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
              <View style={styles.actions}>
                {!current.hideCancel && (
                  <Pressable style={[styles.button, styles.cancelButton]} onPress={() => closeCurrent(false)}>
                    <Text style={styles.cancelText}>{current.cancelText ?? 'Cancel'}</Text>
                  </Pressable>
                )}
                <Pressable
                  style={[styles.button, current.destructive ? styles.destructiveButton : styles.primaryButton]}
                  onPress={() => closeCurrent(true)}
                >
                  <Text style={styles.confirmText}>{current.confirmText ?? 'OK'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {toastState && (
        <View pointerEvents="none" style={[styles.toastWrap, { top: insets.top + 12 }]}>
          <View style={[styles.toast, toastState.type === 'error' && styles.toastError]}>
            <Ionicons
              name={
                toastState.type === 'success'
                  ? 'checkmark-circle'
                  : toastState.type === 'error'
                  ? 'alert-circle'
                  : 'information-circle'
              }
              size={20}
              color={toastState.type === 'success' ? '#4CAF50' : toastState.type === 'error' ? '#f44336' : '#FF6B35'}
            />
            <Text style={styles.toastText}>{toastState.message}</Text>
          </View>
        </View>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  message: {
    color: '#aaa',
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 24,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 10,
  },
  cancelButton: {
    backgroundColor: '#2a2a2a',
  },
  primaryButton: {
    backgroundColor: '#FF6B35',
  },
  destructiveButton: {
    backgroundColor: '#f44336',
  },
  cancelText: {
    color: '#ccc',
    fontSize: 15,
    fontWeight: '600',
  },
  confirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 420,
    marginHorizontal: 16,
    backgroundColor: '#242424',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  toastError: {
    borderColor: 'rgba(244,67,54,0.5)',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    flexShrink: 1,
  },
});
