-- ============================================================
-- DOKUMAN-YUKLEME.sql — "Kendi dokümanını getir" altyapısı
--
-- Sorun: Ulusal portallar (eAppalti FVG gibi) dokümanları ya JS
-- arkasında tutuyor ya da robots.txt ile otomatik erişimi
-- yasaklıyor. Kullanıcı dosyaları elle 30 saniyede indirebiliyor
-- ama sisteme veremiyordu.
--
-- Çözüm: Kullanıcı indirdiği PDF'leri portala sürükleyip bırakır,
-- dosyalar tender-documents bucket'ına yüklenir, tender_documents
-- tablosuna kaydedilir, motor TAM analizi yapar (ürünler, lotlar,
-- miktarlar, kanıt alıntıları).
--
-- Tekrar çalıştırmaya dayanıklıdır.
-- ============================================================

-- 1) Storage: giriş yapmış kullanıcı, tender-documents bucket'ının
--    SADECE user-uploads/ klasörüne dosya yükleyebilsin
drop policy if exists "authenticated upload tender documents" on storage.objects;
create policy "authenticated upload tender documents"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'tender-documents'
  and name like 'user-uploads/%'
);

-- 2) Yüklenen dosyaları kaydeden RPC'nin kanonik ve güvenli tanımı
--    202607230002_document_intelligence_v2.sql içindedir. Tanımı burada tekrar
--    etmiyoruz; böylece setup dosyası migrasyonla çelişen file_size /
--    user_upload alanlarını yeniden kuramaz.

select 'dokuman yukleme hazir' as sonuc;
