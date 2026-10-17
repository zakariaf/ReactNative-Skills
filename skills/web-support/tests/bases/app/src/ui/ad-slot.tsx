// src/ui/ad-slot.tsx
// The web and any platform without ads: the slot keeps its place and shows nothing.
export function AdSlot(props: { readonly count: number }): React.JSX.Element | null {
  return props.count > 100 ? null : null;
}
