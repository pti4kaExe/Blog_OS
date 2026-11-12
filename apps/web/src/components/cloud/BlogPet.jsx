import { Icon } from '../ui/Icon.jsx'
import { PenLine, Sparkles } from 'lucide-react'

/**
 * Маленький проводник на входе.
 *
 * Это не логотип и не отдельный экран — питомец встречает автора,
 * объясняет первый шаг и добавляет продукту тепла там, где абстрактные
 * кавычки выглядели холодно.
 */
export default function BlogPet() {
  return (
    <div className="blog-pet" aria-label="Питомец BlogOS приветствует автора">
      <div className="pet-orbit pet-orbit-a" aria-hidden="true" />
      <div className="pet-orbit pet-orbit-b" aria-hidden="true" />

      <div className="pet-speech">
        <Icon as={Sparkles} size="sm" />
        <span>Привет! Я помогу собрать первый пост.</span>
      </div>

      <div className="pet-body">
        <div className="pet-sprout" aria-hidden="true">
          <i />
          <b />
        </div>
        <div className="pet-head">
          <span className="pet-eye pet-eye-left" />
          <span className="pet-eye pet-eye-right" />
          <span className="pet-blush pet-blush-left" />
          <span className="pet-blush pet-blush-right" />
          <span className="pet-mouth" />
        </div>
        <div className="pet-torso">
          <Icon as={PenLine} size="sm" />
        </div>
        <span className="pet-arm pet-arm-left" />
        <span className="pet-arm pet-arm-right" />
        <span className="pet-foot pet-foot-left" />
        <span className="pet-foot pet-foot-right" />
      </div>

      <div className="pet-card">
        <strong>3 шага</strong>
        <span>голос → черновик → проверка</span>
      </div>
    </div>
  )
}
