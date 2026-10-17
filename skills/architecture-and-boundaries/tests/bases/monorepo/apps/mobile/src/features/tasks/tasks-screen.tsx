import { formatPrice } from '@acme/core/money/format-price';
import { Button } from '@acme/ui/button';

export function TasksScreen() {
  return <Button label={formatPrice(199)} />;
}
