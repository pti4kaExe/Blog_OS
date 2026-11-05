import {
  BookOpen, Cloud, Command, FileStack, LogOut, Plus, Radar, Settings, Workflow,
} from 'lucide-react'
import { labelOf, PLATFORMS } from '../../lib/format.js'
import { Select } from '../ui.jsx'
import { PALETTE_HINT } from '../ui/CommandPalette.jsx'
import {
  SideBrand, SideFoot, SideGroup, SideItem,
} from '../ui/SideNav.jsx'

/* «Расходы» раньше стояли здесь отдельным разделом — полноценный
   журнал вызовов с фильтрами, который обычный автор открывал почти
   никогда. Сводка расходов переехала в «Настройки»; полный раздел
   убран, а не спрятан: держать неиспользуемый экран в коде — долг. */
export const CLOUD_SECTIONS = [
  { key: 'pipeline', label: 'Конвейер поста', icon: Workflow },
  { key: 'archive', label: 'Архив постов', icon: FileStack },
  { key: 'radar', label: 'CommentRadar', icon: Radar },
  { key: 'knowledge', label: 'База знаний', icon: BookOpen },
]

/**
 * Боковая панель облачного режима.
 *
 * Сверху вниз: кто мы → в каком канале → что делаем → кто я.
 * Канал стоит выше разделов намеренно: он задаёт содержимое всех
 * разделов сразу, и это первое, что человек должен видеть и менять.
 */
export default function CloudSidebar({
  user, channels, activeId, onChannel, view, onView,
  onNewChannel, onPalette, onLogout, onUseLocal, disabled,
}) {
  const roleLabel = user?.role === 'admin' ? 'администратор' : 'автор'

  return (
    <>
      <SideBrand subtitle="пост в вашем голосе" />

      <SideGroup label="Канал">
        {channels.length > 0 ? (
          <Select
            className="inp-sm side-select"
            aria-label="Активный канал"
            value={activeId ?? ''}
            onChange={(event) => onChannel(event.target.value)}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={String(channel.id)}>
                {channel.name} · {labelOf(PLATFORMS, channel.platform)}
              </option>
            ))}
          </Select>
        ) : (
          <p className="side-empty">Каналов пока нет</p>
        )}
        <SideItem icon={Plus} label="Новый канал" onClick={onNewChannel} />
      </SideGroup>

      <SideGroup label="Разделы">
        {CLOUD_SECTIONS.map((section) => (
          <SideItem
            key={section.key}
            icon={section.icon}
            label={section.label}
            active={view === section.key}
            disabled={disabled}
            onClick={() => onView(section.key)}
          />
        ))}
      </SideGroup>

      <SideFoot>
        {/* Карточка профиля ведёт туда же, куда и пункт «Настройки»: это
            один и тот же экран, два входа в него — опознаваемая личность
            и явная подпись рядом с остальными пунктами (раздел 14). */}
        <button type="button" className="side-user" onClick={() => onView('settings')} title="Настройки">
          <span className="user-avatar" aria-hidden="true">
            {(user?.name || '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="side-user-text">
            <span className="side-user-name">{user?.name || 'Автор'}</span>
            <span className="side-user-role">{roleLabel}</span>
          </span>
        </button>

        <SideItem
          icon={Settings}
          label="Настройки"
          active={view === 'settings'}
          onClick={() => onView('settings')}
        />
        <SideItem icon={Command} label="Команды" badge={PALETTE_HINT} onClick={onPalette} />
        <SideItem icon={Cloud} label="Работать локально" onClick={onUseLocal} title="Без сети, данные в браузере" />
        <SideItem icon={LogOut} label="Выйти" onClick={onLogout} />
      </SideFoot>
    </>
  )
}
