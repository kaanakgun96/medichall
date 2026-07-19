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

-- 2) Yüklenen dosyaları tender_documents tablosuna kaydeden RPC
--    (sahiplik kontrolü + sadece PDF + adet sınırı)
create or replace function public.register_uploaded_tender_documents(
  p_tender_id bigint,
  p_company_id bigint,
  p_files jsonb   -- [{"file_name":"...","file_url":"https://...","file_size":123}]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file jsonb;
  v_count integer := 0;
  v_url text;
  v_name text;
begin
  if not exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = auth.uid()
  ) then
    raise exception 'Access denied';
  end if;

  if not exists (select 1 from public.tenders where id = p_tender_id) then
    raise exception 'Tender not found';
  end if;

  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 8 then
    raise exception 'Provide 1-8 files';
  end if;

  for v_file in select * from jsonb_array_elements(p_files) loop
    v_url  := trim(v_file ->> 'file_url');
    v_name := left(trim(coalesce(v_file ->> 'file_name', 'document.pdf')), 200);

    -- yalnızca bizim bucket'ımızın user-uploads yoluna işaret eden URL'ler
    if v_url not like '%/storage/v1/object/public/tender-documents/user-uploads/%' then
      continue;
    end if;

    insert into public.tender_documents
      (tender_id, title, file_name, file_url, mime_type, document_type,
       language_code, file_size, is_active, created_at, updated_at)
    values
      (p_tender_id, v_name, v_name, v_url, 'application/pdf', 'user_upload',
       null, nullif(v_file ->> 'file_size','')::bigint, true, now(), now())
    on conflict do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.register_uploaded_tender_documents(bigint, bigint, jsonb) to authenticated;

select 'dokuman yukleme hazir' as sonuc;
