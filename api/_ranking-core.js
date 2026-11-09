function clamp(value, low = 0, high = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return low;
  return Math.max(low, Math.min(high, n));
}

function cleanArray(values, limit = 16) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => typeof value === 'string' ? value : value?.name)
    .filter(Boolean)
    .map(value => String(value).trim().replace(/\s+/g, ' ').slice(0, 100))
    .filter(Boolean)
    .slice(0, limit);
}

function energyLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n <= 2.5) return 'very low energy, hushed, restrained';
  if (n <= 4) return 'low energy, calm, restrained';
  if (n >= 8.5) return 'very high energy, forceful, lively';
  if (n >= 6.5) return 'high energy, driving, lively';
  return 'medium energy';
}

export function isCompilation(candidate) {
  const artist = String(candidate?.artist || '').trim().toLowerCase();
  const title = String(candidate?.title || '').trim().toLowerCase();
  return /^(?:various(?: artists)?|v\/?a|v\.a\.)$/.test(artist) ||
    /\b(?:greatest hits|the best of|ultimate collection|compilation|anthology|box set|boxed set|original albums|complete recordings|cd collection|sampler)\b/.test(title);
}

function compilationPenalty(candidate, body) {
  const request = String(body?.note || '').toLowerCase();
  // Anthologies and label samplers remain available when explicitly requested.
  if (/\b(?:compilation|anthology|greatest hits|best of|various artists|sampler|mixtape|soundtrack|coletanea|compilacao)\b/.test(request.normalize('NFD').replace(/[\u0300-\u036f]/g,''))) return 0;
  const artist = String(candidate?.artist || '').trim().toLowerCase();
  const title = String(candidate?.title || '').trim().toLowerCase();
  const multiArtist = /^(?:various(?: artists)?|v\/?a|v\.a\.)$/.test(artist);
  const compilationTitle = /\b(?:greatest hits|the best of|ultimate collection|compilation|anthology|box set|boxed set|original albums|complete recordings|cd collection|sampler)\b/.test(title);
  const boxSet = /\b(?:box(?:ed)? set|original albums|complete recordings|cd collection)\b/.test(title);
  return (multiArtist ? 0.23 : 0) + (compilationTitle ? (boxSet ? 0.24 : 0.15) : 0);
}

// "dream pop" requires that whole style; a generic "pop" tag alone is
// insufficient. Conversely, excluding "rock" must not exclude "rocksteady".
// Word boundaries permit real subgenres (e.g. "jazz fusion" for "jazz").
export function styleMatches(label, requested) {
 const normalized=value=>String(value||'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim();
 const haystack=normalized(label),needle=normalized(requested);
 return Boolean(haystack&&needle&&(' '+haystack+' ').includes(' '+needle+' '));
}

export function genreConflict(candidate, avoided) {
  if (!avoided.length) return false;
  const labels=[...cleanArray(candidate.genres),...cleanArray(candidate.tags)];
  return avoided.some(value=>labels.some(label=>styleMatches(label,value)));
}

export function geographyFit(candidate, body){
 const wanted=Array.isArray(body?.intent?.originCountries)?body.intent.originCountries:[];
 const avoided=Array.isArray(body?.intent?.avoidOriginCountries)?body.intent.avoidOriginCountries:[];
 const code=String(candidate?.originCountry||'').toUpperCase();
 const voice=Array.isArray(candidate?.vocalLanguages)?candidate.vocalLanguages.map(x=>String(x).toLowerCase()):[];
 const wantedVoice=Array.isArray(body?.intent?.vocalLanguages)?body.intent.vocalLanguages:[];
 const avoidVoice=Array.isArray(body?.intent?.avoidVocalLanguages)?body.intent.avoidVocalLanguages:[];
 return {
  known:Boolean(code),
  requestedCountry:wanted.length>0,
  countryMatch:Boolean(code&&wanted.includes(code)),
  excludedCountry:Boolean(code&&avoided.includes(code)),
  knownVocalLanguage:voice.length>0,
  requestedVocalLanguage:wantedVoice.length>0,
  vocalMatch:wantedVoice.some(code=>voice.includes(code)),
  excludedVocalLanguage:avoidVoice.some(code=>voice.includes(code))
 };
}

// Broad area is a recall hint for a lyric-language request, NEVER proof
// that a specific album contains vocals in that language.
export function plausibleVocalOrigin(candidate, body){
 const country=String(candidate?.originCountry||'').toUpperCase();
 if(!country)return false;
 const requested=Array.isArray(body?.intent?.vocalLanguages)?body.intent.vocalLanguages:[];
 const hints={nl:['NL','BE'],pt:['BR','PT'],fr:['FR','BE'],de:['DE'],es:['ES','AR'],
  ja:['JP'],uk:['UA']};
 return requested.some(code=>(hints[code]||[]).includes(country));
}

export function moodConflict(candidate, avoided) {
  const avoid = new Set((avoided || []).map(value => String(value).toLowerCase()));
  if (!avoid.size) return false;
  const translatedGuess = String(candidate.moodSource || '') === 'musicbrainz-tag-translation';
  const reliableMoods = translatedGuess ? [] : cleanArray(candidate.moods, 20);
  const albumMoods = [...reliableMoods, ...cleanArray(candidate.tags, 24)]
    .map(value => String(value).toLowerCase());
  return albumMoods.some(value => [...avoid].some(needle => value.includes(needle)));
}

function trustedEnergy(candidate) {
 const source=String(candidate?.energySource||'').toLowerCase();
 const confidence=Number(candidate?.energyConfidence)||0;
 if(source==='audio'||source==='live')return true;
 if(source==='musicbrainz-tag-translation')return false;
 return Boolean(source)&&confidence>=0.65;
}

export function energyPenalty(candidate, body) {
  if (body.energy == null || candidate.energy == null) return 0;
  if(!trustedEnergy(candidate))return 0;
  const distance = Math.abs(Number(body.energy) - Number(candidate.energy));
  if (!Number.isFinite(distance) || distance <= 1.5) return 0;
  return Math.min(0.32, (distance - 1.5) * 0.055);
}

export function requestedGenreFit(candidate, body) {
  const wanted = cleanArray(body?.intent?.genres, 12).map(value => String(value).toLowerCase());
  if (!wanted.length) return { requested: false, known: false, match: false, matched: [] };

  const haystack = [...cleanArray(candidate.genres, 14), ...cleanArray(candidate.tags, 24)]
    .map(value => String(value).toLowerCase());
  if (!haystack.length) return { requested: true, known: false, match: false, matched: [] };

  const matched = wanted.filter(needle =>
    haystack.some(value => styleMatches(value,needle))
  );
  return { requested: true, known: true, match: matched.length > 0, matched };
}

export function requestedMoodFit(candidate, body) {
  const inferred = body?.intent?.moods && typeof body.intent.moods === 'object'
    ? Object.keys(body.intent.moods)
    : [];
  const wanted = [...new Set([
    ...cleanArray(body?.moods, 24),
    ...cleanArray(inferred, 24),
  ].map(value => String(value).toLowerCase()))];
  if (!wanted.length) return { requested: false, known: false, match: false, matched: [] };

  const translatedGuess = String(candidate.moodSource || '') === 'musicbrainz-tag-translation';
  const reliableMoods = translatedGuess
    ? []
    : cleanArray(candidate.moods, 20).map(value => String(value).toLowerCase());
  const tags = cleanArray(candidate.tags, 24).map(value => String(value).toLowerCase());

  const matched = wanted.filter(needle =>
    reliableMoods.some(value => value.includes(needle) || needle.includes(value)) ||
    tags.some(value => value === needle || value.startsWith(needle + ' ') || value.endsWith(' ' + needle))
  );
  // High-precision style hints support retrieval, but are not confirmed moods.
  const styleHints = {
    dreamy:['dream pop','ethereal wave','shoegaze','ambient pop','chillwave','hypnagogic pop'],
    calm:['ambient','downtempo','chillout','new age','minimal ambient','lounge'],
    reflective:['minimal ambient','ambient jazz','slowcore'],
    energetic:['dance-punk','dance pop','hard dance','high energy'],
    dark:['dark ambient','darkwave','gothic rock']
  };
  const genres=cleanArray(candidate.genres,20).map(value=>String(value).toLowerCase());
  const suggestive=wanted.filter(needle=>
    (styleHints[needle]||[]).some(hint=>genres.some(genre=>genre.includes(hint)))
  );

  return {
    requested: true,
    known: reliableMoods.length > 0,
    match: matched.length > 0,
    matched,
    suggestive
  };
}

// Style cues are *weak evidence* about emotional character, not a verified
// acoustic mood label. We use them to reject obvious contradictions and as
// low-weight priors for under-tagged records.
const MOOD_STYLE_CUES={
 hopeful:{
  supporting:['sunshine pop','gospel','disco','dance pop','funk','reggae','afrobeat','soul'],
  opposing:['noise','drone','harsh noise','doom metal','black metal','dark ambient','darkwave','industrial']
 },
 calm:{
  supporting:['ambient','downtempo','chillout','new age','lounge','soft jazz'],
  opposing:['noise rock','harsh noise','grindcore','thrash metal','hardcore punk','gabber']
 },
 dreamy:{
  supporting:['dream pop','ethereal wave','shoegaze','ambient pop','chillwave'],
  opposing:['noise rock','grindcore','thrash metal','hardcore punk']
 },
 energetic:{
  supporting:['disco','dance pop','funk','house','dance-punk'],
  opposing:['drone','new age','slowcore','minimal ambient']
 },
 warm:{
  supporting:['soul','quiet storm','singer-songwriter','soft rock','bossa nova'],
  opposing:['harsh noise','dark ambient']
 }
};
export function moodStyleSignal(candidate, body){
 const requested=Object.keys(body?.intent?.moods||{});
 const labels=[...cleanArray(candidate.genres,20),...cleanArray(candidate.tags,24)];
 let bonus=0,penalty=0;
 for(const mood of requested.slice(0,2)){
  const cues=MOOD_STYLE_CUES[mood];
  if(!cues)continue;
  const positive=cues.supporting.filter(q=>labels.some(g=>styleMatches(g,q))).length;
  const negative=cues.opposing.filter(q=>labels.some(g=>styleMatches(g,q))).length;
  bonus+=Math.min(.1,.045*positive);
  penalty+=Math.min(.31,.20*negative);
 }
 return {bonus:Math.min(.14,bonus),penalty:Math.min(.36,penalty)};
}

// A personal conflict is not itself a genre. These are bounded style cues,
// not proof that an album's lyrics describe the listener's story.
export function relationshipStyleFit(candidate, body){
 if(body?.intent?.narrativeKind!=='relationship-uncertainty')return {
  active:false,bonus:0,penalty:0,evidence:[],verifiedMood:false
 };
 const styles=cleanArray(candidate?.genres,20).map(x=>x.toLowerCase());
 const tags=cleanArray(candidate?.tags,24).map(x=>x.toLowerCase());
 const labels=[...styles,...tags];
 const trustedMoods=String(candidate?.moodSource||'')!=='musicbrainz-tag-translation'
  ?cleanArray(candidate?.moods,24).map(x=>x.toLowerCase()):[];
 const musicMood=['melancholic','reflective','introspective','bittersweet','tender','heartbroken'];
 const verifiedMood=musicMood.some(w=>trustedMoods.some(x=>styleMatches(x,w)));
 const stylistic=[
  ['slowcore',.15],['sadcore',.15],['singer-songwriter',.11],
  ['indie folk',.10],['chamber pop',.09],['ambient folk',.11],
  ['folk',.065],['acoustic',.07],['dream pop',.07],['art pop',.04],
  ['piano',.05],['soft rock',.055],['downtempo',.05]
 ];
 const evidence=stylistic.filter(([name])=>labels.some(x=>styleMatches(x,name))).map(([name])=>name);
 let support=evidence.reduce((sum,name)=>sum+(stylistic.find(x=>x[0]===name)?.[1]||0),0);
 const moodKeywords=['melancholic','melancholy','sad','bittersweet','heartbreak','introspective','reflective'];
 if(tags.some(x=>moodKeywords.some(term=>styleMatches(x,term))))support+=.12;
 if(verifiedMood)support+=.18;
 // Evidently dance-oriented or abrasive albums are a poor *default* for
 // a low-energy, conflicted relationship note, but are not forbidden genres.
 const opposing=[
  ['disco',.17],['jazz-funk',.08],['dance pop',.14],
  ['dance-punk',.10],['nu-disco',.13],['dancehall',.09],
  ['party',.15],['gabber',.18],['hardstyle',.16],['happy hardcore',.19],
  ['hard dance',.15],['grindcore',.12],['noise rock',.09],
  ['funk',.045],['house',.05]
 ];
 const requestedEnergy=body?.energy==null?null:Number(body.energy);
 const energyLow=Number.isFinite(requestedEnergy)&&requestedEnergy<=4;
 const mismatch=opposing.reduce((sum,[name,weight])=>
   sum+(labels.some(x=>styleMatches(x,name))?weight:0),0);
 // An explicit request for high-energy music always takes priority.
 const energeticGoal=Number.isFinite(requestedEnergy)&&requestedEnergy>=7;
 const penalty=energeticGoal?0:Math.min(0.38,mismatch*(energyLow?1.45:1));
 return {active:true,bonus:Math.min(.34,support),penalty,evidence:evidence.slice(0,4),verifiedMood};
}

function reliableEnergyDistance(candidate, body) {
  if (body?.energy == null || candidate?.energy == null) return null;
  if(!trustedEnergy(candidate))return null;
  const distance = Math.abs(Number(body.energy) - Number(candidate.energy));
  return Number.isFinite(distance) ? distance : null;
}

export function scoreCandidate(candidate, neural, body, learnedTaste = { score: 0, confidence: 0 }) {
  const local = clamp(candidate.localScore ?? 0.5);
  const lexical = clamp(((Number(candidate.semanticScore) || 0) + 1) / 2);
  const familiarity = clamp(candidate.familiarity ?? 0);
  const modePreference = body.comfort === 'comfort'
    ? familiarity
    : body.comfort === 'exploration'
      ? 1 - familiarity
      : 0.5;
  const adjacency = familiarity < 0.25 ? clamp(candidate.tasteAdjacency ?? 0) : 0;
  const adjacencyWeight = body.comfort === 'exploration'
    ? 0.075
    : body.comfort === 'comfort'
      ? 0.015
      : 0.04;

  const rawNeuralFit = clamp((neural + 1) / 2);
  const profileQuality = clamp(candidate.profileQuality ?? 0.65, 0.18, 1);
  const neuralReliability = 0.45 + 0.55 * profileQuality;
  const neuralFit = 0.5 + (rawNeuralFit - 0.5) * neuralReliability;

  const genreFit = requestedGenreFit(candidate, body);
  const moodFit = requestedMoodFit(candidate, body);
  const avoidGenres = cleanArray(body.intent?.avoidGenres, 12);
  const avoidMoods = body.intent?.avoidMoods ? Object.keys(body.intent.avoidMoods) : [];
  const hasExplicitControls = Boolean(
    body.energy != null ||
    body.time != null ||
    genreFit.requested ||
    moodFit.requested ||
    avoidGenres.length ||
    avoidMoods.length ||
    Boolean(body.intent?.originCountries?.length) ||
    Boolean(body.intent?.vocalLanguages?.length)
  );

  const neuralWeight = hasExplicitControls ? 0.56 : 0.66;
  const localWeight = hasExplicitControls ? 0.27 : 0.20;
  const lexicalWeight = String(body.note || '').trim() ? 0.04 : 0.02;
  const modeWeight = 0.05;

  let score =
    neuralWeight * neuralFit +
    localWeight * local +
    lexicalWeight * lexical +
    modeWeight * modePreference +
    adjacencyWeight * adjacency;

  // Explicit positive controls should beat a superficially stronger embedding.
  if (genreFit.match) score += 0.15;
  else if (genreFit.known) score -= 0.18;

  if (moodFit.match) score += 0.13;
  else if (moodFit.suggestive?.length) score += 0.08;
  else if (moodFit.known) score -= 0.20;

  const goalEvidence=moodStyleSignal(candidate,body);
  score+=goalEvidence.bonus-goalEvidence.penalty;
  const relationshipEvidence=relationshipStyleFit(candidate,body);
  score+=relationshipEvidence.bonus-relationshipEvidence.penalty;

  const energyDistance = reliableEnergyDistance(candidate, body);
  if (energyDistance !== null && energyDistance <= 1.5) score += 0.07;

  const area=geographyFit(candidate,body);
  if(area.requestedCountry)score+=area.countryMatch?0.4:(area.known?-0.6:-0.25);
  if(area.excludedCountry)score-=0.85;
  if(area.requestedVocalLanguage)score+=area.vocalMatch?0.35:(area.knownVocalLanguage?-0.5:(plausibleVocalOrigin(candidate,body)?0.12:0));
  if(area.excludedVocalLanguage)score-=0.75;

  score -= energyPenalty(candidate, body);
  score -= compilationPenalty(candidate, body);

  const recentArtists = new Set((body.recentArtists || []).map(value => String(value).toLowerCase()));
  if (recentArtists.has(String(candidate.artist || '').toLowerCase())) score -= 0.22;

  if (genreConflict(candidate, avoidGenres)) score -= 0.62;
  if (moodConflict(candidate, avoidMoods)) score -= 0.48;

  const maxRuntime = body.time == null ? NaN : Number(body.time);
  const duration = candidate.duration == null ? NaN : Number(candidate.duration);
  if (Number.isFinite(maxRuntime) && Number.isFinite(duration)) {
    if (duration > maxRuntime) {
      score -= Math.min(0.48, 0.11 + (duration - maxRuntime) / 62);
    } else if (duration <= maxRuntime + 2) {
      score += 0.035;
    }
  }

  // Personal taste stays a prior, never the main retrieval objective.
  if (learnedTaste.confidence > 0) {
    const modeFactor = body.comfort === 'comfort' ? 1.15 : body.comfort === 'exploration' ? 0.72 : 0.9;
    score += 0.11 * learnedTaste.confidence * learnedTaste.score * modeFactor;
  }

  return score;
}

// Lightweight maximal marginal relevance (MMR) for a short recommendation shelf.
// The top-ranked album stays first; later slots trade some score for discovery.
// pairSimilarity returns cosine similarity when stored neural vectors are available.
export function diverseTopK(ranked, limit=5, pairSimilarity=()=>0) {
  if (!Array.isArray(ranked) || !ranked.length || limit<1) return [];
  const remaining=ranked.slice(0,Math.min(48,ranked.length));
  const chosen=[remaining.shift()];
  while(chosen.length<limit&&remaining.length){
    let bestIndex=0,bestValue=-Infinity;
    for(let i=0;i<remaining.length;i++){
      const candidate=remaining[i];
      const artist=String(candidate.candidate?.artist||'').toLowerCase().trim();
      let similarity=0,repeatArtist=false;
      for(const previous of chosen){
        if(artist&&artist===String(previous.candidate?.artist||'').toLowerCase().trim())repeatArtist=true;
        const pair=Number(pairSimilarity(candidate,previous));
        if(Number.isFinite(pair))similarity=Math.max(similarity,Math.max(0,Math.min(1,pair)));
      }
      const value=Number(candidate.score||0)-0.12*similarity-(repeatArtist?0.22:0);
      if(value>bestValue){bestValue=value;bestIndex=i}
    }
    chosen.push(remaining.splice(bestIndex,1)[0]);
  }
  return chosen;
}

export function explanation(row, body) {
  const candidate = row?.candidate || {};
  const bits = [];
  const relationship=relationshipStyleFit(candidate,body);
  if(relationship.active){
   const style=relationship.evidence[0];
   if(relationship.verifiedMood)return 'Catalogued with a reflective or melancholic mood; the lyrics have not been checked.';
   if(style)return 'Filed under '+style+'; a quieter direction, though the emotional fit is not verified.';
   return 'A tentative match. The catalog cannot verify whether its music fits this particular feeling.';
  }

  const moodFit = requestedMoodFit(candidate, body);
  if (moodFit.match) bits.push(...moodFit.matched.slice(0, 1));

  const energyDistance = reliableEnergyDistance(candidate, body);
  if (energyDistance !== null && energyDistance <= 2) {
    const label = energyLabel(body.energy);
    if (label.includes('very low') || label.includes('low energy')) bits.push('low energy');
    else if (label.includes('very high') || label.includes('high energy')) bits.push('high energy');
    else bits.push('medium energy');
  }

  const genreFit = requestedGenreFit(candidate, body);
  if (genreFit.match) bits.push(...genreFit.matched.slice(0, 1));
  const area=geographyFit(candidate,body);

  const adjacency = Number(candidate.tasteAdjacency) || 0;
  const familiarity = Number(candidate.familiarity) || 0;
  if (adjacency >= 0.35 && familiarity < 0.25) bits.push('taste-neighbor');
  if (row?.taste?.confidence >= 0.2 && row?.taste?.score > 0.08) bits.push('learned taste');

  if (body.comfort === 'comfort' && familiarity >= 0.25) bits.push('known artist');
  if (body.comfort === 'exploration' && familiarity < 0.25 && adjacency < 0.35) bits.push('new artist');

  const maxRuntime = body.time == null ? NaN : Number(body.time);
  const duration = candidate.duration == null ? NaN : Number(candidate.duration);
  if (Number.isFinite(maxRuntime) && Number.isFinite(duration) && duration > 0 && duration <= maxRuntime + 3) {
    bits.push(`${Math.round(duration)} min`);
  }

  const unique = [...new Set(bits.filter(Boolean))].slice(0,3);
  const areaNames={BR:'Brazil',NL:'the Netherlands',PT:'Portugal',BE:'Belgium',DE:'Germany',
   FR:'France',ES:'Spain',JP:'Japan',AR:'Argentina',NG:'Nigeria',UA:'Ukraine'};
  if(area.requestedVocalLanguage&&!area.vocalMatch){
   const hint=plausibleVocalOrigin(candidate,body);
   const sound=area.countryMatch||hint
    ? `Artist associated with ${areaNames[candidate.originCountry]||candidate.originCountry}. `
    : '';
   return sound+'The catalog cannot verify the language sung on this album.';
  }
  if(area.countryMatch){
   const where=areaNames[candidate.originCountry]||candidate.originCountry;
   const genre=requestedGenreFit(candidate,body).matched[0];
   return `Artist associated with ${where}${genre?' · catalog tags include '+genre:''}.`;
  }
  if(area.requestedCountry&&!area.countryMatch){
   return 'The catalog cannot verify an artist-origin match for this request.';
  }
  const genre=genreFit.matched[0];
  const mood=moodFit.matched[0];
  if(genre&&mood)return `Catalog tags: ${genre} and ${mood}.`;
  if(genre&&moodFit.suggestive?.length){
    return `Catalogued as ${genre}; its style also suggests ${moodFit.suggestive[0]}, though that mood isn't independently verified.`;
  }
  if(genre)return `Its catalog tags include ${genre}.`;
  if(mood)return `The catalog includes ${mood} among its mood tags.`;
  if(moodFit.suggestive?.length){
    const matchingStyles=cleanArray(candidate.genres,12).filter(g=>
      /dream pop|ethereal wave|shoegaze|ambient pop|chillwave|hypnagogic pop|downtempo|chillout|new age|lounge|ambient|minimal ambient|slowcore|dark ambient|darkwave|gothic rock|dance.punk|dance pop/i.test(g)
    );
    const style=matchingStyles[0]||'its listed genres';
    return `${style} suggests ${moodFit.suggestive[0]} music, but the mood is not independently verified.`;
  }
  if(unique.length)return `Matched on ${unique.join(' and ')}.`;
  if(moodFit.requested)return 'Its sound may suit your note, but the catalog has no verified mood tags.';
  return 'Selected using catalog similarity; more descriptive tags are not available.';
}
