// src/features/account/use-create-account-model.ts (shape: kinds that autofill and chain)
// Name, email and a new password in one screen, in this order, each with the kind that gives it
// the right keyboard and autofill: iOS offers the contact card and a strong password
// (textContentType name, emailAddress, newPassword), Android's autofill service gets name,
// emailAddress and password-new hints. The email sits directly before the password so both
// platforms treat them as one sign-in pair. Sign-in itself, tokens and Associated Domains are
// auth-and-secure-storage's.
import { valibotResolver } from '@hookform/resolvers/valibot';
import { useForm } from 'react-hook-form';
import * as v from 'valibot';

import { useTextField } from '@/hooks/use-text-field';

export const PASSWORD_MIN = 12;

const CREATE_ACCOUNT_SCHEMA = v.object({
  name: v.pipe(v.string(), v.trim(), v.nonEmpty('account.name.required'), v.maxLength(80, 'account.name.too-long')),
  email: v.pipe(v.string(), v.trim(), v.nonEmpty('account.email.required'), v.email('account.email.invalid')),
  // Never trimmed: a space can be part of a password.
  password: v.pipe(v.string(), v.minLength(PASSWORD_MIN, 'account.password.too-short')),
});
type CreateAccountInput = v.InferInput<typeof CREATE_ACCOUNT_SCHEMA>;
type CreateAccountDraft = v.InferOutput<typeof CREATE_ACCOUNT_SCHEMA>;

export function useCreateAccountFields(onSubmit: () => void) {
  const form = useForm<CreateAccountInput, unknown, CreateAccountDraft>({
    resolver: valibotResolver(CREATE_ACCOUNT_SCHEMA),
    mode: 'onTouched',
    defaultValues: { name: '', email: '', password: '' },
  });
  return {
    form,
    name: useTextField(form, 'name', { kind: 'name', next: 'email' }),
    email: useTextField(form, 'email', { kind: 'email', next: 'password' }),
    password: useTextField(form, 'password', { kind: 'new-password', onSubmit }),
  };
}
