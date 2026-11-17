import { useEffect, useState } from 'react'

export function StudySpeech({ german }: { german: string }) {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const engine = window.speechSynthesis
    function refresh() {
      setVoice(engine.getVoices().find(item => item.localService && /^de(?:-|$)/iu.test(item.lang)) ?? null)
    }
    refresh()
    engine.addEventListener('voiceschanged', refresh)
    return () => engine.removeEventListener('voiceschanged', refresh)
  }, [])

  if (!voice) return <small>يتطلب النطق الآلي صوتًا ألمانيًا مثبتًا على الجهاز.</small>

  function play() {
    if (!voice) return
    setMessage('')
    const speech = new SpeechSynthesisUtterance(german)
    speech.voice = voice
    speech.lang = voice.lang
    speech.rate = .87
    speech.onerror = () => setMessage('تعذّر تشغيل الصوت المحلي.')
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(speech)
  }

  return <div className="study-flow">
    <button type="button" className="button secondary" onClick={play}>استمع إلى النطق الآلي المحلي</button>
    {message && <small role="status">{message}</small>}
  </div>
}
