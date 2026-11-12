import { Icon } from '../ui/Icon.jsx'
import {
  Clock3, Heart, Lightbulb, PenLine, Sparkles,
} from 'lucide-react'

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

      <div className="pet-cat">
        <div className="pet-headphones" aria-hidden="true">
          <i />
          <b />
          <span />
        </div>
        <div className="pet-head">
          <span className="pet-ear pet-ear-left" />
          <span className="pet-ear pet-ear-right" />
          <span className="pet-face-light" />
          <span className="pet-eye pet-eye-left" />
          <span className="pet-eye pet-eye-right" />
          <span className="pet-blush pet-blush-left" />
          <span className="pet-blush pet-blush-right" />
          <span className="pet-mouth" />
        </div>
        <div className="pet-body">
          <span className="pet-paw pet-paw-left" />
          <span className="pet-paw pet-paw-right" />
          <span className="pet-tail" />
        </div>
        <div className="pet-laptop">
          <Icon as={PenLine} size="sm" />
        </div>
        <div className="pet-coffee" aria-hidden="true"><i /></div>
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
