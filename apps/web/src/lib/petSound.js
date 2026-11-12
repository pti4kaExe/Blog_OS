/**
 * Звуки питомца на Web Audio API — без библиотек и файлов.
 *
 * Контекст создаётся лениво и только после пользовательского жеста (клик по
 * питомцу или публикация), поэтому автозапуск не срабатывает. Ошибки аудио
 * никогда не ломают сценарий: все вызовы тихие.
 */
import { petSoundEnabled } from './petPrefs.js'

let context = null

function ensureContext() {
  if (typeof window === 'undefined') return null
  try {
    if (!context) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext
      if (!AudioCtor) return null
      context = new AudioCtor()
    }
    if (context.state === 'suspended') context.resume().catch(() => {})
    return context
  } catch {
    return null
  }
}

function tone(ctx, { freq, start = 0, duration = 0.12, gain = 0.035, type = 'sine' }) {
  try {
    const oscillator = ctx.createOscillator()
    const volume = ctx.createGain()
    const begin = ctx.currentTime + start
    const end = begin + duration
    oscillator.type = type
    oscillator.frequency.setValueAtTime(freq, begin)
    volume.gain.setValueAtTime(0.0001, begin)
    volume.gain.exponentialRampToValueAtTime(gain, begin + 0.02)
    volume.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(volume)
    volume.connect(ctx.destination)
    oscillator.start(begin)
    oscillator.stop(end + 0.02)
  } catch {
    // звук не критичен
  }
}

/** Короткий мягкий «писк» при клике по питомцу. */
export function playPetChirp() {
  if (!petSoundEnabled()) return
  const ctx = ensureContext()
  if (!ctx) return
  tone(ctx, { freq: 880, duration: 0.09, gain: 0.03 })
  tone(ctx, { freq: 1180, start: 0.07, duration: 0.1, gain: 0.024 })
}

/** Арпеджио при публикации — маленькая награда. */
export function playPetPublish() {
  if (!petSoundEnabled()) return
  const ctx = ensureContext()
  if (!ctx) return
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((freq, index) => {
    tone(ctx, { freq, start: index * 0.085, duration: 0.22, gain: 0.03, type: 'triangle' })
  })
}
