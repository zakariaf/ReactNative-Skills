// src/app/sign-in.tsx
// The sign-in route, open only while signed out (the root Stack's guard).
import { SignInScreen } from '@/features/sign-in/sign-in-screen';
import { useSignInModel } from '@/features/sign-in/use-sign-in-model';

export default function SignInRoute(): React.JSX.Element {
  const model = useSignInModel();
  return <SignInScreen {...model} />;
}
