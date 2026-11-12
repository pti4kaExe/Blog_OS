import { Icon } from '../ui/Icon.jsx'
import { Sparkles } from 'lucide-react'

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
        <span>Привет! Готов создать первый пост?</span>
      </div>

      <span className="pet-decor pet-decor-note" aria-hidden="true" />
      <span className="pet-decor pet-decor-heart" aria-hidden="true">♡</span>
      <span className="pet-decor pet-decor-spark pet-decor-spark-a" aria-hidden="true" />
      <span className="pet-decor pet-decor-spark pet-decor-spark-b" aria-hidden="true" />

      <div className="pet-illustration">
        <img src={PET_SRC} alt="" loading="eager" decoding="async" />
      </div>
    </div>
  )
}
