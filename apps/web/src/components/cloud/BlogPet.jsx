import { Icon } from '../ui/Icon.jsx'
import {
  Clock3, Heart, Lightbulb, PenLine, Sparkles,
} from 'lucide-react'

const PET_SRC = `${import.meta.env.BASE_URL}blogos-pet-cat.png`

/**
 * Маленький проводник на входе.
 *
 * Это не логотип и не отдельный экран — питомец встречает автора,
 * объясняет первый шаг и добавляет продукту тепла там, где абстрактные
 * кавычки выглядели холодно.
 */
export default function BlogPet() {
  return (
    <div className="blog-pet" data-state="writing" aria-label="Питомец BlogOS приветствует автора">
      <div className="pet-orbit pet-orbit-a" aria-hidden="true" />
      <div className="pet-orbit pet-orbit-b" aria-hidden="true" />

      <div className="pet-speech">
        <Icon as={Sparkles} size="sm" />
        <span>Привет! Соберём первый пост?</span>
      </div>

      <div className="pet-illustration">
        <img src={PET_SRC} alt="" loading="eager" decoding="async" />
      </div>

      <div className="pet-state-list" aria-label="Состояния питомца">
        <span data-active="true"><Icon as={PenLine} size="sm" /> пишет</span>
        <span><Icon as={Lightbulb} size="sm" /> думает</span>
        <span><Icon as={Heart} size="sm" /> лайки</span>
        <span><Icon as={Clock3} size="sm" /> ждёт</span>
      </div>
    </div>
  )
}
