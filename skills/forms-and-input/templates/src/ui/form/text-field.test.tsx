// src/ui/form/text-field.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { STROKE } from '@/theme/tokens';
import { MAX_FONT_SCALE } from '@/theme/use-text-style';
import { renderWithProviders } from '@test/render-with-providers';

import { TextField } from './text-field';

import type { TextFieldProps, TextFieldRef } from './text-field';

const ID = 'task-editor.title';

async function renderField(props: Partial<TextFieldProps> = {}): Promise<void> {
  await renderWithProviders(
    <TextField
      testID={ID}
      label="Title"
      kind="sentence"
      value=""
      onChangeText={jest.fn()}
      onBlur={jest.fn()}
      {...props}
    />,
  );
}

describe('TextField', () => {
  it('names the input by its visible label and hides the label from screen readers', async () => {
    await renderField();

    const input = screen.getByTestId(`${ID}.input`);
    expect(screen.getByLabelText('Title')).toBe(input);
    // RNTL also resolves accessibilityLabelledBy, which VoiceOver ignores: assert the iOS name itself.
    expect(input).toHaveProp('accessibilityLabel', 'Title');
    // Queries skip what screen readers skip: the label is drawn, but only the input is read.
    expect(screen.queryByText('Title')).not.toBeOnTheScreen();
    expect(screen.getByText('Title', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('hands each change to onChangeText and reports the blur', async () => {
    const user = userEvent.setup();
    const onChangeText = jest.fn();
    const onBlur = jest.fn();
    await renderField({ value: 'Mil', onChangeText, onBlur });

    await user.type(screen.getByTestId(`${ID}.input`), 'k');

    // Controlled: the value prop stays 'Mil', so the change is 'Mil' plus the typed key.
    expect(onChangeText).toHaveBeenLastCalledWith('Milk');
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('takes keyboard, autofill and secure entry from its kind', async () => {
    await renderField({ kind: 'current-password' });

    const input = screen.getByTestId(`${ID}.input`);
    expect(input).toHaveProp('autoComplete', 'current-password');
    expect(input).toHaveProp('secureTextEntry', true);
    expect(input).toHaveProp('autoCapitalize', 'none');
  });

  it('shows an error as a sentence, a bold edge and the hint screen readers read', async () => {
    await renderField({ error: 'Give the task a title', hint: 'Up to 200 characters' });

    expect(screen.getByTestId(`${ID}.error`)).toHaveTextContent('Give the task a title');
    expect(screen.queryByTestId(`${ID}.hint`)).not.toBeOnTheScreen();
    const input = screen.getByTestId(`${ID}.input`);
    expect(input).toHaveProp('accessibilityHint', 'Give the task a title');
    expect(input).toHaveStyle({ borderWidth: STROKE.bold });
  });

  it('shows the hint while there is no error, and a progress note over the hint', async () => {
    await renderField({ hint: 'Up to 200 characters' });
    expect(screen.getByTestId(`${ID}.hint`)).toHaveTextContent('Up to 200 characters');

    await renderField({ hint: 'Up to 200 characters', status: 'Checking…' });
    expect(screen.getByTestId(`${ID}.status`)).toHaveTextContent('Checking…');
  });

  it('lets the typed text grow with the system setting up to the app-wide cap', async () => {
    await renderField();

    expect(screen.getByTestId(`${ID}.input`)).toHaveProp('maxFontSizeMultiplier', MAX_FONT_SCALE);
  });

  it('passes the focus-chain props to the input', async () => {
    const onSubmitEditing = jest.fn();
    await renderField({ enterKeyHint: 'next', submitBehavior: 'submit', onSubmitEditing });

    const input = screen.getByTestId(`${ID}.input`);
    expect(input).toHaveProp('enterKeyHint', 'next');
    expect(input).toHaveProp('submitBehavior', 'submit');
  });

  it('gives its ref an input that can take focus', async () => {
    let instance: TextFieldRef | null = null;
    await renderField({
      ref: (node: TextFieldRef | null) => {
        instance = node;
      },
    });

    expect(instance).not.toBeNull();
  });

  it('stops editing while disabled and says so', async () => {
    await renderField({ isDisabled: true });

    const input = screen.getByTestId(`${ID}.input`);
    expect(input).toHaveProp('editable', false);
    expect(input).toBeDisabled();
  });
});
