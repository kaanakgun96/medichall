# MedicHall — CPV Kataloğu + Profil Seçicisi

**Tarih:** 20 Temmuz 2026
**Paket:** 2 dosya — `202607200001_cpv_catalog.sql` + `portal.html` (tam dosya)
**Ön koşul:** Sprint A kurulu (cpv_codes_norm kolonu sayaçlar için gerekli)

---

## Ne çözüyor?

"Ultrasound Probe Cover diye aratıyorum, bulamıyorum" derdinin **dil-bağımsız
yarısı.** İhale hangi dilde yazılırsa yazılsın CPV kodu aynıdır. Kullanıcı artık
kod ezberlemek yerine üründen grup seçer; motor o kodlarla eşleştirir.

Senin fikrin: "üyelere kayıt olurken CPV kodları seçtiririz, liste çıkar,
onlar seçer, biz o kodlara göre eşleştiririz." Bu paket o fikrin profil
formundaki hali — kayıt akışına da aynı bileşen takılabilir (istenirse
sonraki adım).

## Ne kuruyor?

**1. `cpv_catalog` tablosu (655 kod).**
Kaynak: AB resmi CPV 2008 nomenklatürü — senin indirdiğin
`cpv_2008_ver_2013.xlsx` dosyasından İngilizce etiketlerle **birebir**
aktarıldı; tek etiket bile elle yazılmadı. Kapsam: 33xxxxxx ana gövde
(medikal ekipman/ilaç/kişisel bakım) + ted-sync'in fiilen çektiği komşu
aileler (koruyucu giysi, tek kullanımlık eldiven, dezenfektan, dezenfeksiyon
ekipmanı, medikal bakım/onarım hizmetleri). Hiyerarşi parent_code ile bağlı.

**2. `cpv_catalog_with_counts()` RPC'si.**
Seçici beslemesi: kodlar + her aile için **beslemedeki gerçek açık ihale
sayısı** (cpv_codes_norm üzerinden prefix/aile eşleşmesi). Sayı yoksa "0
open" yazar — asla uydurma rakam göstermez.

**3. Profil formunda "Browse catalog" seçicisi (portal.html).**
- Mevcut CPV metin kutusu YERİNDE duruyor; seçici onun yanında açılıyor.
  İşaretlenen kodlar kutuya CSV yazılıyor → **kaydet/yükle akışına ve motora
  sıfır dokunuş.** Elle kod girmeye devam edebilirsin; seçici üzerine ekler.
- Aranabilir (ör. "gloves", "furniture", "3319"), gruplu ağaç, her satırda
  resmi etiket + kod + canlı sayaç.
- Katalog SQL'i kurulmamışsa panel kibarca söyler, elle giriş çalışmaya
  devam eder (savunmalı düşüş).

## Kurulum

1. **SQL:** Supabase SQL Editor → `202607200001_cpv_catalog.sql` → Run.
   (İdempotent; iki kez koşarsan etiketleri günceller, bozmaz.)
2. **portal.html:** GoDaddy → üzerine yükle → **Ctrl+F5**.
   Taban: çeviri hotfix'li son sürüm — filtreler + parçalı çeviri + seçici
   hepsi bu tek dosyada.
3. Portal → Opportunities → profil formunda **Browse catalog** → bir aile
   seç → **Save profile** → **Find matches**.

## Doğrulama

- [ ] Browse catalog açılıyor, gruplar ve sayaçlar geliyor
- [ ] "gloves" araması eldiven ailelerini buluyor
- [ ] Kutu işaretleyince kod üstteki inputa yazılıyor; kaldırınca siliniyor
- [ ] Elle yazdığın kod, seçici kullanınca kaybolmuyor
- [ ] Save profile sonrası profili yeniden açınca işaretler yerinde
      (input CSV'den okunuyor)
- [ ] SQL kurulmadan portal yüklendiyse: "Catalog not installed" mesajı

## Test edildi

- ✅ Migration yerel Postgres'te 2 kez (idempotent), 655 kod, hiyerarşi
  zinciri doğrulandı (33190000 → 33191000 → 33191100 → 33191110)
- ✅ Canlı sayaç RPC'si fixture verisiyle doğru sayıyor
- ✅ Portal JS sözdizimi (node --check)
- ✅ Playwright: katalog yükleme, arama, işaretle/kaldır ↔ input senkronu,
  elle girilen kodun korunması, katalog-yok düşüş mesajı; ekran görüntüsüyle
  görsel doğrulama

## Bilinen sınırlar (dürüstlük köşesi)

- CPV her ürünü tanımaz: "ultrasound probe cover"ın kendine ait kodu yok.
  Seçici eşleşmeyi **bulur**, inceltmez — inceltme keyword + derin analizin
  işi. Kullanıcıya sayaçlar zaten gerçekçi beklenti veriyor.
- Seçici depth ≤ 5 gösterir (UI sadeliği). Daha ince kod isteyen elle
  yazabilir; motor 8 haneye kadar hepsini kabul eder.
- İngilizce-normalize katmanı (title_en/description_en) bu pakete DAHİL
  DEĞİL — o karar hâlâ 2 teşhis sorgusunun çıktısını bekliyor.
