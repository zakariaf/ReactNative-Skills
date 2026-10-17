// src/app/+not-found.tsx: the route Expo Router opens for a URL that matches no route (an old deep
// link, a mistyped shared link, a route the app removed). Without it the router shows its own
// development "Unmatched route" page. Thin, like every route: the screen and its model live in
// src/features/not-found/.
import { NotFoundScreen } from '@/features/not-found/not-found-screen';
import { useNotFoundModel } from '@/features/not-found/use-not-found-model';

export default function NotFoundRoute(): React.JSX.Element {
  const model = useNotFoundModel();
  return (
    <NotFoundScreen
      title={model.title}
      body={model.body}
      goHomeLabel={model.goHomeLabel}
      onGoHome={model.onGoHome}
      isReducedMotion={model.isReducedMotion}
    />
  );
}
