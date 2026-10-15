// i18n (round 7, FEATURE_I18N). Auto-detects the browser language, can be overridden in Settings › Language
// (saved on the device and the account). Arabic switches the layout to right-to-left.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export const LANGS: { code: string; name: string; native: string }[] = [
  { code: 'en', name: 'English', native: 'English' }, { code: 'es', name: 'Spanish', native: 'Español' }, { code: 'fr', name: 'French', native: 'Français' },
  { code: 'pt', name: 'Portuguese', native: 'Português' }, { code: 'ar', name: 'Arabic', native: 'العربية' }, { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' }, { code: 'ru', name: 'Russian', native: 'Русский' }, { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' }, { code: 'de', name: 'German', native: 'Deutsch' }, { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' }, { code: 'sw', name: 'Swahili', native: 'Kiswahili' }, { code: 'yo', name: 'Yoruba', native: 'Yorùbá' },
  { code: 'ha', name: 'Hausa', native: 'Hausa' }, { code: 'ig', name: 'Igbo', native: 'Igbo' },
];
const KEYS = ['home', 'search', 'create', 'marketplace', 'profile', 'notifications', 'messages', 'reels', 'settings', 'events',
  'language', 'autoDetect', 'send', 'messagePh', 'translate', 'seeOriginal', 'forYou', 'following', 'trending', 'newMessage',
  'searchPeople', 'typing', 'seen', 'darkMode', 'lightMode', 'memories', 'challenges', 'cancel', 'save', 'like', 'comment', 'share', 'noMessages', 'chats'] as const;
export type TKey = typeof KEYS[number];
const D: Record<string, string[]> = {
  en: ['Home', 'Search', 'Create', 'Marketplace', 'Profile', 'Notifications', 'Messages', 'Reels', 'Settings', 'Events', 'Language', 'Use my device language', 'Send', 'Message…', 'See translation', 'See original', 'For you', 'Following', 'Trending', 'New message', 'Search people', 'typing…', 'Seen', 'Dark mode', 'Light mode', 'Memories', 'Challenges', 'Cancel', 'Save', 'Like', 'Comment', 'Share', 'No messages yet. Say hi!', 'Chats'],
  es: ['Inicio', 'Buscar', 'Crear', 'Marketplace', 'Perfil', 'Notificaciones', 'Mensajes', 'Reels', 'Configuración', 'Eventos', 'Idioma', 'Usar el idioma del dispositivo', 'Enviar', 'Mensaje…', 'Ver traducción', 'Ver original', 'Para ti', 'Siguiendo', 'Tendencias', 'Nuevo mensaje', 'Buscar personas', 'escribiendo…', 'Visto', 'Modo oscuro', 'Modo claro', 'Recuerdos', 'Retos', 'Cancelar', 'Guardar', 'Me gusta', 'Comentar', 'Compartir', 'Aún no hay mensajes. ¡Saluda!', 'Chats'],
  fr: ['Accueil', 'Rechercher', 'Créer', 'Marketplace', 'Profil', 'Notifications', 'Messages', 'Reels', 'Paramètres', 'Événements', 'Langue', 'Utiliser la langue de l’appareil', 'Envoyer', 'Message…', 'Voir la traduction', 'Voir l’original', 'Pour vous', 'Abonnements', 'Tendances', 'Nouveau message', 'Rechercher des personnes', 'écrit…', 'Vu', 'Mode sombre', 'Mode clair', 'Souvenirs', 'Défis', 'Annuler', 'Enregistrer', 'J’aime', 'Commenter', 'Partager', 'Pas encore de messages. Dites bonjour !', 'Discussions'],
  pt: ['Início', 'Pesquisar', 'Criar', 'Marketplace', 'Perfil', 'Notificações', 'Mensagens', 'Reels', 'Configurações', 'Eventos', 'Idioma', 'Usar o idioma do dispositivo', 'Enviar', 'Mensagem…', 'Ver tradução', 'Ver original', 'Para você', 'Seguindo', 'Em alta', 'Nova mensagem', 'Pesquisar pessoas', 'digitando…', 'Visto', 'Modo escuro', 'Modo claro', 'Lembranças', 'Desafios', 'Cancelar', 'Salvar', 'Curtir', 'Comentar', 'Compartilhar', 'Nenhuma mensagem ainda. Diga oi!', 'Conversas'],
  ar: ['الرئيسية', 'بحث', 'إنشاء', 'المتجر', 'الملف الشخصي', 'الإشعارات', 'الرسائل', 'ريلز', 'الإعدادات', 'الفعاليات', 'اللغة', 'استخدم لغة جهازي', 'إرسال', 'رسالة…', 'عرض الترجمة', 'عرض الأصل', 'لك', 'المتابَعون', 'الرائج', 'رسالة جديدة', 'ابحث عن أشخاص', 'يكتب…', 'تمت المشاهدة', 'الوضع الداكن', 'الوضع الفاتح', 'الذكريات', 'التحديات', 'إلغاء', 'حفظ', 'إعجاب', 'تعليق', 'مشاركة', 'لا توجد رسائل بعد. قل مرحبًا!', 'الدردشات'],
  hi: ['होम', 'खोजें', 'बनाएँ', 'मार्केटप्लेस', 'प्रोफ़ाइल', 'सूचनाएँ', 'संदेश', 'रील्स', 'सेटिंग्स', 'इवेंट', 'भाषा', 'मेरे डिवाइस की भाषा', 'भेजें', 'संदेश…', 'अनुवाद देखें', 'मूल देखें', 'आपके लिए', 'फ़ॉलोइंग', 'ट्रेंडिंग', 'नया संदेश', 'लोगों को खोजें', 'लिख रहे हैं…', 'देखा गया', 'डार्क मोड', 'लाइट मोड', 'यादें', 'चैलेंज', 'रद्द करें', 'सहेजें', 'पसंद', 'टिप्पणी', 'शेयर', 'अभी कोई संदेश नहीं। नमस्ते कहें!', 'चैट'],
  zh: ['首页', '搜索', '创建', '市场', '个人主页', '通知', '消息', '短视频', '设置', '活动', '语言', '使用设备语言', '发送', '发消息…', '查看翻译', '查看原文', '推荐', '关注', '热门', '新消息', '搜索用户', '正在输入…', '已读', '深色模式', '浅色模式', '回忆', '挑战', '取消', '保存', '赞', '评论', '分享', '还没有消息，打个招呼吧！', '聊天'],
  ru: ['Главная', 'Поиск', 'Создать', 'Маркетплейс', 'Профиль', 'Уведомления', 'Сообщения', 'Reels', 'Настройки', 'События', 'Язык', 'Язык устройства', 'Отправить', 'Сообщение…', 'Показать перевод', 'Показать оригинал', 'Для вас', 'Подписки', 'В тренде', 'Новое сообщение', 'Поиск людей', 'печатает…', 'Просмотрено', 'Тёмная тема', 'Светлая тема', 'Воспоминания', 'Челленджи', 'Отмена', 'Сохранить', 'Нравится', 'Комментировать', 'Поделиться', 'Сообщений пока нет. Поздоровайтесь!', 'Чаты'],
  id: ['Beranda', 'Cari', 'Buat', 'Marketplace', 'Profil', 'Notifikasi', 'Pesan', 'Reels', 'Pengaturan', 'Acara', 'Bahasa', 'Gunakan bahasa perangkat', 'Kirim', 'Pesan…', 'Lihat terjemahan', 'Lihat asli', 'Untuk Anda', 'Mengikuti', 'Trending', 'Pesan baru', 'Cari orang', 'mengetik…', 'Dilihat', 'Mode gelap', 'Mode terang', 'Kenangan', 'Tantangan', 'Batal', 'Simpan', 'Suka', 'Komentar', 'Bagikan', 'Belum ada pesan. Sapa dulu!', 'Obrolan'],
  tr: ['Ana sayfa', 'Ara', 'Oluştur', 'Pazar Yeri', 'Profil', 'Bildirimler', 'Mesajlar', 'Reels', 'Ayarlar', 'Etkinlikler', 'Dil', 'Cihaz dilini kullan', 'Gönder', 'Mesaj…', 'Çeviriyi gör', 'Orijinali gör', 'Senin için', 'Takip edilenler', 'Gündem', 'Yeni mesaj', 'Kişi ara', 'yazıyor…', 'Görüldü', 'Karanlık mod', 'Aydınlık mod', 'Anılar', 'Meydan okumalar', 'İptal', 'Kaydet', 'Beğen', 'Yorum yap', 'Paylaş', 'Henüz mesaj yok. Merhaba de!', 'Sohbetler'],
  de: ['Start', 'Suche', 'Erstellen', 'Marktplatz', 'Profil', 'Benachrichtigungen', 'Nachrichten', 'Reels', 'Einstellungen', 'Veranstaltungen', 'Sprache', 'Gerätesprache verwenden', 'Senden', 'Nachricht…', 'Übersetzung anzeigen', 'Original anzeigen', 'Für dich', 'Gefolgt', 'Im Trend', 'Neue Nachricht', 'Personen suchen', 'schreibt…', 'Gesehen', 'Dunkelmodus', 'Hellmodus', 'Erinnerungen', 'Challenges', 'Abbrechen', 'Speichern', 'Gefällt mir', 'Kommentieren', 'Teilen', 'Noch keine Nachrichten. Sag Hallo!', 'Chats'],
  ja: ['ホーム', '検索', '作成', 'マーケット', 'プロフィール', 'お知らせ', 'メッセージ', 'リール', '設定', 'イベント', '言語', '端末の言語を使う', '送信', 'メッセージ…', '翻訳を見る', '原文を見る', 'おすすめ', 'フォロー中', 'トレンド', '新規メッセージ', 'ユーザーを検索', '入力中…', '既読', 'ダークモード', 'ライトモード', '思い出', 'チャレンジ', 'キャンセル', '保存', 'いいね', 'コメント', 'シェア', 'まだメッセージはありません。あいさつしましょう！', 'チャット'],
  ko: ['홈', '검색', '만들기', '마켓플레이스', '프로필', '알림', '메시지', '릴스', '설정', '이벤트', '언어', '기기 언어 사용', '보내기', '메시지…', '번역 보기', '원문 보기', '추천', '팔로잉', '인기', '새 메시지', '사람 검색', '입력 중…', '읽음', '다크 모드', '라이트 모드', '추억', '챌린지', '취소', '저장', '좋아요', '댓글', '공유', '아직 메시지가 없어요. 인사해 보세요!', '채팅'],
  sw: ['Nyumbani', 'Tafuta', 'Unda', 'Soko', 'Wasifu', 'Arifa', 'Ujumbe', 'Reels', 'Mipangilio', 'Matukio', 'Lugha', 'Tumia lugha ya kifaa', 'Tuma', 'Ujumbe…', 'Ona tafsiri', 'Ona asili', 'Kwa ajili yako', 'Unaowafuata', 'Zinazovuma', 'Ujumbe mpya', 'Tafuta watu', 'anaandika…', 'Umeonekana', 'Hali ya giza', 'Hali ya mwanga', 'Kumbukumbu', 'Changamoto', 'Ghairi', 'Hifadhi', 'Penda', 'Toa maoni', 'Shiriki', 'Hakuna ujumbe bado. Sema habari!', 'Mazungumzo'],
  yo: ['Ilé', 'Wá', 'Ṣẹ̀dá', 'Ọjà', 'Profaili', 'Ìfitónilétí', 'Àwọn ìfiránṣẹ́', 'Reels', 'Ètò', 'Ìṣẹ̀lẹ̀', 'Èdè', 'Lo èdè ẹ̀rọ mi', 'Firánṣẹ́', 'Ìfiránṣẹ́…', 'Wo ìtúmọ̀', 'Wo ti àtilẹ̀wá', 'Fún ọ', 'Tí o ń tẹ̀lé', 'Gbajúmọ̀', 'Ìfiránṣẹ́ tuntun', 'Wá àwọn ènìyàn', 'ń kọ̀wé…', 'Ti rí i', 'Ipò dúdú', 'Ipò ìmọ́lẹ̀', 'Ìrántí', 'Ìpèníjà', 'Fagilé', 'Fipamọ́', 'Fẹ́ràn', 'Sọ̀rọ̀', 'Pín', 'Kò sí ìfiránṣẹ́ síbẹ̀. Kí wọn!', 'Ìjíròrò'],
  ha: ['Gida', 'Nema', 'Ƙirƙira', 'Kasuwa', 'Bayanan martaba', 'Sanarwa', 'Saƙonni', 'Reels', 'Saituna', 'Taruka', 'Harshe', 'Yi amfani da harshen na’ura', 'Aika', 'Saƙo…', 'Duba fassara', 'Duba asali', 'Domin ka', 'Waɗanda kake bi', 'Masu tasowa', 'Sabon saƙo', 'Nemi mutane', 'yana rubutu…', 'An gani', 'Yanayin duhu', 'Yanayin haske', 'Abubuwan tunawa', 'Ƙalubale', 'Soke', 'Ajiye', 'So', 'Sharhi', 'Raba', 'Babu saƙonni tukuna. Ka gaisa!', 'Hirarraki'],
  ig: ['Ụlọ', 'Chọọ', 'Mepụta', 'Ahịa', 'Profaịlụ', 'Ọkwa', 'Ozi', 'Reels', 'Ntọala', 'Mmemme', 'Asụsụ', 'Jiri asụsụ ngwaọrụ m', 'Zipu', 'Ozi…', 'Hụ ntụgharị', 'Hụ nke mbụ', 'Maka gị', 'Ndị ị na-eso', 'Na-ewu ewu', 'Ozi ọhụrụ', 'Chọọ ndị mmadụ', 'na-ede…', 'Ahụla', 'Ọnọdụ ọchịchịrị', 'Ọnọdụ ìhè', 'Ncheta', 'Ihe ịma aka', 'Kagbuo', 'Chekwaa', 'Mmasị', 'Kọmenti', 'Kesaa', 'Enweghị ozi ka ugbu a. Kelee!', 'Mkparịta ụka'],
};
const STORE = 'cx-lang';
export function detectLang(): string {
  const saved = localStorage.getItem(STORE); if (saved && D[saved]) return saved;
  for (const l of navigator.languages || [navigator.language]) { const c = (l || '').toLowerCase().split('-')[0]; if (D[c]) return c; }
  return 'en';
}
type Ctx = { lang: string; auto: boolean; setLang: (code: string | null) => void; t: (k: TKey) => string; dir: 'ltr' | 'rtl' };
const I18n = createContext<Ctx>({ lang: 'en', auto: true, setLang: () => {}, t: (k) => D.en[KEYS.indexOf(k)], dir: 'ltr' });
export function I18nProvider({ children, enabled, accountLang }: { children: React.ReactNode; enabled: boolean; accountLang?: string | null }) {
  const [lang, setL] = useState(() => (enabled ? detectLang() : 'en')); const [auto, setAuto] = useState(() => !localStorage.getItem(STORE));
  useEffect(() => { if (enabled && accountLang && D[accountLang] && !localStorage.getItem(STORE)) { localStorage.setItem(STORE, accountLang); setL(accountLang); setAuto(false); } }, [enabled, accountLang]);
  useEffect(() => { if (!enabled) setL('en'); else setL(detectLang()); }, [enabled]);
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = dir; }, [lang, dir]);
  const v = useMemo<Ctx>(() => ({ lang, auto, dir, setLang: (code) => { if (code) localStorage.setItem(STORE, code); else localStorage.removeItem(STORE); setAuto(!code); setL(code || detectLang()); },
    t: (k) => (D[lang] || D.en)[KEYS.indexOf(k)] || D.en[KEYS.indexOf(k)] }), [lang, auto, dir]);
  return <I18n.Provider value={v}>{children}</I18n.Provider>;
}
export const useI18n = () => useContext(I18n);
export const useT = () => useContext(I18n).t;
