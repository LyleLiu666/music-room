// Instrumental entries use bare, untimed tags; vocal entries put original lyrics below section tags.
export const yue2Examples = [
  {
    instrumental: true,
    name: '钢琴 R&B', title: '雨夜来信',
    description: '清晰的两小节钢琴主题，切分鼓点和温暖贝斯；副歌展开，回到主题时有变化。',
    style: 'Instrumental mandopop piano R&B, intimate and melodic, 88 BPM. A memorable two-bar piano riff anchors the song, with warm electric bass, syncopated soft drums and subtle strings. Answer the main motif with short melodic phrases and pauses. Start with solo piano, bring in bass and drums in the verse, broaden the chorus, then return to a varied piano motif with a natural ending. No vocals, no singing.',
    lyrics: '[intro]\n[verse]\n[chorus]\n[outro]',
  },
  {
    instrumental: true,
    name: '古筝与钢琴', title: '竹影',
    description: '古筝与钢琴轮流应答，五声音阶旋律；先留白，再由弦乐推动高潮。',
    style: 'Instrumental Chinese-inspired cinematic pop, lyrical and spacious, 76 BPM. Guzheng and acoustic piano exchange a memorable pentatonic melody, supported by warm bass, restrained percussion and soft strings. Begin sparsely with guzheng, introduce a piano answering phrase, build a fuller string-backed chorus, leave a quiet interlude, then bring back the theme with ornamental variations and a gentle ending. No vocals, no singing.',
    lyrics: '[intro]\n[verse]\n[chorus]\n[interlude]\n[chorus]\n[outro]',
  },
  {
    instrumental: true,
    name: '松弛爵士', title: '午后咖啡',
    description: '电钢琴、低音提琴和轻刷鼓，舒缓但有明确旋律；中段换一个回答句。',
    style: 'Instrumental mellow jazz with a relaxed hip-hop groove, cozy and unhurried, 82 BPM. Warm electric piano carries a clear four-bar melody over upright bass and brushed drums. Use rich seventh chords, gentle swing and small melodic variations. Introduce the theme, develop a contrasting answering phrase in the middle, and return to the main melody with lighter accompaniment and a soft final chord. No vocals, no singing.',
    lyrics: '[intro]\n[verse]\n[bridge]\n[verse]\n[outro]',
  },
  {
    instrumental: true,
    name: '轻快律动', title: '周末出发',
    description: '切分吉他、灵活贝斯与明亮键盘；主段有节奏钩子，中段留白后再回归。',
    style: 'Instrumental upbeat funk pop, bright and playful, 108 BPM. A catchy syncopated guitar riff locks with a melodic electric bass line and tight drums. Bright keyboard phrases answer the guitar hook. Keep the verse light, expand the chorus with layered keys and rhythmic accents, create a brief stripped-down bridge, then return to the hook with fills and a decisive ending. No vocals, no singing.',
    lyrics: '[intro]\n[verse]\n[chorus]\n[bridge]\n[chorus]\n[outro]',
  },
  {
    instrumental: false,
    name: '中文男声 R&B', title: '夜行信号',
    description: '温暖男声唱原创中文歌词，钢琴主题与切分鼓点；主歌克制，副歌更开阔。',
    style: 'Mandarin piano R&B ballad, warm intimate male lead vocal, tender and hopeful, 88 BPM. A memorable two-bar piano riff, syncopated soft drums, rounded electric bass and subtle strings. Clear melodic singing with space between phrases, a restrained verse and a soaring but gentle chorus. Introduce the hook on piano, build the arrangement gradually, and end softly with the piano motif.',
    lyrics: '[Intro]\n\n[Verse]\n末班车经过路口\n晚风吹过我的手\n那句没说完的话\n还在灯下等回答\n\n[Pre-Chorus]\n把沉默折成纸船\n让它沿着夜色转\n\n[Chorus]\n留一盏灯等风来\n让心事慢慢展开\n隔着雨也听得见\n你说的明天\n留一盏灯等风来\n把遗憾轻轻放开\n走过漫长的街沿\n向有你的明天\n\n[Outro]\n向有你的明天',
  },
  {
    instrumental: false,
    name: '中文女声民谣', title: '风来时',
    description: '清澈女声、木吉他和轻打击乐，歌词讲从忙碌中慢下来；副歌有简单的记忆点。',
    style: 'Mandarin acoustic folk pop, clear gentle female lead vocal, calm and uplifting, 78 BPM. Fingerpicked acoustic guitar, soft piano, warm bass and understated percussion. Natural melodic singing, a simple memorable chorus, intimate verses with pauses, and a slightly fuller final chorus. Start with acoustic guitar and end with a gentle sustained chord.',
    lyrics: '[Intro]\n\n[Verse]\n收起桌上的纸张\n推开朝南的小窗\n阳光落在旧木椅\n时间慢得刚刚好\n\n[Chorus]\n风来时就慢一点\n听一听树的语言\n不必追赶每一天\n路就在脚边\n风来时就慢一点\n把心放回这瞬间\n所有平凡的晴天\n都值得留恋\n\n[Bridge]\n走远了也能回望\n小小的家有微光\n\n[Chorus]\n风来时就慢一点\n听一听树的语言\n所有平凡的晴天\n都值得留恋\n\n[Outro]\n都值得留恋',
  },
  {
    instrumental: false,
    name: '英文女声 City Pop', title: 'Morning Light',
    description: '明亮英文女声、弹跳贝斯和电钢琴；轻快城市流行，副歌围绕 Morning light 展开。',
    style: 'English city pop, bright smooth female lead vocal, upbeat and optimistic, 104 BPM. Groovy electric bass, clean rhythm guitar, warm electric piano, subtle synth brass and crisp drums. Melodic verses and a catchy chorus centered on the phrase morning light. Keep the groove light, add answering keyboard phrases, lift the final chorus, and finish with a clean band ending.',
    lyrics: '[Intro]\n\n[Verse]\nCoffee warming in my hands\nSunlight dancing on the blinds\nYesterday can take its time\nThere is room for you in mine\n\n[Pre-Chorus]\nTake a breath and step outside\nLet the rhythm be our guide\n\n[Chorus]\nMorning light, carry me\nThrough the streets and to the sea\nEvery turn can start anew\nEvery road leads back to you\nMorning light, stay awhile\nLet the city learn to smile\nWe have nowhere else to be\nMorning light, walk with me\n\n[Outro]\nMorning light, walk with me',
  },
] as const;
