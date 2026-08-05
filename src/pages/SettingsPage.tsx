import { SettingsPageView } from '../components/settings/SettingsPageView'
import {
  useSettingsPageController,
  type SettingsSection,
} from '../hooks/useSettingsPageController'

export type { SettingsSection }

export function SettingsPage({ section }: { section?: SettingsSection } = {}) {
  const controller = useSettingsPageController(section)
  return <SettingsPageView controller={controller} section={section} />
}
