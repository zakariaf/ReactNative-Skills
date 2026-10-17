// src/ui/form/text-field.android.test.tsx
// Runs under the Android preset (the android Jest project). An EditText's contentDescription
// loses to its own text once something is typed, so on Android the input is named through the
// visible label (accessibilityLabelledBy -> AccessibilityNodeInfo.setLabeledBy), never through
// accessibilityLabel.
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { TextField } from './text-field';

const ID = 'task-editor.title';

async function renderField(value: string): Promise<void> {
  await renderWithProviders(
    <TextField
      testID={ID}
      label="Title"
      kind="sentence"
      value={value}
      onChangeText={jest.fn()}
      onBlur={jest.fn()}
    />,
  );
}

describe('TextField on Android', () => {
  it.each(['', 'Call Sam'])('names the input %j by the label it points at', async (value) => {
    await renderField(value);

    const input = screen.getByTestId(`${ID}.input`);
    expect(screen.getByLabelText('Title')).toBe(input);
    expect(input.props['accessibilityLabel']).toBeUndefined();
    expect(input.props['accessibilityLabelledBy']).toStrictEqual(expect.any(String));
  });
});
