# MedicHall — Proje Devir Teslim Dokümanı
*Bu dokümanı okuyan Claude: aşağıdaki her şey benimle (Ali Kaan) önceki uzun bir Claude oturumunda inşa edildi ve büyük kısmı CANLIDA çalışıyor. Sıfırdan öneri yapma; bu mevcut sistemin üzerine devam ediyoruz.*

---

## 1. BEN KİMİM, PROJE NE?

- **Ali Kaan** — İzmir merkezli girişimci. **Kod bilmiyorum**; teknik işlerin tamamını Claude ile yürütüyorum. Dilamed Tıbbi Ürünler A.Ş. (İzmir, medikal üretici) bağlantım var.
- **MedicHall (medichall.com)** — Medikal sektör için **AI destekli B2B platformu**. Konumlandırma artık **global/Avrupa** ("The AI marketplace for medical manufacturers"), Türkiye-odaklı DEĞİL.
- Üç ürün ayağı: **(1) Tender Intelligence** — AB medikal ihalelerini her sabah çekip firmaya göre skorlar, AI dokümanı okur; **(2) Business Matchmaking** — üretici↔distribütör↔alıcı iki taraflı eşleştirme; **(3) Dijital pazaryeri** — showroom, ürün kataloğu, RFQ, mesajlaşma.

## 2. TEKNİK MİMARİ

- **Hosting:** GoDaddy cPanel — statik HTML dosyaları, **elle yükleme** (CI/CD yok). Yüklemeden sonra tarayıcıda **Ctrl+F5** şart (önbellek).
- **Backend:** Supabase — proje: `azdmuarzntzqdyirysux` (URL: https://azdmuarzntzqdyirysux.supabase.co). DB + Edge Functions + Storage. Anon key: `sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-`
- **AI:** Anthropic API. Chat/çeviri/asistan → **claude-haiku-4-5**; doküman motoru → **claude-sonnet-4-6** (DOC_ENGINE_MODEL→ANTHROPIC_MODEL→varsayılan zinciri).
- **E-posta:** Resend (kurulu, henüz bildirim özelliği yazılmadı).
- **GitHub:** `kaanakgun96/medichall`, `develop` branch. **DİKKAT: repo çoğu zaman canlının GERİSİNDE.** Gerçek güncel dosyalar GoDaddy'de. Kural: değişiklik yapmadan önce mutlaka CANLI dosyayı benden iste.
- **Portal oturumu:** `mh_p_token` + `mh_p_refresh` (localStorage). 401'de otomatik token yenileme portala gömülü.

## 3. SAYFALAR (canlıdaki durum)

### index.html — Ana sayfa
- **Profesyonel tasarım dili:** Inter fontu, emoji YOK (hepsi SVG çizgi ikon), gradient minimum, 8px köşe, WCAG AA kontrast. MedicalExpo seviyesinde ciddi B2B görünümü hedeflendi ve onaylandı.
- Hero: "Medical Business. Connected." + üç katmanlı platform kartı mockup'ı.
- **Canlı ölçek bandı:** `medichall_public_stats()` RPC'sinden GERÇEK sayılar (ihale sayısı, ülke sayısı, ürün sayısı + "Daily"); sayarak belirir; veri yoksa bant HİÇ görünmez (sahte rakam asla).
- "Why companies use MedicHall" (4 sütun editoryal), 5 adımlı How it works, animasyonlu Matchmaking akışı (Manufacturer → AI → Distributor → Business), yatay kaydırmalı Featured products rayı, firma kartları (DB'den canlı).
- Menü: Products · Manufacturers · Tenders(NEW) · Matchmaking(NEW) · How it works. Insights/Contact footer'da.
- **Hibrit asistan** (sağ alt): kalıp sorular kurallı+bedava; serbest sorular `public-assistant` Edge Function'a (Claude Haiku, IP başına 30dk'da 6 soru limiti, konu bekçisi, CORS kilitli).

### portal.html — Partner portalı (en büyük dosya, ~2200 satır)
- **Dashboard** (varsayılan sekme): karşılama bandı, 4 metrik kartı, top 3 eşleşme, profil hazırlık ölçeri + yapılacaklar.
- **Opportunities — İKİ MOD:** 🎯 **My matches** (profile göre skorlanmış; arama/tür/ülke/min-skor filtreleri, çok dilli arama — eşleşme nedenleri de taranır) ve 🌍 **All tenders** (beslemenin TAMAMI, sunucu taraflı arama + ülke filtresi + 20'şerli sayfalama). Boş eşleşme aramasında beslemeye tek tık köprü butonu.
- **Derin Analiz / İhale Detay ekranı:** Opportunity Score kartı (skor + hüküm + 4 GERÇEK mini gösterge: Product/Country/CPV/Certificates), AI Executive Summary, **tıklanabilir lot kartları** (lot→ürün eşleştirmesi rakam-normalize), **rozetli+tıklanabilir ürün tablosu** (satır açılınca tüm alanlar + sayfa numaralı kanıt alıntıları), Requirements check (🟢/🟡 sertifika kıyası firmanın profiliyle), "Why this tender fits you" anlatısı, next actions.
- **🌐 Translate to English:** istek üzerine (otomatik değil); özet+lotlar+tablo+narrative çevrilir, kanıt alıntıları İSPAT değeri için orijinal dilde kalır; önbellekli toggle.
- **📎 Kendi Dokümanını Getir (BYOD):** motor yalnızca bildirimi okuyabildiyse çıkan kutu — portal linki + kopyalanabilir referans + PDF yükleme (8 dosya/20MB); dosyalar `tender-documents` bucket'ına gider, RPC ile kaydedilir, motor otomatik yeniden koşar.
- RFQ inbox, ürünler, kataloglar, sertifikalar, AI asistan sekmeleri de yerinde.

### matchmaking.html
- İki taraflı eşleştirme MVP (GPT üretti, Claude doğrulayıp onardı). Portal profilinden **otomatik ön-doldurma** (companies + company_match_profiles → form; yeşil bilgi bandı). Logo portalla birebir (koyu zeminde MEDIC açık turkuaz / HALL beyaz).

### Marka
- Logo: 3 sütun **M**, aradaki boşluklar **H** oluşturur (negatif alan). Küçük boyutta (favicon) H kaybolabilir — bilinen not.

## 4. EDGE FUNCTIONS (deploy durumu + JWT)

| Fonksiyon | İş | Verify JWT |
|---|---|---|
| `medichall-ai` | Portal chat/çeviri (Haiku), günlük limit + `medichall_ai_usage` log | AÇIK |
| `ted-sync` **v1.3** | TED Search API v3'ten günlük çekim. **Varsayılan: TÜM AB** (profil-bazlı ülke kısıtı v1.3'te kaldırıldı). Opsiyonel `TED_COUNTRIES` secret ile daraltma. Elle tetiklemede body override: `{"lookback_days":30,"max_pages":10}`. pg_cron 06:30 UTC. `x-cron-secret` başlığı + CRON_SECRET | KAPALI |
| `tender-document-engine` **v2.6** | Derin analiz motoru. Kayıtlı doküman varsa onları; yoksa **resmi TED bildirim PDF'i** (`ted.europa.eu/en/notice/{pub}/pdf`) + Search API yapılandırılmış verisi. Çıktı: products(+evidence), lots(+catalog_fit_score+fit_reason, firma bağlamıyla), summary, fit_narrative, missing_information. Büyük ihale zırhı: 16k token, 30 lot sınırı, kesilmede otomatik 2. deneme, toleranslı JSON ayıklama | AÇIK |
| `ted-notice-resolver`, `tender-attachment-discovery`, `tender-archive-worker` | Doküman keşif/arşiv altyapısı (GPT). Deploy'lu ama **tık yolundan çıkarıldı** — derin analiz artık motor-öncelikli 2 adım (~30-60sn) | AÇIK |
| `public-assistant` | Ana sayfa hibrit asistanının Claude ayağı. IP limiti (`public_assistant_usage` tablosu), 500 kr girdi sınırı, konu bekçisi, CORS medichall.com | KAPALI |

Secrets: `ANTHROPIC_API_KEY`, `CRON_SECRET`, opsiyonel: `ANTHROPIC_MODEL`, `DOC_ENGINE_MODEL`, `TED_COUNTRIES`, `TED_LOOKBACK_DAYS`, `TED_MAX_PAGES`, `TED_CPV`, `PUBLIC_AI_MODEL/IP_LIMIT/WINDOW_MIN`.

## 5. VERİTABANI (kurulu migration/RPC özeti)

- Temel: companies, products, catalogs, certificates, rfq'lar, buyer tarafı (supabase-portal-v2 serisi).
- Match engine: `company_match_profiles`, `opportunity_matches`, `refresh_company_opportunity_matches` (v2 skorlama: keyword metin araması + ağırlık yeniden dağıtımı + status koruyan upsert), `set_opportunity_match_status`.
- **CPV yaması:** `cpv_overlap_score()` — kodları normalize eder (rakamları ayıkla, İLK 8 hane; "33190000-8"→"33190000") + **hiyerarşik aile eşleşmesi** (33190000 → 33192000 ✓).
- Doküman motoru seti (0005_explainable→0008, MOTOR-KURULUM-TEK-SEFERDE.sql ile kuruldu): tenders'a analiz kolonları (extracted_products, ai_lots, document_analysis_notes, procurement_documents_url...), tender_documents, analysis/discovery/archive job tabloları, `queue_tender_document_analysis` (sıfır dokümanla iş kabul eder — 3-YAMA), storage bucket `tender-documents`; `opportunity_matches.fit_narrative`.
- Matchmaking: 4 tablo + 8 fonksiyon (202607120001).
- `medichall_public_stats()` — ana sayfa sayaçları (yalnız toplam döner, anon'a açık).
- `register_uploaded_tender_documents()` + storage insert policy (BYOD; DOKUMAN-YUKLEME.sql).
- `public_assistant_usage` (IP limiti), `medichall_ai_usage` (token log).

## 6. ÖNEMLİ ÜRÜN KARARLARI (değiştirme!)

1. **Sahte metrik/rakam ASLA yok.** "Coming soon 380 üretici", "Packaging Match %100" gibi hesaplanamayan her şey reddedildi. Sayaçlar gerçek DB verisi; veri yoksa gizlenir. Platformun satış vaadi "AI uydurmaz, kanıt gösterir" — ana sayfa da buna uymak zorunda.
2. **robots.txt'ye saygı.** Ulusal portallar (eAppalti FVG canlı testle doğrulandı) botları yasaklıyor; scraper/adaptör YAZILMADI. Çözüm BYOD: kullanıcı dokümanı indirir, sürükler, motor okur — her portalda çalışır, hukuki risk sıfır.
3. **Skorlama ≠ filtre.** Eşleştirme motoru ihaleleri elemez, puanlar; keşif için ayrı 🌍 mod var. Profil değişince **Find matches**'e basmak şart.
4. **Kanıt alıntıları hep orijinal dilde** (çeviri açıkken bile) — ihale ispatı orijinalindedir.
5. GPT ile çalışma deseni: **fikir/taslak GPT'den gelebilir ama dosyaları OLDUĞU GİBİ yüklenmez** — mevcut sistemi görmeden ürettiği için özellik siler/isim çakıştırır. Önce Claude inceler, işe yarayanı mevcut yapıya taşır.

## 7. ÇALIŞMA KURALLARI (Claude için)

- Her SQL **yerel PostgreSQL'de** test edilip verilir; her TS **esbuild**'den geçirilir; portal JS'i sözdizimi kontrolünden geçer; kritik UI değişiklikleri playwright ekran görüntüsü/ölçümle doğrulanır.
- Teslim formatı: **tek zip + Türkçe OKUBENI/KURULUM.md**, hazır-deploy tam dosyalar (snippet değil).
- **Canlı dosya alınmadan var olan sayfa düzenlenmez** (bir kez ana sayfa hero'su bu yüzden ezildi — ders alındı).
- Dil: Türkçe, samimi; teknik kararların GEREKÇESİ anlatılır; kötü fikirlere (GPT'den gelse bile) açıkça itiraz edilir.

## 8. BEKLEYENLER / SIRADAKİLER

- [ ] **GitHub develop senkronu** — birçok güncel dosya sadece GoDaddy'de; repo geride. Yedek riski!
- [ ] Son paketlerin kurulum teyidi: ted-sync v1.3 deploy + BESLEME-DOLDUR.sql (30 gün tüm AB), DOKUMAN-YUKLEME.sql, portal.html son sürüm, akıllı asistan (public-assistant + migration + index).
- [ ] E-posta bildirimi: %80+ yeni eşleşmede (Resend hazır, az iş, yüksek değer).
- [ ] "Tender Chat": ihale bağlamında soru-cevap (bildirim metni + chat fonksiyonu hazır, kurulmadı).
- [ ] "Business DNA" konumlandırması: matchmaking'in mevcut alanlarını (hepsi zaten var) bu isimle pazarlamak — altyapı değil anlatım işi.
- [ ] Profesyonel tasarım dilinin portal.html + matchmaking.html'e taşınması.
- [ ] products tablosundan matchmaking'e gerçek ürün adları çekme.
- [ ] Küçük boyut için logo varyantı (favicon'da H okunmuyor olabilir).
- Rafta (bilerek ertelendi): Win Probability / Competitor Intelligence (gerçek sonuç verisi birikince), PWA/mobil uygulama ("boşver" denildi).

## 9. BİLİNEN HASSAS NOKTALAR

- Fonksiyon deploy'unda **Verify JWT ayarı** tabloya uygun olmalı (ted-sync ve public-assistant KAPALI, diğerleri AÇIK) — en sık kurulum hatası bu.
- SQL'ler tekrar çalıştırmaya dayanıklı yazılır; "column does not exist" görülürse ilgili kurulum SQL'i atlanmış demektir.
- TED bildirim sayfası JS uygulamasıdır — HTML kazınmaz; veri Search API veya resmi bildirim PDF'inden alınır.
- Derin analizde lot kartları/fit anlatısı yalnızca **yeni** analizlerde dolar (eski analizler o alanları üretmedi).

*Doküman sonu — bu noktadan sonrası yeni oturumun işi. Kolay gelsin! 🚀*
