// src/ui/media/stored-image.tsx
// Shows one image the app stored (a photo the person attached): expo-image with the caller's size,
// cover fit, a memory-only cache (the file is already on disk, and a stored file never changes under
// its name), a recycling key for recycled list cells, and a name for VoiceOver and TalkBack or an
// explicit decorative mark. Presentational: the screen model resolves the MediaRef to `uri` with
// MediaStorePort.uriOf and passes the translated label.
import { Image } from 'expo-image';

import type { ReactNode } from 'react';
import type { ImageStyle, StyleProp } from 'react-native';

export type StoredImageProps = {
  /** From MediaStorePort.uriOf at render time; never a stored value. */
  readonly uri: string;
  /** The box the image fills: width and height, or one of them with aspectRatio. Required. */
  readonly style: StyleProp<ImageStyle>;
  /** Translated description; null marks the image decorative (hidden from screen readers). */
  readonly label: string | null;
  /** In a recycled list cell: the record's id, so a reused cell never flashes the previous photo. */
  readonly recyclingKey?: string;
  /** 'cover' crops to fill (thumbnails); 'contain' shows the whole image (a viewer). */
  readonly fit?: 'cover' | 'contain';
  readonly testID: string;
};

export function StoredImage({
  uri,
  style,
  label,
  recyclingKey,
  fit = 'cover',
  testID,
}: StoredImageProps): ReactNode {
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={fit}
      cachePolicy="memory"
      recyclingKey={recyclingKey ?? uri}
      accessible={label !== null}
      accessibilityLabel={label ?? ''}
      accessibilityRole="image"
      testID={testID}
    />
  );
}
