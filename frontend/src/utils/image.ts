import { Platform } from 'react-native';

/**
 * On web the camera and file picker hand back full-size originals (often several MB, and not
 * always JPEG). Shrinking them before upload makes posting fast and keeps storage small.
 * Phones already compress through the picker's `quality` option, so they are left alone.
 */
export function downscaleDataUri(dataUri: string, maxDimension = 1600, quality = 0.82): Promise<string> {
  if (Platform.OS !== 'web') return Promise.resolve(dataUri);

  return new Promise((resolve) => {
    const browser = globalThis as any;
    const image = new browser.Image();
    image.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = browser.document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    // If the browser can't decode it, send the original and let the server decide
    image.onerror = () => resolve(dataUri);
    image.src = dataUri;
  });
}

/** Builds a data URI from an ImagePicker asset, keeping its real mime type. */
export function assetToDataUri(asset: { uri: string; base64?: string | null; mimeType?: string | null }): string | null {
  if (asset.uri?.startsWith('data:')) return asset.uri;
  if (asset.base64) return `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
  return null;
}
