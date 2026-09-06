-- Refresh only the system's former showcase defaults.
-- Brand-uploaded or manually configured image URLs are intentionally left untouched.

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{hero_image_url}', to_jsonb('/showcase/elan-skincare-hero-v2.webp'::text), true)
where brand_page_template = 'beauty'
  and brand_page_content ->> 'hero_image_url' = '/showcase/beauty-hero.jpg';

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{detail_image_url}', to_jsonb('/showcase/elan-skincare-detail-v2.webp'::text), true)
where brand_page_template = 'beauty'
  and brand_page_content ->> 'detail_image_url' = '/showcase/beauty-detail.jpg';

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{gallery_image_url}', to_jsonb('/showcase/elan-skincare-detail-v2.webp'::text), true)
where brand_page_template = 'beauty'
  and brand_page_content ->> 'gallery_image_url' in ('/showcase/beauty-hero.jpg', '/showcase/beauty-detail.jpg');

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{hero_image_url}', to_jsonb('/showcase/openroom-course-hero-v2.webp'::text), true)
where brand_page_template = 'education'
  and brand_page_content ->> 'hero_image_url' = '/showcase/education-hero.jpg';

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{detail_image_url}', to_jsonb('/showcase/openroom-course-detail-v2.webp'::text), true)
where brand_page_template = 'education'
  and brand_page_content ->> 'detail_image_url' = '/showcase/education-detail.jpg';

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{gallery_image_url}', to_jsonb('/showcase/openroom-course-detail-v2.webp'::text), true)
where brand_page_template = 'education'
  and brand_page_content ->> 'gallery_image_url' in ('/showcase/education-hero.jpg', '/showcase/education-detail.jpg');

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{hero_image_url}', to_jsonb('/showcase/forme-pilates-hero-v2.webp'::text), true)
where brand_page_template = 'fitness'
  and brand_page_content ->> 'hero_image_url' = '/showcase/fitness-hero.jpg';

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{detail_image_url}', to_jsonb('/showcase/forme-pilates-detail-v2.webp'::text), true)
where brand_page_template = 'fitness'
  and brand_page_content ->> 'detail_image_url' = '/showcase/fitness-detail.jpg';

update public.clinic_settings
set brand_page_content = jsonb_set(brand_page_content, '{gallery_image_url}', to_jsonb('/showcase/forme-pilates-detail-v2.webp'::text), true)
where brand_page_template = 'fitness'
  and brand_page_content ->> 'gallery_image_url' in ('/showcase/fitness-hero.jpg', '/showcase/fitness-detail.jpg');
