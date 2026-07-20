# MedicHall — Hotfix: "Translation failed: Unterminated string"

**Tarih:** 20 Temmuz 2026
**Paket:** 2 dosya — `medichall-ai-v21.ts` + `portal.html` (tam dosya)
**Süre:** ~5 dakika

---

## Ne oluyordu?

Derin analizde **Translate to English**'e basınca
`Translation failed: Error: JSON Parse error: Unterminated string`.

**Kök neden (iki katmanlı):**

1. `medichall-ai` fonksiyonunda `max_tokens: 1000` sabitti. Chat için makul —
   ama çeviri, girdiyle aynı boyda çıktı üretmek zorunda. Senin Hamburg
   ihalesinde özet + 5 lot gerekçesi + narrative 1000 token'a sığmadı;
   Haiku'nun JSON'u ortada kesildi → `JSON.parse` patladı.
2. Ayrıca `MAX_INPUT_CHARS = 12000` her mod için tekti: daha büyük ihalede
   gönderilen JSON daha yolda sessizce kırpılıp modele YARIM gidecekti.
   Bugün patlamayan bu ikinci mayını da aynı pakette söktük.

Doküman motorunda aynı hastalığı yaşamıştık (16k token + kesilme zırhı o
yüzden vardı) — çeviri yolunda zırh yoktu. Artık var.

## Çözüm (iki uçlu)

**Sunucu — medichall-ai v2.1:**
- `translate` artık gerçek bir mod: **6000 token** çıktı bütçesi, **24000**
  karakter girdi sınırı. Diğer modlar 1000/12000'de kalır — maliyet koruması
  aynen duruyor.
- Yanıtta `truncated` bayrağı: model yine de sınıra çarparsa istemci yarım
  metni parse etmeye çalışmaz, anlaşılır hata gösterir.
- Kesilmeler `medichall_ai_usage` loglarında `TRUNCATED_OUTPUT` koduyla
  görünür (izlenebilirlik).
- Geriye uyumlu: eski portal `mode:"general"+task:"translate"` gönderse de
  çeviri bütçesi alır.

**İstemci — portal.html (çeviri v2, parçalı):**
- Tek dev istek yerine **2 küçük parça**: (1) özet+narrative+eksik bilgi+
  lotlar, (2) ürün tablosu. Küçük parçalar kesilmez.
- Ürünü olmayan ihalede 2. çağrı hiç yapılmaz — günlük AI hakkın israf olmaz.
- Bir parça patlarsa diğeri yine uygulanır: metinler İngilizce gelir, patlayan
  kısım orijinal kalır, "Partially translated…" uyarısı çıkar. Ya hep ya hiç
  yok artık.
- Kanıt alıntıları eskisi gibi ASLA çevrilmez (ispat orijinalindedir).

## Kurulum

1. **medichall-ai:** Supabase → Edge Functions → `medichall-ai` → kodu
   `medichall-ai-v21.ts` ile tamamen değiştir → Deploy.
   ### 🚨 Verify JWT: **AÇIK** (bu fonksiyon JWT ile korunur — ted-sync'in tersi!)
2. **portal.html:** GoDaddy → mevcut dosyanın üzerine yükle → **Ctrl+F5**.
   (Taban: Sprint B sürümü — filtreler dahil her şey içinde, canlındakiyle
   aynı temel.)
3. Aynı Hamburg ihalesini aç → **Translate to English** → özet, lotlar ve
   narrative İngilizce gelmeli.

Sıra fark etmez ama ikisini de yüklemeden test etme: yalnız portal
yüklersen büyük ihaleler yine 1000 token'a çarpabilir (parçalar sayesinde
çoğu geçer ama garantisi v2.1'le birlikte gelir); yalnız fonksiyon yüklersen
tek dev istek 24k girdi sınırına kadar çalışır ama parçalı dayanıklılık olmaz.

## Test edildi

- ✅ medichall-ai v2.1: TypeScript typecheck temiz + esbuild bundle başarılı
- ✅ portal JS sözdizimi (node --check, iki script bloğu)
- ✅ Playwright davranış testleri (mock fonksiyon, gerçek portal DOM'u):
  1. Mutlu yol — 2 parça, mode=translate, özet/lot/ürün üçü de çevriliyor
  2. Ürünsüz ihale — tek çağrı (AI hakkı israf edilmiyor)
  3. Kısmi arıza — metinler çevrildi, ürünler orijinal kaldı, uyarı çıktı
  4. truncated bayrağı — yarım çıktı uygulanmadı, şifreli
     "Unterminated string" yerine anlaşılır mesaj

## Not — günlük limit

Çeviri artık ihale başına 1-2 istek harcıyor (eskiden 1). Günlük limit 20
(`AI_DAILY_LIMIT` secret'ı ile değiştirilebilir). Yoğun çeviri kullanan bir
partner çıkarsa limiti 30-40'a çekmek tek secret değişikliği.
