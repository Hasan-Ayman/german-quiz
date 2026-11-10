const tokens = text => (text ?? '').normalize('NFC').toLocaleLowerCase('de')
  .match(/[\p{Script=Latin}\p{M}]+/gu) ?? []
const cleanHead = text => text.replace(/\s*\([^()]*\)/gu, '').trim()
const possessiveOrArticle = /^(?:der|die|das|den|dem|des|ein\w*|mein\w*)$/u
const reflexives = new Set(['mich', 'mir', 'dich', 'dir', 'sich', 'uns', 'euch'])
const changedPresent = {
  fahren: ['fährst', 'fährt'], laufen: ['läufst', 'läuft'], schlafen: ['schläfst', 'schläft'],
  lesen: ['liest'], sehen: ['siehst', 'sieht'], geben: ['gib', 'gibst', 'gibt'],
  essen: ['iss', 'isst'], nehmen: ['nimm', 'nimmst', 'nimmt'], tragen: ['trägst', 'trägt'],
  sprechen: ['sprich', 'sprichst', 'spricht'], helfen: ['hilf', 'hilfst', 'hilft'],
  fallen: ['fällst', 'fällt'], fangen: ['fängst', 'fängt'], gefallen: ['gefällst', 'gefällt'],
  sein: ['bin', 'bist', 'ist', 'sind', 'seid'], haben: ['hast', 'hat'],
  werden: ['wirst', 'wird'], können: ['kann', 'kannst'], müssen: ['muss', 'musst'],
  dürfen: ['darf', 'darfst'], mögen: ['mag', 'magst'], wissen: ['weiß', 'weißt'],
  wollen: ['will', 'willst'], sollen: ['soll', 'sollst'],
  raten: ['rätst', 'rät'], werben: ['wirb', 'wirbst', 'wirbt'],
}
const adjectiveEndings = ['', 'e', 'en', 'em', 'er', 'es']

function contains(sentence, pattern) {
  return pattern.length > 0 &&
    sentence.some((_, index) => pattern.every((word, offset) => sentence[index + offset] === word))
}

function presentForms(lemma) {
  const stem = lemma.replace(/(?:en|n)$/u, '')
  return new Set([lemma, ...['', 'e', 'st', 't', 'en', 'est', 'et'].map(ending => stem + ending),
    ...(changedPresent[lemma] ?? [])])
}

export function targetEvidence(row, sentence) {
  const words = tokens(sentence)
  if (row.part_of_speech === 'noun' && row.german.includes('/')) {
    return row.german.split('/').some(alternative => {
      const head = tokens(cleanHead(alternative))
      if (possessiveOrArticle.test(head[0])) head.shift()
      return contains(words, head)
    }) ? 'source_headword_alternative' : null
  }
  const head = tokens(cleanHead(row.german))
  if (!head.length) return null
  if (contains(words, head)) return 'printed_headword'
  if (row.german === 'es gibt' && contains(words, ['gibt', 'es'])) return 'inverted_fixed_expression'
  const part = row.part_of_speech
  if (part === 'noun') {
    const plural = tokens(row.plural)
    if (possessiveOrArticle.test(plural[0])) plural.shift()
    if (contains(words, plural)) return 'source_plural_or_weak_form'
    if (plural.length === 1 && words.includes(plural[0] + 'n')) return 'dative_plural_candidate'
    if ((row.article === 'der' || row.article === 'das') && head.length === 1 &&
        ['s', 'es'].some(ending => words.includes(head[0] + ending))) return 'genitive_candidate'
    return null
  }
  if (part === 'adjective' && head.length === 1) {
    const base = head[0]
    const comparison = [...tokens(row.comparative), ...tokens(row.superlative).filter(word => word !== 'am')]
    const stems = [base, ...(base.endsWith('e') ? [base.slice(0, -1)] : []),
      ...(base.endsWith('el') ? [base.slice(0, -2) + 'l'] : []),
      ...comparison, ...comparison.filter(word => word.endsWith('en')).map(word => word.slice(0, -2))]
    if (stems.some(stem => adjectiveEndings.some(ending => words.includes(stem + ending)))) {
      return 'adjective_inflection_candidate'
    }
  }
  if (part === 'verb') {
    const reflexive = head[0] === 'sich'
    if (reflexive && !words.some(word => reflexives.has(word))) return null
    if (reflexive) head.shift()
    const lemma = head.at(-1)
    if (!lemma) return null
    const object = head.slice(0, -1).filter(word => !possessiveOrArticle.test(word))
    if (object.length && !contains(words, object)) return null
    const past = tokens(row.preterite).filter(word => word !== 'sich')
    const perfect = tokens(row.perfect)
    if (['hat', 'haben', 'ist', 'sind', 'sein'].includes(perfect[0])) perfect.shift()
    const participle = perfect.filter(word => word !== 'sich')
    if (participle.length === 1 && words.includes(participle[0])) return 'source_participle'
    const particle = past.length === 2 && lemma.startsWith(past[1]) ? past[1] : ''
    const forms = presentForms(particle ? lemma.slice(particle.length) : lemma)
    if (past.length === 1 || particle) forms.add(past[0])
    if (particle && words.some((word, i) => forms.has(word) && words.slice(i + 1).includes(particle))) {
      return 'separated_verb_candidate'
    }
    if (words.includes(lemma) || (!particle && words.some(word => forms.has(word))) ||
        (particle && [...forms].some(word => words.includes(particle + word)))) return 'verb_inflection_candidate'
  }
  return null
}

const badText = /[\p{C}\uFFFD<>]/u
function hasLanguage(text, script) {
  return typeof text === 'string' && text.trim() === text && !badText.test(text) &&
    [...text].some(char => script.test(char)) &&
    [...text].every(char => !/\p{L}/u.test(char) || script.test(char))
}

export function checkExample(draft, job, pdfAudit, spelling = null) {
  const errors = [], flags = [], notes = []
  const source = job?.sources.find(row => row.id === draft.sourceId)
  if (!job || !source || draft.level !== job.level || draft.level !== source.level) errors.push('invalid_job_or_source')
  if (!['authored', 'source_pdf'].includes(draft.origin)) errors.push('invalid_origin')
  if (!hasLanguage(draft.german, /\p{Script=Latin}/u)) errors.push('invalid_german_text')
  if (draft.origin === 'authored' || draft.arabic !== null) {
    if (!hasLanguage(draft.arabic, /\p{Script=Arabic}/u)) errors.push('missing_or_invalid_arabic_text')
  }
  if (draft.origin === 'source_pdf' && source) {
    const audit = pdfAudit.examples[source.id]
    if (source.example_sentence !== draft.german ||
        !job.pdf.some(example => example.source_id === source.id && example.german === draft.german) ||
        audit?.fingerprint !== source.review_fingerprint || audit.german !== draft.german ||
        !audit.numbered_row_marker_matches || !audit.extracted_band_matches) errors.push('source_sentence_or_layout_mismatch')
    if (draft.arabic !== null && draft.arabicOrigin !== 'authored') errors.push('invalid_arabic_provenance')
    if (draft.arabic === null && draft.arabicOrigin != null) errors.push('invalid_arabic_provenance')
    if (!['ai_visual_checked', 'numbered_pdf_row_checked'].includes(draft.sourceAssociation)) {
      flags.push('pdf_association_needs_visual_review')
    }
  }
  if (draft.origin === 'authored') {
    if (draft.sourceAssociation != null || draft.arabicOrigin !== 'authored') errors.push('invalid_authored_provenance')
    if (job?.pdf.length) flags.push('review_original_before_authored_fallback')
  }
  const evidence = source && typeof draft.german === 'string' ? targetEvidence(source, draft.german) : null
  if (!evidence) flags.push('target_usage_needs_review')
  if (typeof draft.german === 'string') {
    const words = tokens(draft.german)
    if (words.length < 2 || !/[.!?][”"»)]?$/u.test(draft.german)) flags.push('check_german_sentence_boundary')
    if (words.some((word, index) => word === words[index + 1])) flags.push('check_repeated_german_word')
    if (source?.part_of_speech === 'noun' && source.article) {
      const head = tokens(cleanHead(source.german))
      const plural = tokens(source.plural).at(-1)
      const articles = { der: ['der', 'den', 'dem', 'des'], die: ['die', 'der'], das: ['das', 'dem', 'des'] }
      if (head.length === 1 && head[0] !== plural &&
          words.some((word, index) => word === head[0] &&
            /^(?:der|die|das|den|dem|des)$/u.test(words[index - 1]) &&
            !articles[source.article].includes(words[index - 1]))) flags.push('check_noun_article_agreement')
    }
    const range = draft.level === 'A1' ? [4, 10] : [5, 15]
    if (draft.origin === 'authored' && (words.length < range[0] || words.length > range[1])) {
      notes.push('outside_typical_cefr_length')
    }
  }
  if (typeof draft.arabic === 'string' && !/[.!؟!][”"»)]?$/u.test(draft.arabic)) {
    flags.push('check_arabic_sentence_boundary')
  }
  const spellResult = spelling?.examples[draft.jobKey ?? draft.entryId]
  const spellingResult = spellResult && spellResult.german === draft.german
    ? { dictionary: spelling.dictionary, unconfirmed: spellResult.unconfirmed,
        ...(spellResult.source_proper_names?.length ? { sourceProperNames: spellResult.source_proper_names } : {}) } : null
  if (spellingResult?.unconfirmed.length) flags.push('check_dictionary_misses')
  return {
    status: errors.length || flags.length ? 'needs_manual_review' : 'automated_checked',
    confidence: errors.length ? 'blocked' : flags.length ? 'limited' : 'structural_and_target_checks_passed',
    evidence, errors, flags, notes, spelling: spellingResult,
    semantic_verification: 'requires_human_review',
  }
}
