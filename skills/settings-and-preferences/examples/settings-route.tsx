// src/app/(app)/settings.tsx (shape only): the route stays thin. It calls hooks from the feature
// and renders the feature's screen; the dialogs' state lives in the feature hook too.
import { SettingsScreen } from '@/features/settings/settings-screen';
import { useSettingsRoute } from '@/features/settings/use-settings-route';

export default function SettingsRoute(): React.JSX.Element {
  return <SettingsScreen {...useSettingsRoute()} />;
}

// src/features/settings/use-settings-route.ts (shape only)
//
// type OpenDialog = 'reset-settings' | 'delete-all-data' | null;
//
// export function useSettingsRoute(): SettingsScreenProps {
//   const [restartFor, setRestartFor] = useState<Language | null>(null);
//   const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
//   const model = useSettingsModel(useSettingsInput(setRestartFor));
//   const close = () => { setOpenDialog(null); };
//   const router = useRouter();
//   const services = useServices();
//   const onOpenRow = (id: SettingsRowId) => {
//     // reset-settings / delete-all-data → setOpenDialog(id); language → router.push('/settings/language');
//     // privacy-policy → Linking.openURL(privacyPolicyUrl(PRIVACY_POLICY_PAGE)); rate-app → storeReviewUrl(Platform.OS, ids);
//     // contact-support → supportMailUrl(email, versionText); sign-out / delete-account → auth-and-secure-storage's flows.
//   };
//   return {
//     model,
//     onOpenRow,
//     restartDialog: {
//       isOpen: restartFor !== null,
//       onCancel: () => { setRestartFor(null); },
//       // rtl-and-direction: restartForDirection(direction, guard, beforeReload?) resolves only when the
//       // pending direction could not be recorded (then nothing reloads). Ship a language row that
//       // restarts only once decideStartup hands the saved language to DirectionGate (its
//       // direction-switch.md), or the gate flips straight back after the reload.
//       onConfirm: () => {
//         restartForDirection(directionOf(restartFor), services.directionGuard)
//           .then((result) => { if (!result.ok) setRestartFor(null); })
//           .catch((error: unknown) => { services.errorLog.record('service', error); });
//       },
//     },
//     resetSettingsDialog: {
//       isOpen: openDialog === 'reset-settings',
//       onCancel: close,
//       onConfirm: () => { close(); model.actions.onConfirmResetSettings(); },
//     },
//     deleteAllDataDialog: {
//       isOpen: openDialog === 'delete-all-data',
//       onCancel: close,
//       onConfirm: () => { close(); model.actions.onConfirmDeleteAllData(); }, // a failure sets deleteFailedText
//     },
//   };
// }
//
// The group layout titles the screen:
// <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
