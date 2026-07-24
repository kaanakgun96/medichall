MedicHall — Ürün Bazlı Eşleştirme Yaması
=========================================
Tarih: 24 Temmuz 2026 · Dosya: 202607240001_product_aware_matching.sql

KÖK NEDEN
---------
Doküman motoru ihale dokümanlarından ürünleri çıkarıp
tenders.extracted_products alanına yazıyordu. Kanıt: analiz edilen
26 ihalenin 25'inde ürün var.

AMA eşleştirme motoru bu alana HİÇ bakmıyordu — yalnız başlık ve
açıklamayı tarıyordu (skorlama fonksiyonunda "extracted_products"
kelimesi sıfır kez geçiyor).

Yani ürünler veritabanında duruyor, skorlama onları görmüyordu.
"PRODUCT %0" ve "ürün bazlı eşleştirme yapamıyoruz" sorununun
tamamı bu kopukluktu. İki yarım birbirine bağlı değildi.

ÇÖZÜM
-----
Keyword samanlığına iki kaynak eklendi:
  * tender_product_text(extracted_products) — ürün adı, malzeme,
    ölçü, sterilite, kategori, açıklama
  * tender_lot_text(ai_lots) — lot başlıkları (lot adı da ürün tarifidir)

Fonksiyon gövdesi 202607200002'deki (İngilizce normalize) sürümden
BİREBİR alındı; yalnız iki samanlık ifadesi genişletildi.
Ağırlıklar, kurallar, skorlama mantığı DEĞİŞMEDİ.

KANIT (yerel testte ölçüldü)
----------------------------
Senaryo: başlığı jenerik ("Fourniture de dispositifs medicaux steriles"),
ama dokümanından "Sterile ultrasound probe cover" çıkarılmış Fransız ihalesi.

  ÖNCE : keyword=0   toplam=0    -> ihale tamamen görünmez
  SONRA: keyword=50  toplam=25   -> gerçek eşleşme

Mevcut eşleşme regresyon testi: Almanca ihale 50/55 değerini korudu.

KURULUM
-------
1. Supabase -> SQL Editor -> bu dosyayı yapıştır -> Run (idempotent)
2. Portal -> Opportunities -> "Find matches" butonuna bas
   (veya yarın sabahki ted-sync koşusunu bekle)
3. Daha önce derin analiz yapılmış ihalelerde PRODUCT skorunun
   yükseldiğini görmelisin

ÖNEMLİ NOT
----------
Bu yama yalnız ANALİZ EDİLMİŞ ihalelerde fark yaratır — ürünler ancak
derin analiz sonrası extracted_products'a yazılıyor. Şu an 26 ihale
analiz edilmiş durumda; besleme 1183 ihale. Yani kapsam arttıkça
etkisi büyür.

TEST EDİLDİ
-----------
* Migration 2 kez çalıştırıldı (idempotent)
* Öncesi/sonrası skor karşılaştırması (0 -> 50)
* Mevcut eşleşmede regresyon yok (50/55 korundu)
* Sağlamlık: null, dizi-olmayan jsonb, boş dizi, eksik alan -> çökmüyor
