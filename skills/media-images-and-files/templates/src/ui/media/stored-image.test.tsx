// src/ui/media/stored-image.test.tsx
// no-providers: StoredImage is presentational; it reads no theme, store or service.
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { StoredImage } from './stored-image';

const URI = 'file:///documents/media/m1.jpg';

const styles = StyleSheet.create({
  thumbnail: { width: 96, height: 72 },
  square: { width: 40, aspectRatio: 1 },
});

describe('StoredImage', () => {
  it('names a content image for screen readers and gives it the caller size', async () => {
    await render(
      <StoredImage
        uri={URI}
        style={styles.thumbnail}
        label="Receipt photo"
        testID="tasks.photo.m1"
      />,
    );
    const image = screen.getByLabelText('Receipt photo');
    expect(image).toHaveProp('accessible', true);
    expect(image).toHaveProp('testID', 'tasks.photo.m1');
    expect(image).toHaveStyle({ width: 96, height: 72 });
  });

  it('hides a decorative image from screen readers', async () => {
    await render(
      <StoredImage uri={URI} style={styles.square} label={null} testID="tasks.photo.m2" />,
    );
    expect(screen.getByTestId('tasks.photo.m2')).toHaveProp('accessible', false);
    expect(screen.queryByLabelText('Receipt photo')).toBeNull();
  });
});
