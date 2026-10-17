// src/features/tasks/components/task-photo-strip.tsx: a horizontal strip of a task's photos (a shape to imitate).
// A task holds at most MEDIA_LIMITS.maxPickCount photos, a short bounded list, so a plain FlatList (the
// house default) renders it; FlashList only once a measurement asks for it (performance-budgets).
// StoredImage still gets the photo's ref as its recyclingKey: free here, and required as soon as the
// strip moves to a recycling list. Every thumbnail has a fixed box (no layout jump) and a translated name.
import { FlatList, StyleSheet } from 'react-native';

import { RADII, SPACING } from '@/theme/tokens';
import { StoredImage } from '@/ui/media/stored-image';

import type { TaskPhotoView } from '@/features/tasks/use-task-photos-model';
import type { ReactNode } from 'react';

export type TaskPhotoStripProps = {
  readonly photos: readonly TaskPhotoView[];
  readonly testID: string;
};

/** A layout size, not a design token: three thumbnails and a half fit a phone's width. */
const THUMBNAIL_PT = 96;

const styles = StyleSheet.create({
  strip: { gap: SPACING.sm, paddingInline: SPACING.lg },
  thumbnail: { width: THUMBNAIL_PT, height: THUMBNAIL_PT, borderRadius: RADII.md },
});

export function TaskPhotoStrip({ photos, testID }: TaskPhotoStripProps): ReactNode {
  return (
    <FlatList
      horizontal
      data={photos}
      keyExtractor={(photo) => photo.ref}
      contentContainerStyle={styles.strip}
      showsHorizontalScrollIndicator={false}
      testID={testID}
      renderItem={({ item }) => (
        <StoredImage
          uri={item.uri}
          style={styles.thumbnail}
          label={item.label}
          recyclingKey={item.ref}
          testID={`${testID}.photo.${item.ref}`}
        />
      )}
    />
  );
}
