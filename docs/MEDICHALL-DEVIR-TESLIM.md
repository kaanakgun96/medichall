# MedicHall — Proje Devir Teslim Dokümanı
*Bu dokümanı okuyan Claude: aşağıdaki her şey benimle (Ali Kaan) önceki Claude oturumlarında inşa edildi ve CANLIDA çalışıyor. Sıfırdan öneri yapma; bu mevcut sistemin üzerine devam ediyoruz.*

*Son güncelleme: 20 Temmuz 2026 — Sprint A/B/C, çeviri hotfix'i, CPV seçici ve İngilizce normalize katmanı dahil. Mimari ayrıntı için `docs/ARCHITECTURE.md`, kurulum adımları için `docs/*-KURULUM.md` dosyalarına bak.*

---

## 1. BEN KİMİM, PROJE NE?

- **Ali Kaan** — İzmir merkezli girişimci. **Kod bilmiyorum**; teknik işlerin tamamını Claude ile yürütüyorum. Dilamed Tıbbi Ürünler A.Ş. (İzmir, medikal üretici) bağlantım var.
- **MedicHall (medichall.com)** — Medikal sektör için **AI destekli B2B platformu**. Konumlandırma artık **global/Avrupa** ("The AI marketplace for medical manufacturers"), Türkiye-odaklı DEĞİL.
- Üç ürün ayağı: **(1) Tender Intelligence** — AB medikal ihalelerini her sabah çekip firmaya göre skorlar, AI dokümanı okur; **(2) Business Matchmaking** — üretici↔distribütör↔alıcı iki taraflı eşleştirme; **(3) Dijital pazaryeri** — showroom, ürün kataloğu, RFQ, mesajlaşma.

## 2. TEKNİK MİMARİ

- **Hosting:** GoDaddy cPanel — statik HTML dosyaları, **elle yükleme** (CI/CD yok). Yüklemeden sonra tarayıcıda **Ctrl+F5** şart (önbellek).
- **Backend:** Supabase — proje: `azdmuarzntzqdyirysux` (URL: https://azdmuarzntzqdyirysux.supabase.co). DB + Edge Functions + Storage. Anon key: `sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-`
- **AI:** Anthropic API. Chat/çeviri/asistan → **claude-haiku-4-5**; doküman motoru → **claude-sonnet-4-6** (DOC_ENGINE_MODEL→ANTHROPIC_MODEL→varsayılan zinciri).
- **E-posta:** Resend — İLK ÖZELLİK CANLI: günlük tender digest (`tender-digest` fonksiyonu, 07:00 UTC). Secrets: `RESEND_API_KEY`, ops. `DIGEST_FROM`. Gönderen domain Resend'de doğrulanmış olmalı.
- **GitHub:** `kaanakgun96/medichall`, `develop` branch. 19-20 Temmuz'da tam senkron yapıldı (commit zinciri: 1a138dd → 1626f47 → ea06eb0 → 4c235de → b7ff662); repo artık canlıyla eşit ve TÜM migration/fonksiyon geçmişini içerir. Kural DEĞİŞMEDİ: yine de var olan bir sayfayı düzenlemeden önce CANLI dosyayı benden iste — elle deploy düzeninde sapma her an olabilir. Push için Ali Kaan kısa ömürlü fine-grained token verir (Contents: Read and write); iş bitince token iptal edilir.
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
- **Opportunities — İKİ MOD:** 🎯 **My matches** (profile göre skorlanmış; arama/tür/ülke/min-skor filtreleri, çok dilli arama — eşleşme nedenleri de taranır) ve 🌍 **All tenders** (beslemenin TAMAMI, `search_tenders()` RPC üzerinden). Boş eşleşme aramasında beslemeye tek tık köprü butonu.
- **All tenders gelişmiş filtreleri (Sprint B):** Filters butonu + panel — CPV ailesi araması ("3319" → 33190000 VE 33192000), deadline aciliyeti (7/30/90 gün), notice type, EUR değer aralığı + **"Value not stated" onay kutusu (varsayılan işaretli — değersiz ihale sessizce elenmez)**. Non-EUR değerler ECB günlük kuruyla "≈ EUR" gösterilir, orijinal değer hep durur.
- **Kayıtlı aramalar (Sprint C):** 💾 Save this search → çip barı; çipe tık = filtreleri uygula, 🔔/🔕 = arama başına günlük e-posta digest aç/kapa, × = sil. RLS: herkes yalnız kendi kayıtları, kullanıcı başına 20 tavan.
- **Profilde CPV seçici:** "Browse catalog" — resmi AB CPV 2008 kataloğu (655 medikal kod, `cpv_catalog`), her ailede beslemedeki GERÇEK açık ihale sayısı; seçimler mevcut metin kutusuna CSV yazılır (kaydet/yükle ve motor değişmedi).
- **İngilizce normalize:** kartlarda orijinal başlığın altında *"EN (machine translation)"* satırı; arama ve keyword skoru İngilizce kolonları da tarar.
- **Derin Analiz / İhale Detay ekranı:** Opportunity Score kartı (skor + hüküm + 4 GERÇEK mini gösterge: Product/Country/CPV/Certificates), AI Executive Summary, **tıklanabilir lot kartları** (lot→ürün eşleştirmesi rakam-normalize), **rozetli+tıklanabilir ürün tablosu** (satır açılınca tüm alanlar + sayfa numaralı kanıt alıntıları), Requirements check (🟢/🟡 sertifika kıyası firmanın profiliyle), "Why this tender fits you" anlatısı, next actions.
- **🌐 Translate to English:** istek üzerine (otomatik değil); **v2 — PARÇALI çeviri** (metinler+lotlar bir çağrı, ürün tablosu ayrı; ürün yoksa 2. çağrı hiç yapılmaz). Bir parça patlarsa diğeri uygulanır ("Partially translated" uyarısı). Kanıt alıntıları İSPAT değeri için orijinal dilde kalır; önbellekli toggle. (Eski tek-istek sürümü büyük ihalede "Unterminated string" hatası veriyordu — 20 Tem hotfix.)
- **📎 Kendi Dokümanını Getir (BYOD):** motor yalnızca bildirimi okuyabildiyse çıkan kutu — portal linki + kopyalanabilir referans + PDF yükleme (8 dosya/20MB); dosyalar `tender-documents` bucket'ına gider, RPC ile kaydedilir, motor otomatik yeniden koşar.
- RFQ inbox, ürünler, kataloglar, sertifikalar, AI asistan sekmeleri de yerinde.

### matchmaking.html
- İki taraflı eşleştirme MVP (GPT üretti, Claude doğrulayıp onardı). Portal profilinden **otomatik ön-doldurma** (companies + company_match_profiles → form; yeşil bilgi bandı). Logo portalla birebir (koyu zeminde MEDIC açık turkuaz / HALL beyaz).

### Marka
- Logo: 3 sütun **M**, aradaki boşluklar **H** oluşturur (negatif alan). Küçük boyutta (favicon) H kaybolabilir — bilinen not.

## 4. EDGE FUNCTIONS (deploy durumu + JWT)

| Fonksiyon | İş | Verify JWT |
|---|---|---|
| `medichall-ai` **v2.1** | Portal chat/çeviri (Haiku), günlük limit + `medichall_ai_usage` log. `translate` modu: 6000 token çıktı / 24k girdi bütçesi (diğer modlar 1000/12k); yanıtta `truncated` bayrağı, kesilmeler `TRUNCATED_OUTPUT` koduyla loglanır | AÇIK |
| `ted-sync` **v1.5** | TED Search API v3'ten günlük çekim (TÜM AB; `TED_COUNTRIES` ile daraltılabilir). v1.4: v1.3'teki kritik `profiles` hatası düzeltildi (eşleşme yenileme hiç çalışmıyordu) + `notice_type` + ECB kurları → `fx_rates` → EUR karşılıkları. v1.5: adım 4c — pending ihalelerin başlık+açıklaması Haiku'yla 10'arlı partilerde İngilizceye çevrilir (koşu başına 60; backfill: `{"translate_backlog":100}` — 600 tek seferde WORKER_RESOURCE_LIMIT yer, 100'erlik turlarla gidilir). Çeviri patlarsa sync SÜRER, satır pending kalır. pg_cron 06:30 UTC, `x-cron-secret` | KAPALI |
| `tender-digest` **v1.0** | Günlük e-posta digest (Resend). 07:00 UTC pg_cron. Her kayıtlı arama için `search_tenders(p_created_after=last_digest_at)` → YENİ ihaleler; kullanıcı başına TEK mail; yeni yoksa mail GİTMEZ; damga yalnız başarılı gönderimde (patlarsa ertesi gün yeniden) | KAPALI |
| `tender-document-engine` **v2.6** | Derin analiz motoru. Kayıtlı doküman varsa onları; yoksa **resmi TED bildirim PDF'i** (`ted.europa.eu/en/notice/{pub}/pdf`) + Search API yapılandırılmış verisi. Çıktı: products(+evidence), lots(+catalog_fit_score+fit_reason, firma bağlamıyla), summary, fit_narrative, missing_information. Büyük ihale zırhı: 16k token, 30 lot sınırı, kesilmede otomatik 2. deneme, toleranslı JSON ayıklama | AÇIK |
| `ted-notice-resolver`, `tender-attachment-discovery`, `tender-archive-worker` | Doküman keşif/arşiv altyapısı (GPT). Deploy'lu ama **tık yolundan çıkarıldı** — derin analiz artık motor-öncelikli 2 adım (~30-60sn) | AÇIK |
| `public-assistant` | Ana sayfa hibrit asistanının Claude ayağı. IP limiti (`public_assistant_usage` tablosu), 500 kr girdi sınırı, konu bekçisi, CORS medichall.com | KAPALI |

Secrets: `ANTHROPIC_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY`; opsiyonel: `ANTHROPIC_MODEL`, `DOC_ENGINE_MODEL`, `TRANSLATE_MODEL`, `TED_COUNTRIES`, `TED_LOOKBACK_DAYS`, `TED_MAX_PAGES`, `TED_CPV`, `PUBLIC_AI_MODEL/IP_LIMIT/WINDOW_MIN`, `DIGEST_FROM`, `DIGEST_MAX_HITS_PER_SEARCH`, `AI_DAILY_LIMIT`.

**⚠️ Supabase Secrets arayüzü değerin kendisini değil özetini gösterir.**
`cron.job` içinden secret kurtarmaya çalışma ve değeri SQL, repo, sohbet veya
terminal geçmişine yazma. Eski değer repo/sohbetlerde açığa çıktığı için
yetkili kişi tarafından döndürülmeli. Yeni değer Edge Function `CRON_SECRET`
ve Vault `medichall_cron_secret` girdisine güvenli kanaldan yazılır;
`medichall_project_url` ile birlikte
`supabase/setup/CONFIGURE-CRON.sql` çalıştırılarak işler yeniden kurulur.

## 5. VERİTABANI (kurulu migration/RPC özeti)

- Temel: companies, products, catalogs, certificates, rfq'lar, buyer tarafı (supabase-portal-v2 serisi).
- Match engine: `company_match_profiles`, `opportunity_matches`, `refresh_company_opportunity_matches` (v2 skorlama: keyword metin araması + ağırlık yeniden dağıtımı + status koruyan upsert), `set_opportunity_match_status`.
- **CPV yaması:** `cpv_overlap_score()` — kodları normalize eder (rakamları ayıkla, İLK 8 hane; "33190000-8"→"33190000") + **hiyerarşik aile eşleşmesi** (33190000 → 33192000 ✓).
- Doküman motoru seti (0005_explainable→0008, MOTOR-KURULUM-TEK-SEFERDE.sql ile kuruldu): tenders'a analiz kolonları (extracted_products, ai_lots, document_analysis_notes, procurement_documents_url...), tender_documents, analysis/discovery/archive job tabloları, `queue_tender_document_analysis` (sıfır dokümanla iş kabul eder — 3-YAMA), storage bucket `tender-documents`; `opportunity_matches.fit_narrative`.
- Matchmaking: 4 tablo + 8 fonksiyon (202607120001).
- `medichall_public_stats()` — ana sayfa sayaçları (yalnız toplam döner, anon'a açık).
- `register_uploaded_tender_documents()` + storage insert policy (BYOD; DOKUMAN-YUKLEME.sql).
- `public_assistant_usage` (IP limiti), `medichall_ai_usage` (token log).
- **Sprint A (202607170001):** `tenders.notice_type` (raw_payload'dan geriye dönük dolduruldu — TED'i yeniden taramadan), `cpv_codes_norm` generated column + GIN, `fx_rates` (ECB günlük kurlar), `estimated_value_eur`+`eur_rate_as_of`, `search_tenders()` (tüm filtreler tek RPC), `tender_filter_facets()`.
- **CPV kataloğu (202607200001):** `cpv_catalog` — 655 medikal kod, etiketler resmi AB CPV 2008 XLSX'inden birebir; `cpv_catalog_with_counts()` canlı ihale sayaçlı seçici beslemesi.
- **İngilizce normalize (202607200002):** `tenders.title_en/description_en/translation_status`; `search_tenders` v3 EN kolonlarını da tarar; `refresh_company_opportunity_matches` keyword samanlığına EN kolonları eklendi (fonksiyon metni 202607100005'ten birebir, yalnız 2 ifade genişletildi). Kanıtlı sonuç: İngilizce keyword × Almanca ihale — keyword 0→50, toplam 30→55.
- **Sprint C (202607200003):** `saved_searches` (RLS: kendi kayıtları, 20/kullanıcı), `search_tenders` v4 (`p_created_after`), `digest_due_saved_searches()`, `mark_saved_search_digested()`. Vault-backed 07:00 UTC digest zamanlaması migration dışında `supabase/setup/CONFIGURE-CRON.sql` ile kurulur.

## 6. ÖNEMLİ ÜRÜN KARARLARI (değiştirme!)

1. **Sahte metrik/rakam ASLA yok.** "Coming soon 380 üretici", "Packaging Match %100" gibi hesaplanamayan her şey reddedildi. Sayaçlar gerçek DB verisi; veri yoksa gizlenir. Platformun satış vaadi "AI uydurmaz, kanıt gösterir" — ana sayfa da buna uymak zorunda.
2. **robots.txt'ye saygı.** Ulusal portallar (eAppalti FVG canlı testle doğrulandı) botları yasaklıyor; scraper/adaptör YAZILMADI. Çözüm BYOD: kullanıcı dokümanı indirir, sürükler, motor okur — her portalda çalışır, hukuki risk sıfır.
3. **Skorlama ≠ filtre.** Eşleştirme motoru ihaleleri elemez, puanlar; keşif için ayrı 🌍 mod var. Profil değişince **Find matches**'e basmak şart.
4. **Kanıt alıntıları hep orijinal dilde** (çeviri açıkken bile) — ihale ispatı orijinalindedir.
5. GPT ile çalışma deseni: **fikir/taslak GPT'den gelebilir ama dosyaları OLDUĞU GİBİ yüklenmez** — mevcut sistemi görmeden ürettiği için özellik siler/isim çakıştırır. Önce Claude inceler, işe yarayanı mevcut yapıya taşır. (Kimi.ai "Improvement Package" incelemesi örnek: 6 madde alındı, sahte istatistik/composite case study/doğrulanmamış trust badge/React yeniden yazımı reddedildi. Pricing sayfası bilinçli DIŞARIDA.)
6. **Kur uydurulmaz:** para çevirisi yalnız resmi ECB günlük kurlarıyla, "≈" işaretli ve orijinal değer korunarak; kur yoksa çeviri gösterilmez. Değeri belirtilmemiş ihaleler filtrede sessizce elenmez ("Value not stated" kutusu varsayılan işaretli).
7. **Makine çevirisi etiketlenir:** title_en/description_en her yerde "EN (machine translation)" ibaresiyle; kanıt/ispat orijinal metindedir.
8. **Digest gürültü üretmez:** yeni ihale yoksa e-posta gitmez ("0 sonuç" maili yasak). Günlük ritim; tetik = kullanıcının kaydettiği arama (sabit skor eşiği değil).

## 7. ÇALIŞMA KURALLARI (Claude için)

- Her SQL **yerel PostgreSQL'de** test edilip verilir; her TS **esbuild**'den geçirilir; portal JS'i sözdizimi kontrolünden geçer; kritik UI değişiklikleri playwright ekran görüntüsü/ölçümle doğrulanır.
- Teslim formatı: **tek zip + Türkçe OKUBENI/KURULUM.md**, hazır-deploy tam dosyalar (snippet değil).
- **Canlı dosya alınmadan var olan sayfa düzenlenmez** (bir kez ana sayfa hero'su bu yüzden ezildi — ders alındı).
- Dil: Türkçe, samimi; teknik kararların GEREKÇESİ anlatılır; kötü fikirlere (GPT'den gelse bile) açıkça itiraz edilir.

## 8. BEKLEYENLER / SIRADAKİLER

Yapıldı ve canlıda (17-20 Temmuz): GitHub tam senkronu ✓ · Sprint A (filtre veri katmanı + ted-sync v1.4 kritik düzeltme) ✓ · Sprint B (filtre UI) ✓ · Çeviri hotfix (medichall-ai v2.1 + parçalı translateDeep) ✓ · CPV kataloğu + profil seçicisi ✓ · İngilizce normalize katmanı (ted-sync v1.5) ✓ · Sprint C (saved searches + günlük digest) ✓ · ARCHITECTURE.md ✓

- [ ] **Backfill teyidi:** çeviri backfill'i 100'erlik turlarla sürüyor (600 tek seferde worker limitine takıldı). `pending=0` görülecek, ardından "ultrasound" arama testi + digest elle tetiği (`send_errors` kontrolü — doluysa çoğu kez Resend domain doğrulamasıdır).
- [ ] **CRON_SECRET rotasyonu (dağıtımdan önce zorunlu):** eski değer
      repo+sohbetlerde açığa çıktı. Yetkili kişi yeni değeri Edge Function
      secret'ına ve Vault'a güvenli kanaldan yazıp
      `supabase/setup/CONFIGURE-CRON.sql` ile cron işlerini yeniden kurmalı.
- [ ] **Sprint D:** CSV/PDF export + deadline→Google/Outlook takvim.
- [ ] Products boş durum tasarımı ("Request a Product" formu + kategori köprüleri).
- [ ] Matchmaking karşılıklı ilgi akışı (A ilgi → B onay → iletişim açılır) — en büyük kalem, tek başına sprint.
- [ ] Rol bazlı landing sayfaları (/for-manufacturers, /for-buyers) — trafik gelmeye başlayınca (şimdilik düşük öncelik, site yeni).
- [ ] CPV seçicinin kayıt akışına da takılması (bileşen hazır; kayıt sayfasının canlı dosyası gerekecek).
- [ ] "Tender Chat": ihale bağlamında soru-cevap (fonksiyon hazır, kurulmadı).
- [ ] "Business DNA" konumlandırması — altyapı değil anlatım işi.
- [ ] Profesyonel tasarım dilinin portal.html + matchmaking.html'e taşınması.
- [ ] products tablosundan matchmaking'e gerçek ürün adları.
- [ ] Küçük boyut için logo varyantı (favicon'da H okunmuyor olabilir).
- Rafta (bilerek): Win Probability / Competitor Intelligence (gerçek sonuç verisi birikince), PWA/mobil, pricing sayfası.
- Rafta (bilerek, 20 Tem kararı — B şıkkı): **React portal taşıması** — GPT `apps/portal-react/` altında All Tenders + My Opportunities'i React'e taşıdı (disiplinli iş: canlıya dokunmadı, kurallara uydu, rollback dokümanı bile yazdı). Ali Kaan kararıyla develop'tan revert edildi ve `experiment/react-portal` dalında EKSIKSIZ korunuyor. Gerekçe: build zinciri (pnpm/Vite) "Ali Kaan tek başına cPanel'den deploy eder" bağımsızlığını kırar + çift bakım yükü; trafiği olmayan siteye bugün erken. Yeniden açılma tetiği: gerçek kullanıcı trafiği + düzenli build alacak biri. develop = canlının gerçeği sözleşmesi geçerli.

## 9. BİLİNEN HASSAS NOKTALAR

- Fonksiyon deploy'unda **Verify JWT ayarı** tabloya uygun olmalı (ted-sync ve public-assistant KAPALI, diğerleri AÇIK) — en sık kurulum hatası bu.
- SQL'ler tekrar çalıştırmaya dayanıklı yazılır; "column does not exist" görülürse ilgili kurulum SQL'i atlanmış demektir.
- TED bildirim sayfası JS uygulamasıdır — HTML kazınmaz; veri Search API veya resmi bildirim PDF'inden alınır.
- Derin analizde lot kartları/fit anlatısı yalnızca **yeni** analizlerde dolar (eski analizler o alanları üretmedi).
- **Verify JWT güncel liste:** ted-sync, public-assistant ve **tender-digest KAPALI**; medichall-ai, tender-document-engine, resolver/discovery/archive AÇIK.
- **Ağır backfill işleri** (ör. toplu çeviri) Supabase worker limitine takılabilir — küçük partilerle, tekrar-çalıştırılabilir tasarla (her satır işlendiği an işaretlenir; yarım kalan kaldığı yerden sürer).
- Ali Kaan **Mac** kullanır: indirilen .sql/.ts dosyaları Gatekeeper uyarısı yer — paketler **.txt uzantılı** verilir (içerik aynı, Mac susar). Terminal komutları **tek satır** verilir (çok satırlı \\ yapıştırması zsh'de bölünüyor).
- Supabase Secrets arayüzünden değer kopyalanmaz (yalnız özet gösterir) — bkz. Bölüm 4 notu.

*Doküman sonu — bu noktadan sonrası yeni oturumun işi. Kolay gelsin! 🚀*
